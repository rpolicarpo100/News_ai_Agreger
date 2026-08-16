import { buildGraph } from '../src/pipeline/graph.js';
import { getDb } from '../src/db/index.js';
const r = await buildGraph(200);
console.log('examined:', r.examined, 'edges written:', r.edges);
const db = await getDb();
console.log('\nEDGES BY KIND:');
console.table(await db.query(`SELECT kind, COUNT(*)::int n, ROUND(AVG(strength))::int avg_strength FROM event_relation GROUP BY kind ORDER BY n DESC`));
console.log('\nSTRONGEST RELATIONS:');
const rows = await db.query<any>(`SELECT r.kind, r.strength, r.basis, a.title ta, b.title tb
  FROM event_relation r JOIN event a ON a.id=r.from_event JOIN event b ON b.id=r.to_event
  ORDER BY r.strength DESC LIMIT 8`);
for (const x of rows) {
  console.log(`\n  [${x.kind} ${x.strength}]`);
  console.log(`    A: ${x.ta.slice(0,62)}`);
  console.log(`    B: ${x.tb.slice(0,62)}`);
  console.log(`    ${x.basis.slice(0,110)}`);
}
process.exit(0);
