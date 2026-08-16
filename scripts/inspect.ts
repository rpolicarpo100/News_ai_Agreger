import {getDb} from '/home/user/gni/src/db/index.js';
const db=await getDb();
console.log('SOURCES:');
console.table(await db.query("SELECT s.id,h.status,h.items_last_run,h.response_ms,SUBSTRING(COALESCE(h.last_error,''),1,40) err FROM source s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY h.status"));
console.log(await db.query("SELECT (SELECT COUNT(*) FROM article) arts,(SELECT COUNT(*) FROM event) evs,(SELECT COUNT(*) FROM event WHERE status='PUBLISHED') pub,(SELECT COUNT(*) FROM review_queue WHERE state='open') rev,(SELECT COUNT(*) FROM conflict) confl,(SELECT COUNT(*) FROM audit_log) audit"));
console.log('TOP EVENTS:');
console.table(await db.query("SELECT e.id,SUBSTRING(e.title,1,45) t,e.category,e.verification,e.article_count ac,e.independent_sources isrc,(SELECT value FROM score WHERE event_id=e.id AND kind='confidence' ORDER BY computed_at DESC LIMIT 1) conf FROM event e WHERE status='PUBLISHED' ORDER BY e.article_count DESC LIMIT 12"));
process.exit(0);
