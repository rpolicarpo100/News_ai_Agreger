/** Local helper: wipe the embedded dev database and run one full pipeline cycle. */
import { rmSync, mkdirSync } from 'node:fs';
const dir = process.env.PGLITE_DIR ?? './data/pgdata';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const { migrate } = await import('../src/db/index.js');
const { registerSources, runIngestion } = await import('../src/ingestion/ingest.js');
const { runClustering } = await import('../src/pipeline/cluster.js');
const { runIntelligenceCycle } = await import('../src/agents/orchestrator.js');
await migrate();
await registerSources();
const ing = await runIngestion();
const cl = await runClustering();
const cy = await runIntelligenceCycle(400);
console.log(JSON.stringify({ ingested: ing.totalInserted, clustering: cl, processed: cy.length, published: cy.filter(c=>c.published).length }, null, 2));
process.exit(0);
