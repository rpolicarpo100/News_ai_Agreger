/** Web process entrypoint. */
import { app, bootstrap } from './api/server.js';
import { runIngestion } from './ingestion/ingest.js';
import { runClustering } from './pipeline/cluster.js';
import { runIntelligenceCycle } from './agents/orchestrator.js';
import { guardAgainstTestData } from './core/testguard.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const CYCLE_MIN = Number(process.env.CYCLE_MINUTES ?? 10);
const RUN_WORKER_IN_WEB = process.env.RUN_WORKER_IN_WEB !== 'false';

async function cycle(label: string): Promise<void> {
  try {
    const ing = await runIngestion();
    const cl = await runClustering();
    const cy = await runIntelligenceCycle();
    console.log(`[${label}] ingested=${ing.totalInserted} newEvents=${cl.newEvents} attached=${cl.attached} processed=${cy.length} published=${cy.filter((c) => c.published).length}`);
  } catch (err) {
    // Section 74: log the real failure. Never substitute data.
    console.error(`[${label}] cycle failed:`, err);
  }
}

async function main(): Promise<void> {
  await bootstrap();
  await guardAgainstTestData();

  const server = app.listen(PORT, HOST, () => {
    console.log(`Global News Intelligence listening on http://${HOST}:${PORT}`);
  });

  if (RUN_WORKER_IN_WEB) {
    void cycle('boot');
    setInterval(() => void cycle('scheduled'), CYCLE_MIN * 60_000);
  }

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => { server.close(() => process.exit(0)); });
  }
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
