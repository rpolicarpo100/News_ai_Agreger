/** Standalone worker process (Section 63) — run separately on Render if desired. */
import { migrate } from './db/index.js';
import { registerSources, runIngestion } from './ingestion/ingest.js';
import { runClustering } from './pipeline/cluster.js';
import { runIntelligenceCycle } from './agents/orchestrator.js';
import { buildGraph } from './pipeline/graph.js';

const CYCLE_MIN = Number(process.env.CYCLE_MINUTES ?? 10);
const ONCE = process.argv.includes('--once');

async function cycle(): Promise<void> {
  const t0 = Date.now();
  const ing = await runIngestion();
  const cl = await runClustering();
  const cy = await runIntelligenceCycle();
  const gr = await buildGraph();
  console.log(JSON.stringify({
    at: new Date().toISOString(), ms: Date.now() - t0,
    ingested: ing.totalInserted,
    sources: ing.sources.map((s) => ({ id: s.id, status: s.status, items: s.items, inserted: s.inserted, error: s.error })),
    clustering: cl,
    processed: cy.length, published: cy.filter((c) => c.published).length,
    graph: gr,
    heldForReview: cy.filter((c) => !c.published).map((c) => ({ id: c.eventId, why: c.gate.failures.concat(c.supervisor.decision) })),
  }, null, 2));
}

(async () => {
  await migrate();
  await registerSources();
  await cycle();
  if (ONCE) process.exit(0);
  setInterval(() => { void cycle().catch((e) => console.error('cycle failed:', e)); }, CYCLE_MIN * 60_000);
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
