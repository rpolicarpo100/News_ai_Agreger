/** Apply schema.sql to the configured database. Idempotent (IF NOT EXISTS). */
import { migrate, getDb } from '../src/db/index.js';
await migrate();
const db = await getDb();
const t = await db.query<any>(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
console.log(`migrated (${db.driver}); ${t.length} tables:`);
console.log('  ' + t.map((x: any) => x.table_name).join(', '));
process.exit(0);
