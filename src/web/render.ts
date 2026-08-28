/**
 * Server-rendered UI — Sections 43-56, 73 (accessibility), 60 (SEO).
 *
 * No client framework, no external assets: fast, embeddable, and it degrades
 * gracefully. Every numeric shown is either a stored value or the literal N/A.
 */
import { CATEGORY_LABELS_PT } from '../pipeline/classify.js';
import { translator, type Lang, type Theme, type Translator } from './i18n.js';

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const CSS = `
/* Tema escuro (omissão). Contrastes verificados contra --panel, o fundo mais
   claro do tema. WCAG AA exige 4.5 para texto normal. */
:root, [data-theme="dark"]{
  --bg:#0a0e14; --bg2:#0f141c; --panel:#141a24; --line:#2a3340; --line2:#3a4553;
  --txt:#f2f5fa;      /* 16.0 */
  --muted:#aab4c6;    /*  8.4 */
  --dim:#8f99ab;      /*  6.1 */
  --na:#909aac;       /*  6.2 */
  --acc:#4ee7a5; --acc2:#6cb8ff; --warn:#ffc069; --bad:#ff7b87;
  --shadow:rgba(0,0,0,.45);
  --on-acc:#07090d;   /* texto sobre fundo --acc */
}

/* Tema claro.
   A primeira versão cumpria o mínimo AA mas lia-se mal, por duas razões que o
   teste de contraste mínimo não apanha:

   1. Painel branco sobre fundo quase branco dava 1.07 de contraste entre
      superfícies — os cartões praticamente desapareciam. O fundo foi
      escurecido para #e2e7ef, o que dá 1.24 e faz o branco destacar-se.
   2. Texto a 17.8 sobre branco causa halation: em fundo claro o excesso de
      contraste faz o texto parecer vibrar e cansa em leitura longa. Baixado
      para 13.2, dentro da faixa confortável de 12–15.

   Todas as cores foram validadas sobre as TRÊS superfícies (panel, bg, bg2),
   não apenas sobre branco, e o texto branco sobre cada acento passa 7.0. */
[data-theme="light"]{
  --bg:#e2e7ef; --bg2:#eef2f7; --panel:#ffffff; --line:#ccd5e0; --line2:#a9b5c6;
  --txt:#26313d;      /* 13.2 sobre branco — legível sem vibrar */
  --muted:#4a5768;    /*  7.4 */
  --dim:#5b6878;      /*  5.7 */
  --na:#5b6878;       /*  5.7 */
  --acc:#06663f;      /*  7.1 — branco por cima passa 7.05 */
  --acc2:#0a55ab;     /*  7.2 */
  --warn:#7a5000;     /*  7.1 */
  --bad:#ab2130;      /*  7.0 */
  --shadow:rgba(20,35,60,.10);
  --on-acc:#ffffff;
}
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--txt);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.q a,.panel a,footer a,.small a{text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line2)}
.q a:hover,.panel a:hover,footer a:hover{text-decoration-color:var(--acc2);color:var(--acc2)}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--acc2);outline-offset:2px}
.wrap{max-width:1320px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:50;background:var(--bg);border-bottom:1px solid var(--line)}
.topbar{display:flex;align-items:center;gap:18px;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.brand .dot{width:9px;height:9px;border-radius:50%;background:var(--acc);box-shadow:0 0 12px var(--acc)}
.brand small{display:block;font-size:10px;letter-spacing:.16em;color:var(--dim);font-weight:600;font-family:var(--mono)}
nav.main{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1}
nav.main::-webkit-scrollbar{display:none}
nav.main a{padding:7px 12px;border-radius:7px;font-size:14px;color:var(--muted);white-space:nowrap;transition:.15s}
nav.main a:hover{color:var(--txt);background:var(--panel)}
nav.main a[aria-current=page]{color:var(--acc);background:rgba(78,231,165,.1)}
nav.main details.more{position:relative;border:0;padding:0;margin:0;background:none}
nav.main details.more>summary{list-style:none;padding:7px 12px;border-radius:7px;font-size:14px;
  color:var(--muted);cursor:pointer;white-space:nowrap;font-family:var(--sans);letter-spacing:0;text-transform:none}
nav.main details.more>summary::-webkit-details-marker{display:none}
nav.main details.more>summary:hover{color:var(--txt);background:var(--panel)}
nav.main details.more[open]>summary{color:var(--acc);background:var(--panel)}
.more-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:210px;background:var(--panel);
  border:1px solid var(--line2);border-radius:11px;padding:7px;display:flex;flex-direction:column;gap:2px;
  box-shadow:0 12px 32px var(--shadow);z-index:60}
.more-menu a{padding:8px 11px;border-radius:7px;font-size:14px;color:var(--muted);white-space:nowrap}
.more-menu a:hover{background:var(--bg2);color:var(--txt)}
.searchbox{display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:4px 10px}
.searchbox input{background:none;border:0;color:var(--txt);font-size:14px;width:190px;font-family:var(--sans)}
.searchbox input::placeholder{color:var(--dim)}
.switches{display:flex;align-items:center;gap:6px;flex-shrink:0}
.switch{display:inline-flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.switch a{padding:5px 9px;font-family:var(--mono);font-size:11.5px;color:var(--dim);
  background:var(--bg2);text-decoration:none;transition:.15s;letter-spacing:.03em}
.switch a:hover{color:var(--txt);background:var(--panel);text-decoration:none}
.switch a[aria-current=true]{background:var(--acc);color:var(--on-acc);font-weight:700}
.themebtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;
  border:1px solid var(--line2);border-radius:8px;background:var(--bg2);color:var(--muted);
  font-size:15px;text-decoration:none;transition:.15s}
.themebtn:hover{border-color:var(--acc2);color:var(--acc2);text-decoration:none}
@media(max-width:900px){.switches .switch{display:none}}
.sortbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;
  border-bottom:1px solid var(--line);margin-bottom:4px}
.sortbar .lbl{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;color:var(--dim);
  text-transform:uppercase;white-space:nowrap}
.sortbar .opts{display:flex;gap:6px;flex-wrap:wrap}
.sortbar a{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:8px;
  border:1px solid var(--line2);background:var(--bg2);color:var(--muted);font-size:13.5px;
  white-space:nowrap;text-decoration:none;transition:.15s}
.sortbar a:hover{border-color:var(--acc2);color:var(--acc2);text-decoration:none}
.sortbar a[aria-current=true]{border-color:var(--acc);color:var(--acc);
  background:rgba(78,231,165,.1);font-weight:600}
.sortbar .arrow{font-family:var(--mono);font-size:12px;opacity:.9}
.sortbar .hint{font-size:12.5px;color:var(--dim);margin-left:auto}
@media(max-width:760px){.sortbar .hint{display:none}.sortbar .lbl{width:100%}}
h1{font-size:30px;letter-spacing:-.02em;margin:28px 0 6px;font-weight:700;line-height:1.2}
h2.sec{font-size:12.5px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase;font-family:var(--mono);margin:30px 0 12px;display:flex;align-items:center;gap:10px}
h2.sec{color:var(--muted)}
h2.sec::before{content:"";width:3px;height:14px;background:var(--acc);border-radius:2px}
h2.sec::after{content:"";flex:1;height:1px;background:var(--line2)}
h3{font-size:16.5px;margin:22px 0 9px}
.grid{display:grid;gap:16px}
.g3{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
.g4{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.g2{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;
  display:flex;flex-direction:column;gap:11px;transition:.15s}
[data-theme="light"] .card{box-shadow:0 1px 3px var(--shadow)}
[data-theme="light"] .panel{box-shadow:0 1px 3px var(--shadow)}
[data-theme="light"] .evhead{box-shadow:0 2px 8px var(--shadow)}
/* O cabeçalho fixo precisa de se separar do conteúdo que passa por baixo. */
[data-theme="light"] header.top{box-shadow:0 1px 4px var(--shadow)}
a.card:hover{border-color:var(--acc2);transform:translateY(-2px);box-shadow:0 6px 24px var(--shadow)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{font-family:var(--mono);font-size:11.5px;letter-spacing:.05em;padding:3px 8px;border-radius:5px;
  border:1px solid var(--line2);color:var(--muted);text-transform:uppercase}
[data-theme="light"] .chip{background:var(--bg2)}
.chip.cat{color:var(--acc2);border-color:rgba(78,168,255,.35);background:rgba(78,168,255,.07)}
.chip.FRESH{color:var(--acc);border-color:rgba(61,220,151,.4)}
.chip.RECENT{color:#9fe8c4;border-color:#2a4a3c}
.chip.AGING{color:var(--warn);border-color:rgba(255,180,84,.35)}
.chip.STALE,.chip.EXPIRED{color:var(--bad);border-color:rgba(255,93,108,.35)}
.chip.VERIFIED{color:var(--acc);border-color:rgba(61,220,151,.4);background:rgba(61,220,151,.07)}
.chip.UNCERTAIN{color:var(--warn);border-color:rgba(255,180,84,.35)}
.chip.DISPUTED{color:var(--bad);border-color:rgba(255,93,108,.4);background:rgba(255,93,108,.07)}
.chip.UNVERIFIED{color:var(--na)}
.card h4{margin:0;font-size:17px;line-height:1.4;letter-spacing:-.015em;font-weight:600}
.meta{font-size:13px;color:var(--dim);font-family:var(--mono);display:flex;flex-wrap:wrap;gap:10px}
.scores{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:1px solid var(--line2);padding-top:12px;margin-top:auto}
.sc{text-align:center}
.sc .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;color:var(--dim);text-transform:uppercase}
.sc .v{font-family:var(--mono);font-size:21px;font-weight:700;letter-spacing:-.02em}
.sc .v.na{color:var(--na);font-size:14px;font-weight:500}
.bar{height:4px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:5px}
.bar i{display:block;height:100%;background:var(--acc2)}
.bar.c i{background:var(--acc)} .bar.i i{background:var(--warn)} .bar.t i{background:#d094ee}
.bar.empty-bar{background:repeating-linear-gradient(90deg,var(--line2) 0 3px,transparent 3px 7px)}
.sc .v{min-height:26px;display:flex;align-items:center;justify-content:center}
.empty{border:1px dashed var(--line2);border-radius:12px;padding:34px 20px;text-align:center;color:var(--muted);font-family:var(--mono);font-size:14px;letter-spacing:.05em}
.empty strong{display:block;color:var(--txt);font-size:16px;letter-spacing:.1em;margin-bottom:9px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px}
.panel h3{margin-top:0}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;color:var(--dim);text-transform:uppercase;padding:7px 8px;border-bottom:1px solid var(--line)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.mono{font-family:var(--mono)}
.small{font-size:13.5px;color:var(--muted)}
.dim{color:var(--dim)}
details{border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--bg2);margin:8px 0}
summary{cursor:pointer;font-family:var(--mono);font-size:12.5px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
summary:hover{color:var(--txt)}
.evhead{border:1px solid var(--line);border-radius:14px;padding:20px;background:var(--panel)}
.q{border-left:2px solid var(--line2);padding-left:14px;margin:14px 0}
.q h3{font-family:var(--mono);font-size:12.5px;letter-spacing:.12em;color:var(--acc2);text-transform:uppercase;margin:0 0 6px}
ul.clean{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
.src{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line)}
.src:last-child{border-bottom:0}
.rel{font-family:var(--mono);font-size:12.5px;padding:3px 8px;border-radius:4px;border:1px solid var(--line2);color:var(--muted);flex-shrink:0}
.tl{position:relative;padding-left:18px}
.tl::before{content:"";position:absolute;left:4px;top:4px;bottom:4px;width:1px;background:var(--line2)}
.tl li{position:relative;padding:0 0 12px}
.tl li::before{content:"";position:absolute;left:-19px;top:7px;width:9px;height:9px;border-radius:50%;background:var(--acc2);box-shadow:0 0 0 3px var(--bg)}
.conf{border:1px solid rgba(255,93,108,.35);background:rgba(255,93,108,.05);border-radius:10px;padding:12px;margin:10px 0}
.conf h4{margin:0 0 7px;font-family:var(--mono);font-size:12.5px;letter-spacing:.1em;color:var(--bad);text-transform:uppercase}
footer{border-top:1px solid var(--line);margin-top:50px;padding:28px 0 44px;color:var(--muted);font-size:13.5px}
footer a{color:var(--muted)} footer a:hover{color:var(--txt)}
.pill{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12.5px;padding:5px 11px;border-radius:20px;border:1px solid var(--line2);color:var(--muted)}
.pill b{color:var(--txt);font-weight:600}
.ok{color:var(--acc)} .warnc{color:var(--warn)} .badc{color:var(--bad)}
svg.map{width:100%;height:auto;background:var(--bg2);border:1px solid var(--line);border-radius:12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
@media(max-width:760px){.scores{grid-template-columns:repeat(2,1fr)}.searchbox{display:none}h1{font-size:21px}}
`;

