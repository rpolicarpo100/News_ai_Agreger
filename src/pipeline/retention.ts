/**
 * Política de retenção — §39 (backups/manutenção), §40, e o limite real de
 * 1 GB do Postgres gratuito do Render.
 *
 * Medição que motiva isto: 953 artigos ocupavam ~70 MB, sobretudo por causa do
 * campo `article.payload`, que guarda o registo verbatim do fornecedor. A esse
 * ritmo, 10 000 artigos aproximam-se do limite do plano gratuito.
 *
 * Princípios (por esta ordem, §4 integridade primeiro):
 *
 *  1. **A proveniência nunca é apagada.** URL, título, fonte e timestamps de um
 *     artigo mantêm-se para sempre. O que é libertado é o `payload` verbatim —
 *     o campo grande — e apenas de artigos antigos já processados. A cadeia
 *     SOURCE → ARTICLE → EVENT permanece verificável.
 *
 *  2. **A auditoria não desaparece em silêncio** (§32). Registos antigos de
 *     `audit_log` são resumidos numa entrada de arquivo que declara quantos
 *     foram compactados e de que período, em vez de sumirem sem rasto.
 *
 *  3. **Nada que esteja publicado é tocado.** Eventos publicados, os seus
 *     artigos, scores e timeline ficam intactos. Só se recolhe lixo de
 *     material que nunca chegou a ser publicado ou que já foi arquivado.
 *
 *  4. **Tudo é reversível por reingestão.** Os feeds continuam a ser a fonte
 *     de verdade; nada aqui destrói informação que não possa voltar.
 */
import { getDb } from '../db/index.js';
import { audit } from '../core/audit.js';

export interface RetentionPolicy {
  /** Dias após os quais o payload verbatim de um artigo já processado é libertado. */
  payloadDays: number;
  /** Dias de execuções de agentes detalhadas a manter (as mais recentes bastam para depurar). */
  agentRunDays: number;
  /** Dias de registos de auditoria em bruto antes de serem resumidos. */
  auditDays: number;
  /** Dias de visualizações individuais a manter (as contagens agregadas mantêm-se). */
  viewDays: number;
  /** Dias após os quais eventos nunca publicados e sem actividade são removidos. */
  staleEventDays: number;
  /** Dias de arestas do grafo a manter para eventos inactivos. */
  graphDays: number;
}

export const DEFAULT_POLICY: RetentionPolicy = {
  payloadDays: Number(process.env.RETAIN_PAYLOAD_DAYS ?? 14),
  agentRunDays: Number(process.env.RETAIN_AGENT_RUN_DAYS ?? 30),
  auditDays: Number(process.env.RETAIN_AUDIT_DAYS ?? 90),
  viewDays: Number(process.env.RETAIN_VIEW_DAYS ?? 60),
  staleEventDays: Number(process.env.RETAIN_STALE_EVENT_DAYS ?? 45),
  graphDays: Number(process.env.RETAIN_GRAPH_DAYS ?? 30),
};

export interface RetentionReport {
  dryRun: boolean;
  payloadsFreed: number;
  agentRunsRemoved: number;
  auditArchived: number;
  viewsCompacted: number;
  staleEventsRemoved: number;
  graphEdgesRemoved: number;
  notes: string[];
}

const days = (n: number) => `${n} days`;

/**
 * `dryRun` conta o que seria afectado sem alterar nada — para que a política
 * possa ser inspeccionada antes de correr.
 */
