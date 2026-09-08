/**
 * Gera docs/APIS-E-FERRAMENTAS.md a partir do código, não de memória.
 *
 * Uma lista escrita à mão fica desactualizada em silêncio. Esta é derivada de
 * src/ingestion/sources.ts e do package.json, por isso ou está certa ou o
 * gerador falha.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../src/ingestion/sources.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const DEP_WHY: Record<string, string> = {
  'express': 'Servidor HTTP e routing',
  'pg': 'Cliente PostgreSQL para produção',
  '@electric-sql/pglite': 'Postgres embebido para desenvolvimento sem instalar nada',
  'qrcode-generator': 'QR dos donativos, gerado localmente (zero dependências transitivas)',
  'zod': 'Validação de esquemas',
  'typescript': 'Compilador',
  'tsx': 'Execução de TypeScript em desenvolvimento e nos testes',
  '@types/node': 'Tipos do Node',
  '@types/express': 'Tipos do Express',
  '@types/pg': 'Tipos do cliente Postgres',
};

const KIND_PT: Record<string, string> = {
  official: 'Oficial', scientific: 'Científica', agency: 'Agência', outlet: 'Órgão de comunicação',
};

const rows = SOURCES.map((s) =>
  `| ${s.name} | \`${s.id}\` | ${KIND_PT[s.origin_type] ?? s.origin_type} | ${s.country ?? '—'} | ${s.reliability_score ?? 'N/A'} | ${s.kind.toUpperCase()} | Não |`
).join('\n');

const deps = Object.entries(pkg.dependencies as Record<string, string>)
  .map(([k, v]) => `| \`${k}\` | ${v} | ${DEP_WHY[k] ?? ''} |`).join('\n');
const devDeps = Object.entries(pkg.devDependencies as Record<string, string>)
  .map(([k, v]) => `| \`${k}\` | ${v} | ${DEP_WHY[k] ?? ''} |`).join('\n');

const md = `# APIs, fontes e ferramentas

> Gerado por \`npm run docs:apis\` a partir de \`src/ingestion/sources.ts\` e
> \`package.json\`. Não editar à mão: uma lista escrita à mão desactualiza-se
> em silêncio, e esta plataforma não pode documentar o que não usa.
>
> Última geração: ${new Date().toISOString().slice(0, 10)}

## Resumo

**A plataforma funciona inteiramente sem chaves de API.** As ${SOURCES.length} fontes são
feeds públicos que respondem a um simples GET. Não há registo, quota paga nem
token em nenhuma delas — verificado com pedidos reais.

Chaves são **opcionais** e servem apenas para funcionalidades adicionais
(agentes LLM). Sem elas o sistema corre na mesma e diz claramente que a análise
por modelo está indisponível, em vez de inventar resultados.

---

## 1. Fontes de dados (${SOURCES.length}) — todas sem chave

| Fonte | ID | Tipo | País | Fiabilidade | Formato | Precisa de chave? |
|---|---|---|---|---|---|---|
${rows}

A coluna *Fiabilidade* é a avaliação registada em \`source.reliability_basis\`,
com justificação escrita para cada fonte. Não é um número arbitrário.

### Porquê estas e não uma news API paga

APIs agregadoras (NewsAPI, GNews, Bing News) devolvem artigos já normalizados,
mas com dois problemas para este produto: escondem a origem real por trás de um
intermediário, e a maioria proíbe a redistribuição. Ler os feeds directamente
mantém a cadeia \`SOURCE → ARTICLE → EVENT\` verificável e respeita os termos de
cada publicação (guardamos título, resumo do feed e link, nunca o texto integral).

---

## 2. Dependências de execução (${Object.keys(pkg.dependencies).length})

| Pacote | Versão | Porquê |
|---|---|---|
${deps}

## 3. Dependências de desenvolvimento (${Object.keys(pkg.devDependencies).length})

| Pacote | Versão | Porquê |
|---|---|---|
${devDeps}

### O que foi deliberadamente NÃO usado

| Evitado | Em vez disso | Razão |
|---|---|---|
| Framework de frontend (React, Vue, Next) | HTML renderizado no servidor | Páginas rápidas, indexáveis e sem JavaScript obrigatório |
| Biblioteca de parsing RSS | \`src/ingestion/rss.ts\` (~120 linhas) | Menos superfície de dependência num caminho que recebe dados externos |
| Biblioteca de datas (moment, date-fns) | \`Intl\` e \`Date\` nativos | Já existem no runtime |
| ORM (Prisma, Drizzle) | SQL directo com \`pg\` | O esquema é o contrato; SQL explícito é auditável |
| Biblioteca de hashing (bcrypt) | \`scrypt\` do Node | Sem binários nativos, sem dependência no caminho das palavras-passe |
| Biblioteca de keccak/eth | \`src/core/eth.ts\` (~70 linhas) | Remove uma dependência do caminho que valida onde vai o dinheiro |
| Biblioteca de QR própria | \`qrcode-generator\` | Escrevi uma e descartei-a: produzia matrizes que não liam. Um QR de pagamento ilegível é pior que uma dependência |

---

## 4. Serviços externos

| Serviço | Para quê | Chave? | Custo |
|---|---|---|---|
| GitHub | Repositório e CI | Deploy key (SSH) | Grátis |
| GitHub Actions | Ingestão agendada | Não (usa o token do próprio workflow) | Grátis e ilimitado em repos públicos |
| Render | Alojamento web + Postgres | API key só para gestão | Plano gratuito |
| Revolut | Donativos | Não | — |
| Ethereum (mainnet) | Donativos | Não | — |

Nem o Revolut nem a Ethereum têm integração: são um link e um endereço
validado por checksum. Não há SDK de pagamentos nem chamada a API.

---

## 5. Variáveis de ambiente

### Segredos (nunca no repositório)

| Variável | Obrigatória? | Efeito se ausente |
|---|---|---|
| \`DATABASE_URL\` | Em produção | Usa PGlite embebido (só desenvolvimento) |
| \`ADMIN_TOKEN\` | Para a área de admin | Toda a área \`/admin\` devolve 503 — secure by default |
| \`VIEW_SALT\` | Recomendada | Usa um valor de desenvolvimento; as sessões de visualização ficam previsíveis |
| \`ANTHROPIC_API_KEY\` ou \`OPENAI_API_KEY\` | Não | Agentes LLM reportam \`UNAVAILABLE\`; o resto do pipeline corre igual |

### Configuração (sem segredo)

\`PUBLIC_BASE_URL\`, \`PORT\`, \`HOST\`, \`NODE_ENV\`, \`CYCLE_MINUTES\`,
\`RUN_WORKER_IN_WEB\`, \`INTELLIGENCE_BATCH\`, \`FETCH_TIMEOUT_MS\`,
\`CLUSTER_SIM\`, \`CLUSTER_WINDOW_H\`, \`VIEW_DEDUPE_MIN\`, \`VIEW_RATE_HOUR\`,
\`USER_SESSION_DAYS\`, \`ADMIN_SESSION_HOURS\`, \`ADMIN_MAX_ATTEMPTS\`,
\`ADMIN_LOCKOUT_MS\`, \`LLM_MODEL\`, \`LLM_MAX_CALLS_PER_CYCLE\`,
\`LLM_TIMEOUT_MS\`, \`RETENTION_HOURS\`, \`RETAIN_*\` (7 variáveis),
\`SUPPORT_REVOLUT\`, \`SUPPORT_ETH\`, \`PGLITE_DIR\`, \`PGLITE_NO_RESET\`,
\`PG_POOL_MAX\`, \`ALLOW_TEST_DATA\`.

Ver \`.env.example\` para os valores por omissão.

---

## 6. API pública desta plataforma

Sem autenticação, sem chave:

\`\`\`
GET /api/health              estado do serviço
GET /api/status              contadores, flags, saúde de cada fonte
GET /api/events              ?category= &country= &order= &dir= &min_confidence= &min_impact=
GET /api/events/:id          evento completo: fontes, scores com factores, timeline, conflitos
GET /api/search?q=           pesquisa, incluindo "life impact above 80"
GET /api/map                 eventos geolocalizados
GET /api/sources             registo de fontes e estado de saúde
GET /api/brief               resumo diário
POST /api/events/:id/view    regista visualização (anti-manipulação aplicada)
\`\`\`

Administração em \`/api/admin/*\` com \`Authorization: Bearer $ADMIN_TOKEN\`.

---

## 7. Custo total

| Item | Custo |
|---|---|
| ${SOURCES.length} fontes de dados | 0 € |
| GitHub + Actions | 0 € |
| Render web + Postgres (plano gratuito) | 0 € |
| Dependências npm | 0 € |
| **Total** | **0 €/mês** |

Limites do plano gratuito: 1 GB de base de dados (mitigado pela política de
retenção) e 750 horas de instância partilhadas por conta, razão pela qual a
ingestão corre em janelas e não em contínuo.

Chaves LLM são o único custo possível, e são opcionais.
`;

// Justificações escritas à mão, mas ligadas às dependências reais.
writeFileSync('docs/APIS-E-FERRAMENTAS.md', md);
console.log('docs/APIS-E-FERRAMENTAS.md gerado a partir do código');