/** Navegação principal — só o que cabe sem cortar. */
const NAV: Array<[string, string]> = [
  ['/', 'nav.home'], ['/today', 'nav.today'], ['/breaking', 'nav.breaking'], ['/trending', 'nav.trending'],
  ['/map', 'nav.map'], ['/brief', 'nav.brief'], ['/my', 'nav.my'],
];

/** Secundária: categorias e páginas de contexto, num menu que não corta. */
const NAV_MORE: Array<[string, string]> = [
  ['/most-viewed', 'nav.mostViewed'],
  ['/category/natural_events', 'natural_events'],
  ['/category/war_conflict', 'war_conflict'],
  ['/category/politics', 'politics'],
  ['/category/economy', 'economy'],
  ['/category/technology', 'technology'],
  ['/category/health', 'health'],
  ['/category/science', 'science'],
  ['/status', 'nav.status'],
  ['/about', 'nav.about'],
];

export interface LayoutOpts {
  title: string; description?: string; current?: string; jsonLd?: object;
  canonical?: string; extraCss?: string;
  /** Idioma e tema vêm do pedido; se ausentes usa-se o padrão. */
  lang?: Lang; theme?: Theme;
  /** Caminho actual, para os selectores preservarem a página. */
  path?: string;
}

/** Shared shell so every page (public, account, admin-adjacent) looks identical. */
export function pageShell(o: LayoutOpts & { body: string }): string {
  return layout(o, o.body);
}

