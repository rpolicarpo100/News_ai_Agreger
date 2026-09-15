/**
 * Quality gate (Sections 3, 76): fail the build if synthetic-data patterns
 * appear in shipped source. Runs before deploy in CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath (e não .pathname): corre no Windows também — .pathname devolve
// "/D:/..." e mantém %20 por decodificar, partindo o scan fora do Linux.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src'];
const BAD_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\bMath\.random\s*\(/g, why: 'randomness must never feed data, scores or metrics' },
  { re: /\bfaker[.\s]/gi, why: 'fake-data library reference' },
  { re: /\b(mockEvents|fakeEvents|sampleEvents|dummyData|seedFakeData|generateFakeNews|placeholderEvents)\b/g, why: 'synthetic dataset symbol' },
  { re: /lorem ipsum/gi, why: 'placeholder copy' },
  { re: /https?:\/\/(www\.)?example\.(com|org|net)/gi, why: 'placeholder URL presented as a source' },
];

let failures: string[] = [];

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== 'dist') walk(p); continue; }
    if (!['.ts', '.tsx', '.js', '.mjs'].includes(extname(p))) continue;
    const text = readFileSync(p, 'utf8');
    for (const { re, why } of BAD_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split('\n').length;
        const context = text.split('\n')[line - 1] ?? '';
        // Allow the pattern list itself and explanatory comments.
        if (p.endsWith('check-no-test-data.ts')) continue;
        if (/^\s*(\*|\/\/)/.test(context)) continue;
        failures.push(`${p.replace(ROOT, '')}:${line}  ${m[0]}  — ${why}`);
      }
    }
  }
}

for (const d of SCAN_DIRS) walk(join(ROOT, d));

if (failures.length) {
  console.error('\nTEST DATA DETECTED IN PRODUCTION\n        ↓\nDEPLOYMENT BLOCKED\n');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('check:testdata — OK (no synthetic-data patterns in shipped source)');
