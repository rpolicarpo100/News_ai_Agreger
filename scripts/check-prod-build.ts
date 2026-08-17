/**
 * Guarda contra uma falha de build que só aparece em produção.
 *
 * O Render corre `npm ci` com NODE_ENV=production, o que salta as
 * devDependencies — e portanto o compilador TypeScript e o @types/node.
 * O build local passava e o de produção falhava com dezenas de erros
 * "Cannot find name 'process'".
 *
 * Este teste garante que o comando de build declarado instala explicitamente
 * as devDependencies.
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const yaml = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');

const problems: string[] = [];

// O tsc tem de estar disponível no build de produção.
const buildCommands = yaml.match(/buildCommand:\s*(.+)/g) ?? [];
if (!buildCommands.length) problems.push('render.yaml não declara buildCommand');
for (const line of buildCommands) {
  if (line.includes('npm ci') && !line.includes('--include=dev') && !line.includes('--production=false')) {
    problems.push(`buildCommand salta devDependencies com NODE_ENV=production: ${line.trim()}`);
  }
}

// O compilador não pode estar só em dependencies por engano nem em falta.
const hasTs = pkg.devDependencies?.typescript || pkg.dependencies?.typescript;
if (!hasTs) problems.push('typescript não está declarado como dependência');
if (!pkg.devDependencies?.['@types/node'] && !pkg.dependencies?.['@types/node']) {
  problems.push('@types/node não está declarado');
}

if (problems.length) {
  console.error('\nPRODUCTION BUILD WOULD FAIL\n        ↓\nDEPLOYMENT BLOCKED\n');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('check:prod-build — OK (o build de produção instala o compilador)');
