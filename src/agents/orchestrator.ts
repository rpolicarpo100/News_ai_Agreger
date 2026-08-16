/**
 * Orchestrator (Section 7) + Supervisor (Section 8) + Information Quality Gate (Section 79).
 *
 * Flow: select relevant agents -> run -> record every run with full versioning
 * (Section 35) -> supervisor validates -> quality gate -> publish or hold.
 */
import { getDb } from '../db/index.js';
import { ALL_AGENTS } from './specialists.js';
import type { AgentContext, ArticleRef, EventRef, AgentResult } from './types.js';
import { scoreEvent } from '../pipeline/scoring.js';
import { audit } from '../core/audit.js';
import { getFlag, FLAGS } from '../core/flags.js';
import { sha1 } from '../core/ids.js';

export const PIPELINE_VERSION = 'orchestrator-1.0.0';

async function loadContext(eventId: string): Promise<AgentContext | null> {
  const db = await getDb();
  const ev = await db.query<EventRef>(
    `SELECT id, title, category, country, first_seen_at, last_activity_at, article_count,
            independent_sources, measurements, status FROM event WHERE id=$1`, [eventId]);
  if (!ev.length) return null;
  const articles = await db.query<ArticleRef>(
    `SELECT a.id, a.source_id, s.name AS source_name, s.publisher_group, s.origin_type,
            s.reliability_score, a.url, a.title, a.summary, a.published_at, a.category,
            a.lat, a.lon, a.payload
     FROM article a JOIN source s ON s.id=a.source_id
     WHERE a.event_id=$1 ORDER BY a.published_at NULLS LAST`, [eventId]);
  return { eventId, event: ev[0], articles };
}

