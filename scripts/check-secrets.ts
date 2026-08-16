/** Secrets scan (Section 76). Blocks committed credentials. */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsk-[A-Za-z0-9]{24,}\b/, label: 'OpenAI-style API key' },
  { re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/, label: 'Anthropic API key' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/, label: 'GitHub token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /postgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@/, label: 'Postgres URL with inline password' },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: 'private key' },
];
const SKIP = new Set(['node_modules', 'dist', '.git', 'data']);

const findings: string[] = [];
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!['.ts', '.js', '.json', '.yaml', '.yml', '.md', '.env', '.sql', ''].includes(extname(p))) continue;
    if (p.endsWith('check-secrets.ts') || p.endsWith('package-lock.json')) continue;
    const text = readFileSync(p, 'utf8');
    for (const { re, label } of PATTERNS) {
      const m = text.match(re);
      if (m) findings.push(`${p.replace(ROOT, '')} — ${label}`);
    }
  }
}
walk(ROOT);

if (existsSync(join(ROOT, '.env'))) findings.push('.env is present in the working tree — it must never be committed');

if (findings.length) {
  console.error('\nSECRETS DETECTED\n        ↓\nDEPLOYMENT BLOCKED\n');
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
}
console.log('check:secrets — OK (no credentials found in tracked files)');
