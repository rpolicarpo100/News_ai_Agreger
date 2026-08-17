/** Secrets scan (Section 76). Blocks committed credentials. */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

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

/**
 * A key that git already ignores cannot be committed, so flagging it is a false
 * positive that trains people to ignore this scanner. What matters is whether a
 * secret is TRACKED or would be committed — that is what is checked below.
 */
function isGitIgnored(rel: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const findings: string[] = [];
const ignoredSecrets: string[] = [];
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!['.ts', '.js', '.json', '.yaml', '.yml', '.md', '.env', '.sql', ''].includes(extname(p))) continue;
    if (p.endsWith('check-secrets.ts') || p.endsWith('package-lock.json')) continue;
    const rel = relative(ROOT, p);
    const text = readFileSync(p, 'utf8');
    for (const { re, label } of PATTERNS) {
      if (!re.test(text)) continue;
      if (isGitIgnored(rel)) {
        ignoredSecrets.push(`${rel} — ${label} (ignorado pelo git, não pode ser commitado)`);
      } else {
        findings.push(`${rel} — ${label}`);
      }
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
if (ignoredSecrets.length) {
  console.log('check:secrets — nota: segredos presentes no disco mas fora do controlo de versões:');
  for (const i of ignoredSecrets) console.log('  ' + i);
}
console.log('check:secrets — OK (no credentials found in tracked files)');
