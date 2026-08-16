import { getDb } from '../src/db/index.js';
const db = await getDb();
await db.query('DELETE FROM event_relation');
console.log('cleared old edges');
process.exit(0);
