/**
 * Standalone worker process (Section 63) — run separately on Render if desired,
 * or once per cycle from GitHub Actions (docs/DEPLOY-KOYEB-NEON.md).
 *
 * Retention runs here too: on the free stack (Koyeb + Neon + GitHub Actions)
 * ingestion happens outside the web process, so this is where the daily policy
 * keeps the database within the free tier's size limit.
 */
import { migrate, getDb, type Db } from './db/index.js';
import { registerSources, runIngestion } from './ingestion/ingest.js';
import { runClustering } from './pipeline/cluster.js';
import { runIntelligenceCycle } from './agents/orchestrator.js';
import { buildGraph } from './pipeline/graph.js';
import { runAlerts } from './pipeline/alerts.js';
import { runRetention } from './pipeline/retention.js';

const CYCLE_MIN = Number(process.env.CYCLE_MINUTES ?? 10);
const ONCE = process.argv.includes('--once');

// Retenção no máximo uma vez por dia (mesma política de src/index.ts).
// Em processos de vida curta (--once via GitHub Actions) o estado em memória
// não sobrevive entre execuções; a última execução fica registada na própria
// base (system_flag), tal como as restantes flags do sistema.
const RETENTION_FLAG = 'retention_last_run_at';
const RETENTION_INTERVAL_MS = Number(process.env.RETENTION_HOURS ?? 24) * 3600e3;

async function retentionDue(db: Db): Promise<boolean> {
  try {
    const rows = await db.query<{ value: string }>(
      `SELECT value FROM system_flag WHERE key=$1`, [RETENTION_FLAG]);
    const last = rows[0]?.value;
    if (last && Date.now() - new Date(last).getTime() < RETENTION_INTERVAL_MS) return false;
  } catch {
    // Tabela ainda inexistente (primeira execução) — correr à mesma.
  }
  return true;
}

async function markRetentionDone(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO system_flag (key, value, updated_by) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
    [RETENTION_FLAG, new Date().toISOString(), 'retention-worker'],
  );
}

async function cycle(): Promise<void> {
  const t0 = Date.now();

  let ret: Awaited<ReturnType<typeof runRetention>> | null = null;
  try {
    const db = await getDb();
    if (await retentionDue(db)) {
      ret = await runRetention();
      await markRetentionDone(db);
    }
  } catch (e) {
    console.error('retention failed:', e);
  }

  const ing = await runIngestion();
  const cl = await runClustering();
  const cy = await runIntelligenceCycle();
  const gr = await buildGraph();
  const al = await runAlerts();
  console.log(JSON.stringify({
    at: new Date().toISOString(), ms: Date.now() - t0,
    ingested: ing.totalInserted,
    sources: ing.sources.map((s) => ({ id: s.id, status: s.status, items: s.items, inserted: s.inserted, error: s.error })),
    clustering: cl,
    processed: cy.length, published: cy.filter((c) => c.published).length,
    graph: gr,
    alerts: al,
    heldForReview: cy.filter((c) => !c.published).map((c) => ({ id: c.eventId, why: c.gate.failures.concat(c.supervisor.decision) })),
    retention: ret,
  }, null, 2));
}

(async () => {
  await migrate();
  await registerSources();
  await cycle();
  if (ONCE) process.exit(0);
  setInterval(() => { void cycle().catch((e) => console.error('cycle failed:', e)); }, CYCLE_MIN * 60_000);
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