/** Preferências de apresentação vindas do pedido. */
export interface Prefs { lang: Lang; theme: Theme; path: string }
export const DEFAULT_PREFS: Prefs = { lang: 'pt', theme: 'dark', path: '/' };

/** Constrói o URL da página actual trocando um parâmetro. */
function withParam(path: string, key: string, value: string): string {
  const [base, qs] = (path || '/').split('?');
  const params = new URLSearchParams(qs ?? '');
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

function layout(o: LayoutOpts, body: string): string {
  const t = translator(o.lang ?? 'pt');
  const theme: Theme = o.theme ?? 'dark';
  const path = o.path ?? '/';
  const htmlLang = t.lang === 'pt' ? 'pt-PT' : 'en';
  return `<!doctype html><html lang="${htmlLang}" data-theme="${theme}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)} — Global News Intelligence</title>
<meta name="description" content="${esc(o.description ?? 'Inteligência noticiosa a partir de fontes reais, com proveniência, verificação e auditoria.')}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ''}
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description ?? 'Inteligência noticiosa verificável.')}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='10' fill='%233ddc97'/></svg>">
<style>${CSS}${o.extraCss ?? ''}</style>
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body>
<a href="#main" style="position:absolute;left:-9999px" onfocus="this.style.left='10px';this.style.top='10px';this.style.zIndex='99';this.style.background='var(--panel)';this.style.padding='8px'">${esc(t('nav.skip'))}</a>
<header class="top"><div class="wrap"><div class="topbar">
  <a class="brand" href="/"><span class="dot" aria-hidden="true"></span><span>GLOBAL NEWS<small>INTELLIGENCE</small></span></a>
  <nav class="main" aria-label="${esc(t('nav.mainLabel'))}">
    ${NAV.map(([h, k]) => `<a href="${h}"${o.current === h ? ' aria-current="page"' : ''}>${esc(t(k))}</a>`).join('')}
    <details class="more">
      <summary aria-label="${esc(t('nav.moreLabel'))}">${esc(t('nav.more'))} ▾</summary>
      <div class="more-menu">
        ${NAV_MORE.map(([h, k]) => `<a href="${h}"${o.current === h ? ' aria-current="page"' : ''}>${esc(k.startsWith('nav.') ? t(k) : t.cat(k))}</a>`).join('')}
      </div>
    </details>
  </nav>
  <div class="switches">
    <div class="switch" role="group" aria-label="${esc(t('ui.language'))}">
      <a href="${esc(withParam(path, 'lang', 'pt'))}" aria-current="${t.lang === 'pt'}" hreflang="pt" title="Português">PT</a>
      <a href="${esc(withParam(path, 'lang', 'en'))}" aria-current="${t.lang === 'en'}" hreflang="en" title="English">EN</a>
    </div>
    <a class="themebtn" href="${esc(withParam(path, 'theme', theme === 'dark' ? 'light' : 'dark'))}"
       title="${esc(theme === 'dark' ? t('ui.themeToggle') : t('ui.themeToggleDark'))}"
       aria-label="${esc(theme === 'dark' ? t('ui.themeToggle') : t('ui.themeToggleDark'))}">${theme === 'dark' ? '☀' : '☾'}</a>
  </div>
  <form class="searchbox" action="/search" method="get" role="search">
    <span aria-hidden="true" class="dim">⌕</span>
    <label for="q" style="position:absolute;left:-9999px">${esc(t('nav.searchLabel'))}</label>
    <input id="q" name="q" placeholder="${esc(t('nav.search'))}" autocomplete="off">
    <input type="hidden" name="lang" value="${esc(t.lang)}">
  </form>
</div></div></header>
<main id="main"><div class="wrap">${body}</div></main>
<footer><div class="wrap">
  <p><strong>Global News Intelligence</strong> — ${esc(t('foot.tagline'))}</p>
  <p class="dim">${esc(t('foot.disclaimer'))}</p>
  <p><a href="/about">${esc(t('foot.method'))}</a> · <a href="/status">${esc(t('foot.status'))}</a> · <a href="/api/events">${esc(t('foot.api'))}</a> · <a href="/support" style="color:var(--acc)">${esc(t('foot.support'))}</a> · <a href="/sitemap.xml">${esc(t('foot.sitemap'))}</a></p>
</div></footer></body></html>`;
}

function scoreCell(label: string, value: number | null | undefined, cls: string): string {
  // N/A tem de ser visualmente inconfundível com 0: um zero é um resultado
  // calculado, N/A é ausência de dados suficientes (§21). Por isso o N/A não
  // desenha barra nenhuma — desenha um traço.
  const na = value === null || value === undefined;
  return `<div class="sc"><div class="k">${label}</div>
    <div class="v${na ? ' na' : ''}" ${na ? 'title="Dados insuficientes para calcular este score"' : ''}>${na ? 'N/A' : value}</div>
    ${na
      ? '<div class="bar empty-bar" aria-hidden="true"></div>'
      : `<div class="bar ${cls}"><i style="width:${value}%"></i></div>`}
    </div>`;
}

/**
 * Barra de ordenação (§52 filtros).
 *
 * Cada opção alterna a direcção quando já está activa, para que "maior" e
 * "menor" sejam alcançáveis num só clique. São links normais, não JavaScript:
 * funcionam sem scripts, são partilháveis e indexáveis.
 *
 * Nota sobre N/A: eventos cujo score não pôde ser calculado ficam no fim em
 * ambas as direcções. Um N/A não é zero — é ausência de dados (§21) — por isso
 * nunca encabeça uma ordenação crescente.
 */
export function sortBar(o: { path: string; order?: string; dir?: string; query?: Record<string, string>; lang?: Lang }): string {
  const t = translator(o.lang ?? 'pt');
  const current = o.order ?? 'recent';
  const dir = o.dir === 'asc' ? 'asc' : 'desc';
  const opts: Array<[string, string]> = [
    ['recent', t('sort.recent')],
    ['life_impact', t('sort.impact')],
    ['confidence', t('sort.confidence')],
    ['relevance', t('sort.relevance')],
  ];
  // 'impact' é o nome interno; 'life_impact' é o que aparece no URL.
  const apiName = (k: string) => (k === 'life_impact' ? 'impact' : k);

  const link = (key: string, label: string) => {
    const active = apiName(key) === apiName(current);
    // Clicar no critério activo inverte a direcção; noutro, começa em desc.
    const nextDir = active && dir === 'desc' ? 'asc' : 'desc';
    const params = new URLSearchParams({ ...(o.query ?? {}) });
    params.set('order', key);
    if (nextDir === 'asc') params.set('dir', 'asc'); else params.delete('dir');
    const arrow = key === 'recent'
      ? (active && dir === 'asc' ? '↑' : '↓')
      : (active ? (dir === 'desc' ? `↓ ${t('sort.desc')}` : `↑ ${t('sort.asc')}`) : '↓');
    return `<a href="${esc(o.path)}?${esc(params.toString())}" aria-current="${active}"
      title="${esc(active ? (dir === 'desc' ? t('sort.tipDesc') : t('sort.tipAsc')) : `${t('sort.tipSet')} ${label}`)}">
      ${esc(label)} <span class="arrow">${arrow}</span></a>`;
  };

  return `<nav class="sortbar" aria-label="Ordenar resultados">
    <span class="lbl">${esc(t('sort.by'))}</span>
    <span class="opts">${opts.map(([k, l]) => link(k, l)).join('')}</span>
    <span class="hint">${esc(t('sort.naHint'))}</span>
  </nav>`;
}

export function eventCard(e: any): string {
  return `<a class="card" href="${esc(e.url)}">
  <div class="chips">
    <span class="chip cat">${esc(e.category_label ?? e.category)}</span>
    <span class="chip ${esc(e.verification)}">${esc(e.verification)}</span>
    <span class="chip ${esc(e.freshness)}">${esc(e.freshness)}</span>
    ${e.country ? `<span class="chip">${esc(e.country)}</span>` : ''}
  </div>
  <h4>${esc(e.title)}</h4>
  <div class="meta">
    <span>${esc(e.place ?? 'Localização não indicada')}</span>
    <span>${esc(e.article_count)} artigo(s) · ${esc(e.independent_sources)} grupo(s)</span>
    <span>${esc(e.views_total ?? 0)} views</span>
    <span>${esc(e.updated_label)}</span>
  </div>
  <div class="scores">
    ${scoreCell('Relevance', e.relevance, '')}
    ${scoreCell('Confidence', e.confidence, 'c')}
    ${scoreCell('Life Impact', e.life_impact, 'i')}
    ${scoreCell('Trending', e.trending, 't')}
  </div></a>`;
}

function section(title: string, events: any[], t: Translator, emptyMsg?: string, cls = 'g3'): string {
  return `<h2 class="sec">${esc(title)}</h2>` + (events.length
    ? `<div class="grid ${cls}">${events.map(eventCard).join('')}</div>`
    : `<div class="empty"><strong>${esc(emptyMsg ?? t('empty.noData'))}</strong>${esc(t('empty.noDataSection'))}</div>`);
}

// ---------------------------------------------------------------- HOME
export function renderHome(d: any, prefs: Prefs = DEFAULT_PREFS): string {
  const t = translator(prefs.lang);
  const s = d.status;
  const online = s.sources.filter((x: any) => x.status === 'online').length;
  const pulse = `<div class="panel" style="margin-top:18px">
    <h3 style="margin:0 0 4px">${esc(t('home.situation'))}</h3>
    <p class="small dim" style="margin:0 0 12px">${esc(t('home.situationSub'))}</p>
    <div class="chips">
      <span class="pill">${esc(t('count.published'))} <b>${s.counts.published}</b></span>
      <span class="pill">${esc(t('count.articles'))} <b>${s.counts.articles}</b></span>
      <span class="pill">${esc(t('count.sourcesOnline'))} <b class="${online === s.sources.length ? 'ok' : 'warnc'}">${online}/${s.sources.length}</b></span>
      <span class="pill">${esc(t('count.conflicts'))} <b class="${s.counts.conflicts ? 'badc' : ''}">${s.counts.conflicts}</b></span>
      <span class="pill">${esc(t('count.review'))} <b>${s.counts.review_open}</b></span>
      <span class="pill">${esc(t('count.audit'))} <b>${s.counts.audit_entries}</b></span>
    </div></div>`;

  return layout({ title: t('home.title'), current: '/', ...prefs }, `
  <h1>${esc(t('home.title'))}</h1>
  <p class="small dim">${esc(t('home.sub'))}</p>
  ${sortBar({ path: '/events', order: 'recent', lang: prefs.lang })}
  ${pulse}
  ${section(t('home.breaking'), d.breaking, t)}
  ${section(t('home.top'), d.top, t)}
  ${section(t('home.trending'), d.trending, t, t('empty.noActivity'))}
  ${section(t('home.natural'), d.natural, t, undefined, 'g4')}
  ${section(t('home.conflict'), d.conflict, t, undefined, 'g4')}
  ${section(t('home.economy'), d.economy, t, undefined, 'g4')}
  ${section(t('home.tech'), d.tech, t, undefined, 'g4')}
  `);
}

// ---------------------------------------------------------------- LIST
export function renderList(o: {
  title: string; events: any[]; note?: string; grouped?: boolean;
  sort?: { path: string; order?: string; dir?: string; query?: Record<string, string>; lang?: Lang };
  current?: string;
  prefs?: Prefs;
}): string {
  const body = o.events.length
    ? `<div class="grid g3">${o.events.map(eventCard).join('')}</div>`
    : `<div class="empty"><strong>${esc(translator((o.prefs ?? DEFAULT_PREFS).lang)('empty.noData'))}</strong>${esc(o.note ?? translator((o.prefs ?? DEFAULT_PREFS).lang)('empty.noFilter'))}</div>`;
  return layout({ title: o.title, current: o.current, ...(o.prefs ?? DEFAULT_PREFS) }, `<h1>${esc(o.title)}</h1>
    ${o.note && o.events.length ? `<p class="small dim">${esc(o.note)}</p>` : ''}
    ${o.sort ? sortBar(o.sort) : ''}
    <div style="margin-top:16px">${body}</div>`);
}

// ---------------------------------------------------------------- EVENT
export function renderEvent(d: any, viewer?: { csrf: string; following: boolean; bookmarked: boolean }, prefs: Prefs = DEFAULT_PREFS): string {
  const t = translator(prefs.lang);
  const e = d.event;
  const score = (k: string) => d.scores.find((s: any) => s.kind === k);
  const val = (k: string) => { const s = score(k); return s ? s.value : null; };

  const whyBlock = (k: string, label: string) => {
    const s = score(k);
    if (!s) return '';
    let parsed: any = {};
    try { parsed = JSON.parse(s.factors); } catch { /* stored value unreadable: show nothing rather than guess */ }
    const rows = (parsed.factors ?? []).map((f: any) =>
      `<tr><td class="mono">${esc(f.factor)}</td><td class="mono dim">${esc(f.input)}</td><td class="mono" style="text-align:right">${f.contribution >= 0 ? '+' : ''}${esc(f.contribution)}</td></tr>`).join('');
    return `<details><summary>Why this score? — ${esc(label)} = ${s.value === null ? 'N/A' : s.value}</summary>
      ${parsed.unavailableReason ? `<p class="small">Não calculável: ${esc(parsed.unavailableReason)}</p>` : ''}
      ${rows ? `<table><thead><tr><th>Factor</th><th>Input</th><th style="text-align:right">Contrib.</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      <p class="small dim" style="margin-bottom:0">Fórmula ${esc(s.formula_ver)} · calculado ${esc(new Date(s.computed_at).toISOString())}</p></details>`;
  };

  const measurements = (() => {
    if (!e.measurements) return '';
    let m: any; try { m = JSON.parse(e.measurements); } catch { return ''; }
    const rows = Object.entries(m).filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `<tr><td class="mono dim">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('');
    if (!rows) return '';
    return `<div class="panel" style="margin:14px 0"><h3>Medições da fonte</h3>
      <p class="small dim">Valores copiados literalmente do fornecedor. Nenhum é estimado.</p>
      <table><tbody>${rows}</tbody></table></div>`;
  })();

  const conflicts = d.conflicts.length ? d.conflicts.map((c: any) => {
    let vals: any[] = []; try { vals = JSON.parse(c.detail); } catch { /* ignore */ }
    return `<div class="conf"><h4>Source conflict — ${esc(c.field)}</h4>
      <ul class="clean">${vals.map((v) => `<li class="small"><span class="mono">${esc(v.value)}</span> — <a href="${esc(v.url)}" rel="noopener nofollow" target="_blank">${esc(v.source)}</a></li>`).join('')}</ul>
      <p class="small dim" style="margin:8px 0 0">O sistema mostra a divergência e não escolhe um valor.</p></div>`;
  }).join('') : `<p class="small dim">Nenhuma contradição numérica detectada entre as fontes ligadas.</p>`;

  const known = d.articles.filter((a: any) => a.origin_type === 'official' || a.origin_type === 'scientific');
  const changes = d.score_changes.length
    ? `<ul class="clean">${d.score_changes.map((c: any) =>
        `<li class="small"><span class="mono">${esc(c.kind)}</span> <span class="mono dim">${c.old_value ?? 'N/A'} → ${c.new_value ?? 'N/A'}</span><br><span class="dim">${esc(c.reason)}</span></li>`).join('')}</ul>`
    : `<p class="small dim">Sem alterações de score registadas desde a primeira publicação.</p>`;

  const supervisorFindings = (() => {
    if (!d.supervisor) return '<p class="small dim">Ainda não revisto pelo supervisor.</p>';
    let f: any[] = []; try { f = JSON.parse(d.supervisor.findings); } catch { /* ignore */ }
    return `<p class="small">Decisão: <span class="mono ${d.supervisor.decision === 'APPROVE' ? 'ok' : 'warnc'}">${esc(d.supervisor.decision)}</span></p>
      <table><thead><tr><th>Verificação</th><th>Resultado</th><th>Detalhe</th></tr></thead><tbody>
      ${f.map((x) => `<tr><td class="mono">${esc(x.check)}</td><td class="mono ${x.pass ? 'ok' : x.severity === 'blocking' ? 'badc' : 'warnc'}">${x.pass ? 'PASS' : 'FAIL'}</td><td class="small dim">${esc(x.detail)}</td></tr>`).join('')}
      </tbody></table>`;
  })();

  const usedLlm = d.agent_runs.some((r: any) => r.mode === 'llm' && r.status === 'ok');
  const agentRuns = d.agent_runs.length
    ? `<table><thead><tr><th>Agente</th><th>Versão</th><th>Modo</th><th>Modelo</th><th>Estado</th><th>Conf.</th><th>ms</th></tr></thead><tbody>
       ${d.agent_runs.map((r: any) => `<tr><td class="mono">${esc(r.agent)}</td><td class="mono dim">${esc(r.agent_version)}</td><td class="mono dim">${esc(r.mode)}</td><td class="mono dim">${esc(r.model ? `${r.model}:${r.model_version ?? ''}` : '—')}</td><td class="mono ${r.status === 'ok' ? 'ok' : r.status === 'blocked' ? 'badc' : 'warnc'}">${esc(r.status)}</td><td class="mono">${r.confidence ?? 'N/A'}</td><td class="mono dim">${esc(r.duration_ms)}</td></tr>`).join('')}
       </tbody></table>
       <p class="small dim">${usedLlm
         ? 'Um modelo de linguagem foi utilizado apenas para extrair estrutura. Cada citação foi verificada como presente, palavra por palavra, no artigo citado; o que não foi verificável foi descartado. O modelo não escreve factos.'
         : 'Nenhum modelo LLM produziu resultados para este evento: todos os agentes utilizados são determinísticos e reproduzíveis.'}</p>`
    : '<p class="small dim">Sem execuções de agentes registadas.</p>';

  // Verified LLM extractions, shown with their quotes so the reader can check them.
  const llmRun = d.agent_runs.find((r: any) => r.agent === 'llm_extraction' && r.status === 'ok');
  let llmBlock = '';
  if (llmRun) {
    try {
      const out = JSON.parse(llmRun.output).output;
      const byKind: Record<string, string[]> = {};
      for (const c of out.claims ?? []) (byKind[c.kind] ??= []).push(c.quote);
      const rows = Object.entries(byKind).map(([kind, quotes]) =>
        `<li class="small"><span class="chip">${esc(kind)}</span><ul class="clean" style="margin-top:5px">
          ${quotes.slice(0, 4).map((q) => `<li class="small dim">“${esc(q)}”</li>`).join('')}</ul></li>`).join('');
      llmBlock = `<div class="q"><h3>Afirmações extraídas e verificadas</h3>
        <ul class="clean">${rows}</ul>
        ${out.unknowns?.length ? `<p class="small dim" style="margin-top:10px">Por estabelecer, segundo as próprias fontes: ${out.unknowns.map((u: string) => esc(u)).join('; ')}</p>` : ''}
        <p class="small dim">${esc(out.grounding.kept)}/${esc(out.grounding.proposed)} afirmações passaram a verificação literal. ${out.grounding.dropped.length ? `${out.grounding.dropped.length} descartada(s) por não constarem do artigo citado.` : ''}</p>
      </div>`;
    } catch { /* unreadable stored output: show nothing rather than guess */ }
  }

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: e.title,
    datePublished: e.published_at, dateModified: e.last_activity_at,
    identifier: e.id, articleSection: e.category_label,
    isBasedOn: d.articles.map((a: any) => a.url),
  };

  return layout({ title: e.title, description: `${e.category_label} · ${e.place ?? ''} · ${d.articles.length} sources.`, jsonLd, ...prefs }, `
  <div class="evhead" style="margin-top:22px">
    <div class="chips">
      <span class="chip cat">${esc(e.category_label)}</span>
      <span class="chip ${esc(e.verification)}">${esc(e.verification)}</span>
      <span class="chip ${esc(e.freshness)}">${esc(e.freshness)}</span>
      <span class="chip">${esc(e.status)}</span>
      <span class="chip">${esc(e.id)}</span>
    </div>
    <h1 style="margin:12px 0 8px">${esc(e.title)}</h1>
    <div class="meta">
      <span>${esc(e.place ?? 'Localização não indicada')}${e.country ? ` (${esc(e.country)})` : ''}</span>
      ${e.geo_precision === 'approximate' ? '<span class="warnc">APPROXIMATE LOCATION</span>' : ''}
      <span>${d.views.total} views</span>
      <span>Actualizado ${esc(e.updated_label)}</span>
      <span>Last verified ${e.last_verified_at ? esc(new Date(e.last_verified_at).toISOString()) : 'nunca'}</span>
    </div>
    <div class="scores" style="margin-top:14px;grid-template-columns:repeat(6,1fr)">
      ${scoreCell('Relevance', val('relevance'), '')}
      ${scoreCell('Confidence', val('confidence'), 'c')}
      ${scoreCell('Life Impact', val('life_impact'), 'i')}
      ${scoreCell('Trending', val('trending'), 't')}
      ${scoreCell('Evidence', val('evidence_strength'), '')}
      ${scoreCell('Src Reliab.', val('source_reliability'), 'c')}
    </div>
    ${whyBlock('confidence', 'Confidence')}${whyBlock('relevance', 'Relevance')}${whyBlock('life_impact', 'Life Impact')}${whyBlock('trending', 'Trending')}${whyBlock('evidence_strength', 'Evidence Strength')}
  </div>

  <div class="grid g2" style="margin-top:20px;align-items:start">
    <div>
      <div class="q"><h3>What happened?</h3>
        <p>${esc(d.articles[0]?.summary ?? d.articles[0]?.title ?? 'Sem resumo fornecido pela fonte.')}</p>
        <p class="small dim">Texto proveniente do resumo publicado pela fonte <strong>${esc(d.articles[0]?.source_name ?? '—')}</strong>. A plataforma não gera prosa factual nova.</p>
      </div>

      <div class="q"><h3>What we know</h3>
        ${known.length
          ? `<ul class="clean">${known.map((a: any) => `<li class="small">✓ ${esc(a.title)} — <a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(a.source_name)}</a> <span class="chip">${esc(a.origin_type)}</span></li>`).join('')}</ul>`
          : '<p class="small dim">Nenhuma fonte oficial ou científica primária está ligada a este evento. Tudo o que se segue é cobertura editorial.</p>'}
      </div>

      <div class="q"><h3>What we don't know</h3>
        <ul class="clean small">
          ${d.source_agreement.independent_publisher_groups < 2 ? '<li>• Não existe confirmação independente: todas as fontes pertencem ao mesmo grupo editorial.</li>' : ''}
          ${!known.length ? '<li>• Não existe fonte primária/oficial ligada.</li>' : ''}
          ${d.conflicts.length ? '<li>• Existem valores contraditórios entre fontes (ver conflitos).</li>' : ''}
          ${!e.lat ? '<li>• Coordenadas exactas não reportadas pelas fontes.</li>' : ''}
          ${!d.articles.every((a: any) => a.published_at) ? '<li>• Nem todos os artigos ligados têm timestamp de publicação.</li>' : ''}
          <li>• Consequências futuras: não afirmadas. Ver cenários abaixo.</li>
        </ul>
      </div>

      <div class="q"><h3>Why does it matter?</h3>
        <p class="small">Life Impact ${val('life_impact') ?? 'N/A'}/100, derivado da categoria (${esc(e.category_label)}), das medições reportadas e da amplitude geográfica da cobertura. Ver "Why this score?" acima para a decomposição completa.</p>
      </div>

      ${llmBlock}

      <div class="q"><h3>What changed?</h3>${changes}</div>

      <div class="q"><h3>Source conflict</h3>${conflicts}</div>

      <div class="q"><h3>What happens next?</h3>
        <p class="small">A plataforma não emite previsões. O evento continua monitorizado: novas peças das fontes ligadas são anexadas automaticamente e os scores recalculados, com o histórico preservado em "What changed?".</p>
      </div>
    </div>

    <div>
      ${measurements}
      <div class="panel" style="margin-bottom:14px">
        <h3>Fontes (${d.articles.length})</h3>
        <p class="small dim">${esc(d.source_agreement.note)}</p>
        ${d.articles.map((a: any) => `<div class="src">
          <span class="rel">${a.reliability_score ?? 'N/A'}</span>
          <div style="flex:1;min-width:0">
            <a href="${esc(a.url)}" target="_blank" rel="noopener nofollow"><strong style="font-size:13.5px">${esc(a.title)}</strong></a>
            <div class="meta" style="margin-top:3px"><span>${esc(a.source_name)}</span><span class="chip">${esc(a.origin_type)}</span><span>${a.published_at ? esc(new Date(a.published_at).toISOString().slice(0, 16).replace('T', ' ')) : 'sem timestamp'}</span></div>
          </div></div>`).join('')}
        <details><summary>Independência das fontes</summary>
          <ul class="clean small">${d.source_agreement.groups.map((g: any) => `<li><span class="mono">${esc(g.group)}</span> — ${esc(g.sources.join(', '))}</li>`).join('')}</ul>
          <p class="small dim">Fontes do mesmo grupo editorial contam como uma única confirmação.</p>
        </details>
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h3>Timeline</h3>
        ${d.timeline.length ? `<ul class="clean tl">${d.timeline.map((t: any) => `<li><div class="mono small dim">${esc(new Date(t.at).toISOString().replace('T', ' ').slice(0, 16))}</div><div class="small">${esc(t.label)}</div><div class="small dim">${esc(t.source_name ?? '')}</div></li>`).join('')}</ul>` : '<p class="small dim">Sem entradas.</p>'}
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h3>Verificação e auditoria</h3>
        ${supervisorFindings}
        <details><summary>Execuções de agentes (AI versioning)</summary>${agentRuns}</details>
        <details><summary>Histórico de estados</summary>
          <ul class="clean small">${d.state_history.map((h: any) => `<li><span class="mono dim">${esc(new Date(h.at).toISOString().slice(0, 16).replace('T', ' '))}</span> <span class="mono">${esc(h.from_state ?? '—')} → ${esc(h.to_state)}</span><br><span class="dim">${esc(h.actor)}: ${esc(h.reason)}</span></li>`).join('')}</ul>
        </details>
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h3>Eventos relacionados</h3>
        ${d.related.length ? `
          <p class="small dim">Relações detectadas a partir de evidência partilhada. Cada ligação indica o tipo e a razão. Co-ocorrência não implica causalidade.</p>
          <ul class="clean">${d.related.map((r: any) => `<li style="padding:9px 0;border-bottom:1px solid var(--line)">
            <div class="chips" style="margin-bottom:4px">
              <span class="chip cat">${esc(r.kind_label ?? r.kind)}</span>
              <span class="chip">força ${esc(r.strength)}</span>
            </div>
            <a href="/event/${esc(r.id)}/${esc(r.slug)}" class="small"><strong>${esc(r.title)}</strong></a>
            <div class="small dim" style="margin-top:3px">${esc(r.basis)}</div>
          </li>`).join('')}</ul>`
        : '<p class="small dim">Nenhuma relação com evidência partilhada foi detectada. Não são apresentadas ligações especulativas.</p>'}
      </div>

      <div class="panel">
        <h3>Acompanhar</h3>
        ${viewer ? `
          <form method="post" action="/my/follow" style="display:inline">
            <input type="hidden" name="_csrf" value="${esc(viewer.csrf)}">
            <input type="hidden" name="kind" value="event">
            <input type="hidden" name="value" value="${esc(e.id)}">
            <input type="hidden" name="action" value="${viewer.following ? 'unfollow' : 'follow'}">
            <button type="submit" style="background:var(--bg2);border:1px solid ${viewer.following ? 'rgba(61,220,151,.45)' : 'var(--line2)'};color:${viewer.following ? 'var(--acc)' : 'var(--muted)'};border-radius:20px;padding:6px 13px;font-size:12px;font-family:var(--mono);cursor:pointer">
              ${viewer.following ? '✓ A seguir' : '+ Seguir evento'}
            </button>
          </form>
          <form method="post" action="/my/bookmark" style="display:inline">
            <input type="hidden" name="_csrf" value="${esc(viewer.csrf)}">
            <input type="hidden" name="event_id" value="${esc(e.id)}">
            <button type="submit" style="background:var(--bg2);border:1px solid ${viewer.bookmarked ? 'rgba(78,168,255,.45)' : 'var(--line2)'};color:${viewer.bookmarked ? 'var(--acc2)' : 'var(--muted)'};border-radius:20px;padding:6px 13px;font-size:12px;font-family:var(--mono);cursor:pointer">
              ${viewer.bookmarked ? '✓ Guardado' : '☆ Guardar'}
            </button>
          </form>`
        : `<p class="small dim" style="margin:0"><a href="/account/login?next=${encodeURIComponent(e.url)}">Entre</a> ou <a href="/account/register">crie uma conta</a> para seguir este evento e recebê-lo no seu feed pessoal.</p>`}
        <h3 style="margin-top:16px">Partilhar</h3>
        <p class="small dim">Ligação canónica deste evento (o ID é permanente mesmo que o título mude):</p>
        <p class="mono small" style="word-break:break-all">${esc(e.url)}</p>
      </div>
    </div>
  </div>`);
}