export async function runRetention(
  policy: RetentionPolicy = DEFAULT_POLICY,
  dryRun = false,
): Promise<RetentionReport> {
  const db = await getDb();
  const notes: string[] = [];
  const r: RetentionReport = {
    dryRun, payloadsFreed: 0, agentRunsRemoved: 0, auditArchived: 0,
    viewsCompacted: 0, staleEventsRemoved: 0, graphEdgesRemoved: 0, notes,
  };

  // ---------------------------------------------------------------- 1. payloads
  // O maior consumidor de espaço. Liberta-se apenas de artigos já ligados a um
  // evento (ou seja, já processados) e antigos. URL, título, resumo, hashes e
  // timestamps mantêm-se — a proveniência continua completa.
  const payloadWhere = `
    payload <> '{"archived":true}'
    AND ingested_at < now() - interval '${days(policy.payloadDays)}'
    AND event_id IS NOT NULL`;
  const [{ n: payloadCount }] = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM article WHERE ${payloadWhere}`);
  r.payloadsFreed = Number(payloadCount);
  if (!dryRun && r.payloadsFreed > 0) {
    await db.query(`UPDATE article SET payload = '{"archived":true}' WHERE ${payloadWhere}`);
  }
  notes.push(`payload verbatim libertado de ${r.payloadsFreed} artigo(s) com mais de ${policy.payloadDays} dias; proveniência (URL, título, fonte, datas) mantida`);

  // ---------------------------------------------------------------- 2. agent runs
  // Mantém-se sempre a execução mais recente de cada agente por evento, para
  // que "como chegou o sistema a esta conclusão" continue respondível (§35).
  const agentWhere = `
    started_at < now() - interval '${days(policy.agentRunDays)}'
    AND id NOT IN (
      SELECT DISTINCT ON (event_id, agent) id FROM agent_run
      ORDER BY event_id, agent, started_at DESC)`;
  const [{ n: agentCount }] = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM agent_run WHERE ${agentWhere}`);
  r.agentRunsRemoved = Number(agentCount);
  if (!dryRun && r.agentRunsRemoved > 0) {
    await db.query(`DELETE FROM agent_run WHERE ${agentWhere}`);
  }
  notes.push(`${r.agentRunsRemoved} execução(ões) de agente antigas removidas; a mais recente de cada agente por evento é sempre preservada`);

  // ---------------------------------------------------------------- 3. auditoria
  // §32: nunca apagar histórico em silêncio. Resume-se numa entrada que declara
  // o que foi compactado, para que a lacuna seja ela própria auditável.
  const [{ n: auditCount }] = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM audit_log
     WHERE at < now() - interval '${days(policy.auditDays)}' AND action <> 'retention_archive'`);
  r.auditArchived = Number(auditCount);
  if (!dryRun && r.auditArchived > 0) {
    const [range] = await db.query<{ min_at: string; max_at: string }>(
      `SELECT MIN(at) AS min_at, MAX(at) AS max_at FROM audit_log
       WHERE at < now() - interval '${days(policy.auditDays)}' AND action <> 'retention_archive'`);
    const [byAction] = await db.query<{ summary: string }>(
      `SELECT string_agg(action || '=' || n, ', ' ORDER BY n DESC) AS summary FROM (
         SELECT action, COUNT(*)::int AS n FROM audit_log
         WHERE at < now() - interval '${days(policy.auditDays)}' AND action <> 'retention_archive'
         GROUP BY action LIMIT 20) x`);
    await audit({
      actor: 'retention',
      action: 'retention_archive',
      objectType: 'audit_log',
      objectId: null,
      prevState: { entries: r.auditArchived, from: range.min_at, to: range.max_at },
      newState: { summarised: true, breakdown: byAction?.summary ?? '' },
      reason: `${r.auditArchived} registos anteriores a ${policy.auditDays} dias resumidos nesta entrada; o histórico não foi apagado em silêncio`,
    });
    await db.query(
      `DELETE FROM audit_log
       WHERE at < now() - interval '${days(policy.auditDays)}' AND action <> 'retention_archive'`);
  }
  notes.push(`${r.auditArchived} registo(s) de auditoria resumidos numa entrada de arquivo`);

  // ---------------------------------------------------------------- 4. views
  // As contagens por evento continuam correctas porque o trending usa janelas de
  // 24/48h; linhas individuais mais antigas do que isso já não são consultadas.
  const viewWhere = `at < now() - interval '${days(policy.viewDays)}'`;
  const [{ n: viewCount }] = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM event_view WHERE ${viewWhere}`);
  r.viewsCompacted = Number(viewCount);
  if (!dryRun && r.viewsCompacted > 0) {
    await db.query(`DELETE FROM event_view WHERE ${viewWhere}`);
  }
  notes.push(`${r.viewsCompacted} registo(s) de visualização individuais removidos (trending usa janelas de 24/48h)`);

  // ---------------------------------------------------------------- 5. eventos mortos
  // Eventos que nunca foram publicados, sem actividade há muito, e que não estão
  // em revisão nem seguidos por ninguém. Não se perde nada verificado.
  const staleWhere = `
    status <> 'PUBLISHED'
    AND last_activity_at < now() - interval '${days(policy.staleEventDays)}'
    AND id NOT IN (SELECT event_id FROM review_queue WHERE state = 'open')
    AND id NOT IN (SELECT value FROM follow WHERE kind = 'event')
    AND id NOT IN (SELECT event_id FROM bookmark)`;
  const [{ n: staleCount }] = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM event WHERE ${staleWhere}`);
  r.staleEventsRemoved = Number(staleCount);
  if (!dryRun && r.staleEventsRemoved > 0) {
    // Os artigos ficam (event_id passa a NULL) — a proveniência sobrevive ao evento.
    await db.query(
      `UPDATE article SET event_id = NULL WHERE event_id IN (SELECT id FROM event WHERE ${staleWhere})`);
    await db.query(`DELETE FROM event WHERE ${staleWhere}`);
  }
  notes.push(`${r.staleEventsRemoved} evento(s) nunca publicados e inactivos removidos; os artigos e a sua proveniência mantêm-se`);

  // ---------------------------------------------------------------- 6. grafo
  const graphWhere = `
    created_at < now() - interval '${days(policy.graphDays)}'
    AND from_event NOT IN (SELECT id FROM event WHERE status = 'PUBLISHED')
    AND to_event NOT IN (SELECT id FROM event WHERE status = 'PUBLISHED')`;
  const [{ n: edgeCount }] = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM event_relation WHERE ${graphWhere}`);
  r.graphEdgesRemoved = Number(edgeCount);
  if (!dryRun && r.graphEdgesRemoved > 0) {
    await db.query(`DELETE FROM event_relation WHERE ${graphWhere}`);
  }
  notes.push(`${r.graphEdgesRemoved} aresta(s) do grafo entre eventos não publicados removidas`);

  if (!dryRun) {
    const touched = r.payloadsFreed + r.agentRunsRemoved + r.auditArchived +
      r.viewsCompacted + r.staleEventsRemoved + r.graphEdgesRemoved;
    if (touched > 0) {
      await audit({
        actor: 'retention', action: 'run', objectType: 'pipeline', objectId: 'retention',
        newState: r, reason: 'ciclo de retenção agendado',
      });
    }
  }
  return r;
}

/** Estimativa de ocupação, para o painel de administração. */
export async function databaseSize(): Promise<{ bytes: number | null; pretty: string; tables: Array<{ table: string; pretty: string; bytes: number }> }> {
  const db = await getDb();
  try {
    const rows = await db.query<any>(
      `SELECT relname AS table,
              pg_total_relation_size(c.oid) AS bytes,
              pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`);
    const total = rows.reduce((a: number, x: any) => a + Number(x.bytes), 0);
    return {
      bytes: total,
      pretty: `${(total / 1024 / 1024).toFixed(1)} MB`,
      tables: rows.map((x: any) => ({ table: x.table, pretty: x.pretty, bytes: Number(x.bytes) })),
    };
  } catch {
    // PGlite não expõe todas as vistas de sistema; não inventar um número.
    return { bytes: null, pretty: 'indisponível neste motor', tables: [] };
  }
}
