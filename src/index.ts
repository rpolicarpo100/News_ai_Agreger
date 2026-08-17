/** Web process entrypoint. */
import { app, bootstrap } from './api/server.js';
import { runIngestion } from './ingestion/ingest.js';
import { runClustering } from './pipeline/cluster.js';
import { runIntelligenceCycle } from './agents/orchestrator.js';
import { buildGraph } from './pipeline/graph.js';
import { runAlerts } from './pipeline/alerts.js';
import { runRetention } from './pipeline/retention.js';
import { guardAgainstTestData } from './core/testguard.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const CYCLE_MIN = Number(process.env.CYCLE_MINUTES ?? 10);
const RUN_WORKER_IN_WEB = process.env.RUN_WORKER_IN_WEB !== 'false';

let lastRetention = 0;
const RETENTION_INTERVAL_MS = Number(process.env.RETENTION_HOURS ?? 24) * 3600e3;

async function cycle(label: string): Promise<void> {
  try {
    const ing = await runIngestion();
    const cl = await runClustering();
    const cy = await runIntelligenceCycle();
    const gr = await buildGraph();
    const al = await runAlerts();

    // Retenção no máximo uma vez por dia: mantém a base dentro do 1 GB do
    // plano gratuito sem apagar proveniência (ver src/pipeline/retention.ts).
    if (Date.now() - lastRetention > RETENTION_INTERVAL_MS) {
      lastRetention = Date.now();
      try {
        const ret = await runRetention();
        console.log(`[${label}] retenção: payloads=${ret.payloadsFreed} runs=${ret.agentRunsRemoved} auditoria=${ret.auditArchived} views=${ret.viewsCompacted} eventos=${ret.staleEventsRemoved}`);
      } catch (e) {
        console.error(`[${label}] retenção falhou:`, e);
      }
    }
    console.log(`[${label}] ingested=${ing.totalInserted} newEvents=${cl.newEvents} attached=${cl.attached} processed=${cy.length} published=${cy.filter((c) => c.published).length} edges=${gr.edges} notifs=${al.notificationsCreated}`);
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