// ---------------------------------------------------------------- MAP
export function renderMap(points: any[], prefs: Prefs = DEFAULT_PREFS): string {
  const proj = (lat: number, lon: number) => [(lon + 180) * (1000 / 360), (90 - lat) * (500 / 180)];
  const dots = points.map((p) => {
    const [x, y] = proj(Number(p.lat), Number(p.lon));
    const color = p.category === 'natural_events' ? '#3ddc97' : p.category === 'war_conflict' ? '#ff5d6c' : p.category === 'economy' ? '#ffb454' : '#4ea8ff';
    const approx = p.geo_precision === 'approximate';
    return `<a href="/event/${esc(p.id)}/${esc(p.slug)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${approx ? 6 : 4}" fill="${color}" fill-opacity="${approx ? 0.25 : 0.85}" stroke="${color}" stroke-width="1"><title>${esc(p.title)} — ${esc(p.place ?? p.country ?? '')}${approx ? ' (APPROXIMATE LOCATION)' : ''}</title></circle></a>`;
  }).join('');
  const grid = Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="1000" y2="${i * 50}" stroke="#141a24"/>`).join('')
    + Array.from({ length: 19 }, (_, i) => `<line x1="${i * 55.5}" y1="0" x2="${i * 55.5}" y2="500" stroke="#141a24"/>`).join('');
  return layout({ title: 'Mapa', current: '/map', ...prefs }, `<h1>Mapa de eventos</h1>
    <p class="small dim">Projecção equirectangular simples. Pontos sólidos = coordenadas reportadas pela fonte. Pontos esbatidos e maiores = <span class="mono">APPROXIMATE LOCATION</span> (centróide de gazetteer). Só são mostrados eventos publicados com coordenadas.</p>
    ${points.length ? `<svg class="map" viewBox="0 0 1000 500" role="img" aria-label="Mapa mundial de eventos publicados">
      <rect width="1000" height="500" fill="#080b10"/>${grid}
      <line x1="0" y1="250" x2="1000" y2="250" stroke="#233040"/><line x1="500" y1="0" x2="500" y2="500" stroke="#233040"/>
      ${dots}</svg>
      <p class="small dim" style="margin-top:10px">${points.length} ponto(s).</p>`
    : `<div class="empty" style="margin-top:16px"><strong>NO VERIFIED DATA AVAILABLE</strong>Nenhum evento publicado possui coordenadas.</div>`}`);
}

// ---------------------------------------------------------------- STATUS
export function renderStatus(s: any, prefs: Prefs = DEFAULT_PREFS): string {
  return layout({ title: 'Estado do sistema', current: '/status', ...prefs }, `<h1>Estado do sistema</h1>
  <p class="small dim">Estado real, sem mascarar falhas. Se uma fonte estiver offline é isso que aparece — não é substituída por dados inventados.</p>
  <div class="panel" style="margin-top:16px"><h3>Contadores</h3><div class="chips">
    ${Object.entries(s.counts).map(([k, v]) => `<span class="pill">${esc(k)} <b>${esc(v)}</b></span>`).join('')}
  </div></div>
  <div class="panel" style="margin-top:14px"><h3>Controlo de emergência (flags)</h3><div class="chips">
    ${Object.entries(s.flags).map(([k, v]) => `<span class="pill">${esc(k)} <b class="${v === 'on' || v === 'no' ? 'ok' : 'warnc'}">${esc(v)}</b></span>`).join('')}
  </div><p class="small dim" style="margin-bottom:0">Alteráveis apenas via API de administração autenticada; todas as alterações são auditadas.</p></div>
  <div class="panel" style="margin-top:14px"><h3>Análise AI</h3><p class="small">${esc(s.ai_analysis)}</p></div>
  <div class="panel" style="margin-top:14px"><h3>Saúde das fontes</h3>
    <table><thead><tr><th>Fonte</th><th>Estado</th><th>Último sucesso</th><th>Itens</th><th>ms</th><th>Erro</th></tr></thead><tbody>
    ${s.sources.map((x: any) => `<tr><td>${esc(x.name)}</td>
      <td class="mono ${x.status === 'online' ? 'ok' : x.status === 'degraded' ? 'warnc' : 'badc'}">${esc(x.status ?? 'unknown')}</td>
      <td class="mono dim">${x.last_success_at ? esc(new Date(x.last_success_at).toISOString().slice(0, 16).replace('T', ' ')) : '—'}</td>
      <td class="mono">${esc(x.items_last_run ?? '—')}</td><td class="mono dim">${esc(x.response_ms ?? '—')}</td>
      <td class="small badc">${esc(x.last_error ?? '')}</td></tr>`).join('')}
    </tbody></table></div>`);
}

// ---------------------------------------------------------------- ABOUT
export function renderAbout(prefs: Prefs = DEFAULT_PREFS): string {
  return layout({ title: 'Metodologia', current: '/about', ...prefs }, `<h1>Metodologia</h1>
  <div class="panel" style="margin-top:16px">
    <h3>O que esta plataforma faz</h3>
    <p class="small">Recolhe artigos de feeds públicos de fontes reais, normaliza-os, agrupa-os em <strong>eventos</strong> com identificador permanente, cruza as fontes, deteca contradições, calcula scores explicáveis e regista tudo num registo de auditoria imutável.</p>
    <h3>O que esta plataforma nunca faz</h3>
    <ul class="clean small">
      <li>• Não escreve factos novos. Os resumos apresentados são os das próprias fontes.</li>
      <li>• Não inventa números, coordenadas, citações, fontes ou eventos.</li>
      <li>• Não gera scores aleatórios: cada score tem uma decomposição de factores visível.</li>
      <li>• Não mostra "LIVE" nem "Trending" sem actividade real contada.</li>
      <li>• Não esconde falhas: fontes offline aparecem como offline.</li>
    </ul>
    <h3>Pipeline</h3>
    <p class="mono small">INGESTION → NORMALIZATION → CLASSIFICATION → EVENT DETECTION → CLUSTERING → SPECIALIST AGENTS → VERIFICATION → SUPERVISOR → SCORING → QUALITY GATE → AUDIT → PUBLISH</p>
    <h3>Confiança da fonte ≠ confiança do evento</h3>
    <p class="small">Uma fonte altamente fiável pode reportar informação ainda por confirmar. Por isso <span class="mono">source_reliability</span> e <span class="mono">confidence</span> são dimensões separadas e nunca são somadas.</p>
    <h3>Direitos de autor</h3>
    <p class="small">São armazenados título, resumo fornecido pelo feed e ligação para o original. O texto integral dos artigos não é copiado nem republicado.</p>
    <h3>Privacidade</h3>
    <p class="small">Não são guardados endereços IP. As sessões são identificadas por um hash salgado que roda a cada 24 horas, usado apenas para impedir contagem duplicada de visualizações.</p>
  </div>`);
}

const SUPPORT_CSS = `
.pay{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:16px}
.pay .card2{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;
  display:flex;flex-direction:column;gap:12px}
.pay h3{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}
.qr{background:#fff;border-radius:10px;padding:10px;align-self:center;line-height:0}
.addr{display:flex;gap:8px;align-items:stretch}
.addr code{flex:1;background:var(--bg2);border:1px solid var(--line2);border-radius:8px;
  padding:9px 11px;font-family:var(--mono);font-size:11.5px;word-break:break-all;color:var(--txt);line-height:1.45}
.copy{background:var(--bg2);border:1px solid var(--line2);color:var(--muted);border-radius:8px;
  padding:0 13px;font-size:12px;font-family:var(--mono);cursor:pointer;white-space:nowrap}
.copy:hover{border-color:var(--acc);color:var(--acc)}
.paylink{display:inline-block;background:var(--acc);color:var(--on-acc);border-radius:8px;padding:10px 16px;
  font-weight:700;font-size:14px;text-align:center}
.paylink:hover{opacity:.9}
.verified{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;color:var(--acc);
  border:1px solid rgba(61,220,151,.35);border-radius:5px;padding:2px 7px}
`;

export function renderSupport(cfg: {
  configured: boolean;
  methods: Array<{ id: string; label: string; value: string; href?: string; note: string; qrSvg: string; problem?: string }>;
  problems: string[];
}, prefs: Prefs = DEFAULT_PREFS): string {
  const cards = cfg.methods.map((m) => `
    <div class="card2">
      <h3>${m.id === 'revolut' ? '💳' : 'Ξ'} ${esc(m.label)}
        ${m.id === 'ethereum' && !m.problem ? '<span class="verified" title="Checksum EIP-55 verificado">EIP-55 ✓</span>' : ''}
      </h3>
      <div class="qr">${m.qrSvg}</div>
      ${m.href
        ? `<a class="paylink" href="${esc(m.href)}" target="_blank" rel="noopener">Abrir ${esc(m.label)} →</a>`
        : ''}
      <div class="addr">
        <code id="val-${esc(m.id)}">${esc(m.value)}</code>
        <button class="copy" type="button" data-copy="${esc(m.id)}">Copiar</button>
      </div>
      <p class="small dim" style="margin:0">${esc(m.note)}</p>
      ${m.problem ? `<p class="small warnc" style="margin:0">Nota: ${esc(m.problem)}</p>` : ''}
    </div>`).join('');

  const body = cfg.configured
    ? `<div class="pay">${cards}</div>`
    : `<div class="empty" style="margin-top:16px"><strong>NO PAYMENT DETAILS CONFIGURED</strong>Nenhum método de pagamento válido está configurado nesta instalação. Nenhum endereço é inventado.</div>`;

  return layout({
    title: 'Apoiar',
    current: '/support',
    extraCss: SUPPORT_CSS,
    ...prefs,
    description: 'Apoie o Global News Intelligence. Os donativos não influenciam ranking, relevância, confiança nem decisões editoriais.',
  }, `<h1>☕ Pay for a coffee</h1>
  <p class="small dim" style="max-width:62ch">Esta plataforma não tem publicidade, não vende dados e não aceita conteúdo patrocinado. Se lhe for útil, pode contribuir para os custos de infraestrutura.</p>

  ${cfg.problems.length ? `<div class="empty" style="margin-top:14px;border-color:rgba(255,93,108,.4);color:var(--bad)">
    <strong>MÉTODO DE PAGAMENTO REJEITADO</strong>
    ${cfg.problems.map((p) => esc(p)).join('<br>')}
  </div>` : ''}

  ${body}

  <h2 class="sec">Independência</h2>
  <div class="panel">
    <p class="small" style="margin-top:0">Um donativo <strong>não</strong> influencia:</p>
    <ul class="clean small" style="margin-bottom:12px">
      <li>• ranking, visibilidade ou ordenação de eventos;</li>
      <li>• relevance, confidence, life impact, trending ou qualquer score;</li>
      <li>• o que é publicado, verificado ou apresentado como facto;</li>
      <li>• a fila de revisão humana ou as decisões editoriais.</li>
    </ul>
    <p class="small dim" style="margin:0">Isto não é apenas uma política: no código, nenhum módulo de scoring, ranking ou publicação importa ou consegue aceder à configuração de pagamentos. Não existe caminho técnico entre um donativo e o que vê no site.</p>
  </div>

  <h2 class="sec">Antes de enviar</h2>
  <div class="panel">
    <ul class="clean small" style="margin:0">
      <li>• <strong>Verifique o endereço.</strong> Compare os primeiros e últimos caracteres com os apresentados acima. Transacções em blockchain são irreversíveis.</li>
      <li>• <strong>Verifique a rede.</strong> O endereço Ethereum é para a mainnet. Fundos enviados noutra rede podem perder-se.</li>
      <li>• Os QR codes são gerados neste servidor, não por um serviço externo, e o endereço Ethereum é validado pelo checksum EIP-55 antes de ser apresentado.</li>
      <li>• Não é emitido recibo nem factura. Isto é um donativo, não uma compra.</li>
    </ul>
  </div>

  <script>
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = document.getElementById('val-' + b.dataset.copy);
      if (!el) return;
      var text = el.textContent || '';
      var done = function () { var o = b.textContent; b.textContent = 'Copiado ✓'; setTimeout(function () { b.textContent = o; }, 1600); };
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done); }
      else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
             try { document.execCommand('copy'); done(); } finally { document.body.removeChild(t); } }
    });
  });
  </script>`);
}