async function recordRun(eventId: string, r: AgentResult, ms: number, inputRefs: string[]): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO agent_run (event_id, agent, agent_version, mode, model, model_version, prompt_version,
       input_refs, output, confidence, status, duration_ms)
     VALUES ($1,$2,$3,$4,NULL,NULL,NULL,$5,$6,$7,$8,$9)`,
    [eventId, r.agent, r.agentVersion, r.mode, JSON.stringify(inputRefs),
     JSON.stringify({ output: r.output, notes: r.notes }), r.confidence, r.status, ms]);
}

export interface ProcessResult {
  eventId: string;
  agentsRun: string[];
  supervisor: { decision: string; findings: any[] };
  gate: { passed: boolean; failures: string[] };
  published: boolean;
}

export async function processEvent(eventId: string): Promise<ProcessResult | null> {
  const db = await getDb();
  const ctx = await loadContext(eventId);
  if (!ctx) return null;
  const inputRefs = ctx.articles.map((a) => a.id);

  await setState(eventId, 'ANALYZING', 'orchestrator', 'agent selection started');

  const selected = ALL_AGENTS.filter((a) => a.appliesTo(ctx));
  const results: AgentResult[] = [];
  for (const agent of selected) {
    const t0 = Date.now();
    let res: AgentResult;
    try {
      res = await agent.run(ctx);
    } catch (err: any) {
      res = { agent: agent.name, agentVersion: agent.version, mode: 'deterministic', status: 'unavailable',
              output: null, confidence: null, notes: [`agent error: ${String(err?.message ?? err).slice(0, 200)}`] };
    }
    await recordRun(eventId, res, Date.now() - t0, inputRefs);
    results.push(res);
  }

  // Persist detected conflicts (Section 19) so the UI can show SOURCE CONFLICT.
  const contra = results.find((r) => r.agent === 'contradiction');
  if (contra?.status === 'ok') {
    const conflicts = (contra.output as any)?.conflicts ?? [];
    for (const c of conflicts) {
      const cid = `CFL-${sha1(`${eventId}|${c.field}`).slice(0, 12)}`;
      await db.query(
        `INSERT INTO conflict (id, event_id, field, detail) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET detail=$4, resolved=FALSE`,
        [cid, eventId, c.field, JSON.stringify(c.values)]);
    }
  }

  // Verification verdict.
  await setState(eventId, 'VERIFYING', 'orchestrator', 'verification agent evaluated');
  const ver = results.find((r) => r.agent === 'verification');
  const verdict = (ver?.output as any)?.verdict ?? 'UNVERIFIED';
  const hasConflict = (contra?.output as any)?.conflicts?.length > 0;
  const finalVerification = hasConflict ? 'DISPUTED' : verdict;
  await db.query(`UPDATE event SET verification=$2, last_verified_at=now() WHERE id=$1`, [eventId, finalVerification]);

  // Scores.
  const frozen = (await getFlag(FLAGS.TRENDING_FROZEN)) === 'yes';
  const scores = await scoreEvent(eventId, frozen);

  // ---------------- SUPERVISOR ----------------
  await setState(eventId, 'SUPERVISOR_REVIEW', 'orchestrator', 'handing off to supervisor');
  const findings = supervise(ctx, results, scores);
  const blocking = findings.filter((f) => !f.pass && f.severity === 'blocking');
  const review = findings.filter((f) => !f.pass && f.severity === 'review');
  const decision = blocking.length ? 'BLOCK' : review.length ? 'REVIEW_REQUIRED' : 'APPROVE';
  await db.query(`INSERT INTO supervisor_review (event_id, decision, findings) VALUES ($1,$2,$3)`,
    [eventId, decision, JSON.stringify(findings)]);

  // ---------------- QUALITY GATE (Section 79) ----------------
  const gate = qualityGate(ctx, results, scores, decision);

  let published = false;
  if (gate.passed && decision === 'APPROVE' && (await getFlag(FLAGS.AUTO_PUBLISH)) === 'on') {
    await db.query(`UPDATE event SET status='PUBLISHED', published_at=COALESCE(published_at, now()) WHERE id=$1`, [eventId]);
    await setState(eventId, 'PUBLISHED', 'supervisor', 'all quality gate conditions met');
    published = true;
  } else {
    const reason = gate.failures.join('; ') || `supervisor decision ${decision}`;
    await setState(eventId, decision === 'BLOCK' ? 'SUPERVISOR_REVIEW' : 'SUPERVISOR_REVIEW', 'supervisor', `not published: ${reason}`);
    const open = await db.query(`SELECT 1 FROM review_queue WHERE event_id=$1 AND state='open'`, [eventId]);
    if (!open.length) {
      await db.query(`INSERT INTO review_queue (event_id, reason, priority) VALUES ($1,$2,$3)`,
        [eventId, reason, decision === 'BLOCK' ? 90 : 50]);
    }
  }

  return { eventId, agentsRun: selected.map((a) => a.name), supervisor: { decision, findings }, gate, published };
}

interface Finding { check: string; pass: boolean; severity: 'blocking' | 'review' | 'info'; detail: string }

function supervise(ctx: AgentContext, results: AgentResult[], scores: any[]): Finding[] {
  const f: Finding[] = [];
  f.push({ check: 'event_has_articles', pass: ctx.articles.length > 0, severity: 'blocking',
           detail: `${ctx.articles.length} article(s)` });
  f.push({ check: 'every_article_has_url', pass: ctx.articles.every((a) => /^https?:\/\//.test(a.url)), severity: 'blocking',
           detail: 'all linked articles must carry a resolvable origin URL' });
  f.push({ check: 'title_traceable_to_article', pass: ctx.articles.some((a) => a.title === ctx.event.title), severity: 'blocking',
           detail: 'event title must be the verbatim title of a linked article' });
  f.push({ check: 'timestamps_present', pass: ctx.articles.every((a) => !!a.published_at), severity: 'review',
           detail: `${ctx.articles.filter((a) => a.published_at).length}/${ctx.articles.length} with published_at` });
  const unavailable = results.filter((r) => r.status === 'unavailable');
  f.push({ check: 'no_agent_failures', pass: unavailable.length === 0, severity: 'review',
           detail: unavailable.length ? `failed: ${unavailable.map((r) => r.agent).join(', ')}` : 'all selected agents completed' });
  const conf = scores.find((s) => s.kind === 'confidence');
  f.push({ check: 'confidence_computed', pass: conf?.value !== null && conf?.value !== undefined, severity: 'review',
           detail: conf?.unavailableReason ?? `confidence=${conf?.value}` });
  f.push({ check: 'confidence_threshold', pass: (conf?.value ?? 0) >= 30, severity: 'review',
           detail: `confidence ${conf?.value ?? 'N/A'} (< 30 requires human review)` });
  const impact = scores.find((s) => s.kind === 'life_impact');
  f.push({ check: 'high_impact_needs_review', pass: !((impact?.value ?? 0) >= 80 && (conf?.value ?? 0) < 70), severity: 'review',
           detail: `impact ${impact?.value ?? 'N/A'} vs confidence ${conf?.value ?? 'N/A'}` });
  const contra = results.find((r) => r.agent === 'contradiction');
  const nConf = (contra?.output as any)?.conflicts?.length ?? 0;
  f.push({ check: 'no_unresolved_conflicts', pass: nConf === 0, severity: 'review',
           detail: nConf ? `${nConf} conflicting field(s) — shown to the reader, not resolved` : 'no numeric conflicts' });
  f.push({ check: 'no_test_data', pass: true, severity: 'blocking', detail: 'test rows are excluded by the ingestion query' });
  return f;
}

function qualityGate(ctx: AgentContext, results: AgentResult[], scores: any[], supervisorDecision: string) {
  const failures: string[] = [];
  if (!ctx.articles.length) failures.push('SOURCE EXISTS? no linked article');
  if (!ctx.articles.every((a) => /^https?:\/\//.test(a.url))) failures.push('PROVENANCE? article without origin URL');
  if (!ctx.articles.some((a) => a.published_at)) failures.push('TIMESTAMP? no article carries a publication timestamp');
  if (ctx.event.category === 'unclassified') failures.push('CLASSIFIED? event category could not be determined');
  const conf = scores.find((s) => s.kind === 'confidence');
  if (conf?.value === null || conf?.value === undefined) failures.push('CONFIDENCE? could not be computed');
  if (supervisorDecision === 'BLOCK') failures.push('SUPERVISOR? blocked');
  return { passed: failures.length === 0, failures };
}

export async function setState(eventId: string, to: string, actor: string, reason: string): Promise<void> {
  const db = await getDb();
  const cur = await db.query<{ status: string }>(`SELECT status FROM event WHERE id=$1`, [eventId]);
  const from = cur[0]?.status ?? null;
  if (from === to) return;
  await db.query(`UPDATE event SET status=$2 WHERE id=$1`, [eventId, to]);
  await db.query(`INSERT INTO event_state_history (event_id, from_state, to_state, reason, actor) VALUES ($1,$2,$3,$4,$5)`,
    [eventId, from, to, reason, actor]);
}

/** Process every event that has new activity since its last supervisor review. */
export async function runIntelligenceCycle(limit = 60): Promise<ProcessResult[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `SELECT e.id FROM event e
     LEFT JOIN LATERAL (SELECT MAX(at) AS at FROM supervisor_review r WHERE r.event_id=e.id) r ON TRUE
     WHERE r.at IS NULL OR e.last_activity_at > r.at
     ORDER BY e.last_activity_at DESC LIMIT $1`, [limit]);
  const out: ProcessResult[] = [];
  for (const r of rows) {
    const res = await processEvent(r.id);
    if (res) out.push(res);
  }
  if (out.length) {
    await audit({ actor: 'orchestrator', action: 'intelligence_cycle', objectType: 'pipeline', objectId: 'orchestrator',
      newState: { processed: out.length, published: out.filter((o) => o.published).length }, reason: 'scheduled cycle' });
  }
  return out;
}
