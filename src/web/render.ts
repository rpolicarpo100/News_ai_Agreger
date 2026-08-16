/**
 * Server-rendered UI — Sections 43-56, 73 (accessibility), 60 (SEO).
 *
 * No client framework, no external assets: fast, embeddable, and it degrades
 * gracefully. Every numeric shown is either a stored value or the literal N/A.
 */
import { CATEGORY_LABELS_PT } from '../pipeline/classify.js';

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const CSS = `
:root{
  --bg:#07090d; --bg2:#0c1017; --panel:#11161f; --line:#1e2531; --line2:#2a3342;
  --txt:#e8edf5; --muted:#8b96a8; --dim:#616c7e;
  --acc:#3ddc97; --acc2:#4ea8ff; --warn:#ffb454; --bad:#ff5d6c; --na:#5a6474;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--txt);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--acc2);outline-offset:2px}
.wrap{max-width:1320px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:50;background:rgba(7,9,13,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.topbar{display:flex;align-items:center;gap:18px;height:58px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.brand .dot{width:9px;height:9px;border-radius:50%;background:var(--acc);box-shadow:0 0 12px var(--acc)}
.brand small{display:block;font-size:9px;letter-spacing:.18em;color:var(--dim);font-weight:600;font-family:var(--mono)}
nav.main{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1}
nav.main::-webkit-scrollbar{display:none}
nav.main a{padding:6px 11px;border-radius:7px;font-size:13px;color:var(--muted);white-space:nowrap;transition:.15s}
nav.main a:hover{color:var(--txt);background:var(--panel)}
nav.main a[aria-current=page]{color:var(--acc);background:rgba(61,220,151,.08)}
.searchbox{display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:4px 10px}
.searchbox input{background:none;border:0;color:var(--txt);font-size:13px;width:180px;font-family:var(--sans)}
.searchbox input::placeholder{color:var(--dim)}
h1{font-size:26px;letter-spacing:-.03em;margin:26px 0 4px;font-weight:700}
h2.sec{font-size:11px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase;font-family:var(--mono);margin:30px 0 12px;display:flex;align-items:center;gap:10px}
h2.sec::after{content:"";flex:1;height:1px;background:var(--line)}
h3{font-size:15px;margin:20px 0 8px}
.grid{display:grid;gap:12px}
.g3{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
.g4{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.g2{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
.card{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:9px;transition:.15s}
a.card:hover{border-color:var(--line2);transform:translateY(-1px)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{font-family:var(--mono);font-size:10px;letter-spacing:.06em;padding:2px 7px;border-radius:5px;border:1px solid var(--line2);color:var(--muted);text-transform:uppercase}
.chip.cat{color:var(--acc2);border-color:rgba(78,168,255,.35);background:rgba(78,168,255,.07)}
.chip.FRESH{color:var(--acc);border-color:rgba(61,220,151,.4)}
.chip.RECENT{color:#9fe8c4;border-color:#2a4a3c}
.chip.AGING{color:var(--warn);border-color:rgba(255,180,84,.35)}
.chip.STALE,.chip.EXPIRED{color:var(--bad);border-color:rgba(255,93,108,.35)}
.chip.VERIFIED{color:var(--acc);border-color:rgba(61,220,151,.4);background:rgba(61,220,151,.07)}
.chip.UNCERTAIN{color:var(--warn);border-color:rgba(255,180,84,.35)}
.chip.DISPUTED{color:var(--bad);border-color:rgba(255,93,108,.4);background:rgba(255,93,108,.07)}
.chip.UNVERIFIED{color:var(--na)}
.card h4{margin:0;font-size:15.5px;line-height:1.35;letter-spacing:-.015em;font-weight:600}
.meta{font-size:12px;color:var(--dim);font-family:var(--mono);display:flex;flex-wrap:wrap;gap:10px}
.scores{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;border-top:1px solid var(--line);padding-top:9px;margin-top:auto}
.sc{text-align:center}
.sc .k{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;color:var(--dim);text-transform:uppercase}
.sc .v{font-family:var(--mono);font-size:17px;font-weight:600;letter-spacing:-.02em}
.sc .v.na{color:var(--na);font-size:12px;font-weight:400}
.bar{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin-top:3px}
.bar i{display:block;height:100%;background:var(--acc2)}
.bar.c i{background:var(--acc)} .bar.i i{background:var(--warn)} .bar.t i{background:#c17ce0}
.empty{border:1px dashed var(--line2);border-radius:12px;padding:34px 20px;text-align:center;color:var(--muted);font-family:var(--mono);font-size:12.5px;letter-spacing:.08em}
.empty strong{display:block;color:var(--txt);font-size:14px;letter-spacing:.12em;margin-bottom:7px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.panel h3{margin-top:0}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;padding:7px 8px;border-bottom:1px solid var(--line)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.mono{font-family:var(--mono)}
.small{font-size:12px;color:var(--muted)}
.dim{color:var(--dim)}
details{border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--bg2);margin:8px 0}
summary{cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
summary:hover{color:var(--txt)}
.evhead{border:1px solid var(--line);border-radius:14px;padding:20px;background:linear-gradient(160deg,#101722,#0a0d13)}
.q{border-left:2px solid var(--line2);padding-left:14px;margin:14px 0}
.q h3{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--acc2);text-transform:uppercase;margin:0 0 6px}
ul.clean{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
.src{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line)}
.src:last-child{border-bottom:0}
.rel{font-family:var(--mono);font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid var(--line2);color:var(--muted);flex-shrink:0}
.tl{position:relative;padding-left:18px}
.tl::before{content:"";position:absolute;left:4px;top:4px;bottom:4px;width:1px;background:var(--line2)}
.tl li{position:relative;padding:0 0 12px}
.tl li::before{content:"";position:absolute;left:-18px;top:6px;width:7px;height:7px;border-radius:50%;background:var(--acc2);box-shadow:0 0 0 3px var(--bg)}
.conf{border:1px solid rgba(255,93,108,.35);background:rgba(255,93,108,.05);border-radius:10px;padding:12px;margin:10px 0}
.conf h4{margin:0 0 6px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--bad);text-transform:uppercase}
footer{border-top:1px solid var(--line);margin-top:50px;padding:26px 0 40px;color:var(--dim);font-size:12px}
footer a{color:var(--muted)} footer a:hover{color:var(--txt)}
.pill{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;padding:4px 9px;border-radius:20px;border:1px solid var(--line2);color:var(--muted)}
.pill b{color:var(--txt);font-weight:600}
.ok{color:var(--acc)} .warnc{color:var(--warn)} .badc{color:var(--bad)}
svg.map{width:100%;height:auto;background:#080b10;border:1px solid var(--line);border-radius:12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
@media(max-width:760px){.scores{grid-template-columns:repeat(2,1fr)}.searchbox{display:none}h1{font-size:21px}}
`;

const NAV: Array<[string, string]> = [
  ['/', 'Home'], ['/today', 'Hoje'], ['/breaking', 'Breaking'], ['/trending', 'Trending'],
  ['/most-viewed', 'Mais Vistos'], ['/map', 'Mapa'], ['/category/natural_events', 'Naturais'],
  ['/category/war_conflict', 'Conflito'], ['/category/economy', 'Economia'], ['/category/technology', 'Tecnologia'],
  ['/status', 'Estado'], ['/about', 'Metodologia'],
];

interface LayoutOpts { title: string; description?: string; current?: string; jsonLd?: object; canonical?: string }

function layout(o: LayoutOpts, body: string): string {
  return `<!doctype html><html lang="pt-PT"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)} — Global News Intelligence</title>
<meta name="description" content="${esc(o.description ?? 'Inteligência noticiosa a partir de fontes reais, com proveniência, verificação e auditoria.')}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ''}
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description ?? 'Inteligência noticiosa verificável.')}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='10' fill='%233ddc97'/></svg>">
<style>${CSS}</style>
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body>
<a href="#main" style="position:absolute;left:-9999px" onfocus="this.style.left='10px';this.style.top='10px';this.style.zIndex='99';this.style.background='#11161f';this.style.padding='8px'">Saltar para o conteúdo</a>
<header class="top"><div class="wrap"><div class="topbar">
  <a class="brand" href="/"><span class="dot" aria-hidden="true"></span><span>GLOBAL NEWS<small>INTELLIGENCE</small></span></a>
  <nav class="main" aria-label="Navegação principal">
    ${NAV.map(([h, l]) => `<a href="${h}"${o.current === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
  </nav>
  <form class="searchbox" action="/search" method="get" role="search">
    <span aria-hidden="true" class="dim">⌕</span>
    <label for="q" class="visually-hidden" style="position:absolute;left:-9999px">Pesquisar eventos</label>
    <input id="q" name="q" placeholder="Pesquisar eventos…" autocomplete="off">
  </form>
</div></div></header>
<main id="main"><div class="wrap">${body}</div></main>
<footer><div class="wrap">
  <p><strong>Global News Intelligence</strong> — dados reais, fontes reais, eventos reais, rastreabilidade completa.</p>
  <p class="dim">Esta plataforma não inventa acontecimentos. Quando não existem dados verificados, mostra <span class="mono">NO VERIFIED DATA AVAILABLE</span>. Quando as fontes divergem, mostra o conflito. Quando um score não pode ser calculado, mostra <span class="mono">N/A</span>.</p>
  <p><a href="/about">Metodologia</a> · <a href="/status">Estado do sistema</a> · <a href="/api/events">API</a> · <a href="/support">☕ Apoiar</a> · <a href="/sitemap.xml">Sitemap</a></p>
</div></footer></body></html>`;
}

function scoreCell(label: string, value: number | null | undefined, cls: string): string {
  const na = value === null || value === undefined;
  return `<div class="sc"><div class="k">${label}</div>
    <div class="v${na ? ' na' : ''}">${na ? 'N/A' : value}</div>
    <div class="bar ${cls}"><i style="width:${na ? 0 : value}%"></i></div></div>`;
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

function section(title: string, events: any[], emptyMsg = 'NO VERIFIED DATA AVAILABLE', cls = 'g3'): string {
  return `<h2 class="sec">${esc(title)}</h2>` + (events.length
    ? `<div class="grid ${cls}">${events.map(eventCard).join('')}</div>`
    : `<div class="empty"><strong>${esc(emptyMsg)}</strong>Nenhum evento publicado nesta secção neste momento. Nada é gerado para preencher o espaço.</div>`);
}

// ---------------------------------------------------------------- HOME
export function renderHome(d: any): string {
  const s = d.status;
  const online = s.sources.filter((x: any) => x.status === 'online').length;
  const pulse = `<div class="panel" style="margin-top:18px">
    <h3 style="margin:0 0 4px">Global Situation</h3>
    <p class="small dim" style="margin:0 0 12px">Contadores directos da base de dados. Não é um índice científico.</p>
    <div class="chips">
      <span class="pill">Eventos publicados <b>${s.counts.published}</b></span>
      <span class="pill">Artigos ingeridos <b>${s.counts.articles}</b></span>
      <span class="pill">Fontes online <b class="${online === s.sources.length ? 'ok' : 'warnc'}">${online}/${s.sources.length}</b></span>
      <span class="pill">Conflitos abertos <b class="${s.counts.conflicts ? 'badc' : ''}">${s.counts.conflicts}</b></span>
      <span class="pill">Em revisão humana <b>${s.counts.review_open}</b></span>
      <span class="pill">Registos de auditoria <b>${s.counts.audit_entries}</b></span>
    </div></div>`;

  return layout({ title: 'Home', current: '/' }, `
  <h1>O que está a acontecer</h1>
  <p class="small dim">Eventos construídos a partir de artigos de fontes reais, agrupados, verificados e pontuados. Cada número desta página tem origem rastreável.</p>
  ${pulse}
  ${section('Breaking — últimas 12h', d.breaking)}
  ${section('Top Stories', d.top)}
  ${section('Trending Now', d.trending, 'SEM ACTIVIDADE REAL REGISTADA')}
  ${section('Eventos Naturais', d.natural, 'NO VERIFIED DATA AVAILABLE', 'g4')}
  ${section('Guerra e Conflito', d.conflict, 'NO VERIFIED DATA AVAILABLE', 'g4')}
  ${section('Economia', d.economy, 'NO VERIFIED DATA AVAILABLE', 'g4')}
  ${section('Tecnologia', d.tech, 'NO VERIFIED DATA AVAILABLE', 'g4')}
  `);
}

// ---------------------------------------------------------------- LIST
export function renderList(o: { title: string; events: any[]; note?: string; grouped?: boolean }): string {
  const body = o.events.length
    ? `<div class="grid g3">${o.events.map(eventCard).join('')}</div>`
    : `<div class="empty"><strong>NO VERIFIED DATA AVAILABLE</strong>${esc(o.note ?? 'Não existem eventos publicados que correspondam a este filtro.')}</div>`;
  return layout({ title: o.title }, `<h1>${esc(o.title)}</h1>
    ${o.note && o.events.length ? `<p class="small dim">${esc(o.note)}</p>` : ''}
    <div style="margin-top:16px">${body}</div>`);
}

// ---------------------------------------------------------------- EVENT
export function renderEvent(d: any): string {
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

  const agentRuns = d.agent_runs.length
    ? `<table><thead><tr><th>Agente</th><th>Versão</th><th>Modo</th><th>Estado</th><th>Conf.</th><th>ms</th></tr></thead><tbody>
       ${d.agent_runs.map((r: any) => `<tr><td class="mono">${esc(r.agent)}</td><td class="mono dim">${esc(r.agent_version)}</td><td class="mono dim">${esc(r.mode)}</td><td class="mono ${r.status === 'ok' ? 'ok' : 'warnc'}">${esc(r.status)}</td><td class="mono">${r.confidence ?? 'N/A'}</td><td class="mono dim">${esc(r.duration_ms)}</td></tr>`).join('')}
       </tbody></table><p class="small dim">Nenhum modelo LLM foi utilizado: todos os agentes activos são determinísticos e reproduzíveis.</p>`
    : '<p class="small dim">Sem execuções de agentes registadas.</p>';

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: e.title,
    datePublished: e.published_at, dateModified: e.last_activity_at,
    identifier: e.id, articleSection: e.category_label,
    isBasedOn: d.articles.map((a: any) => a.url),
  };

  return layout({ title: e.title, description: `${e.category_label} · ${e.place ?? ''} · ${d.articles.length} fontes ligadas.`, jsonLd }, `
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
        ${d.related.length ? `<ul class="clean">${d.related.map((r: any) => `<li class="small"><a href="/event/${esc(r.id)}/${esc(r.slug)}">${esc(r.title)}</a><br><span class="dim mono">${esc(r.category)} · ${esc(r.country ?? '—')}</span></li>`).join('')}</ul>` : '<p class="small dim">Nenhum evento relacionado publicado.</p>'}
      </div>

      <div class="panel">
        <h3>Partilhar</h3>
        <p class="small dim">Ligação canónica deste evento (o ID é permanente mesmo que o título mude):</p>
        <p class="mono small" style="word-break:break-all">${esc(e.url)}</p>
      </div>
    </div>
  </div>`);
}

// ---------------------------------------------------------------- MAP
export function renderMap(points: any[]): string {
  const proj = (lat: number, lon: number) => [(lon + 180) * (1000 / 360), (90 - lat) * (500 / 180)];
  const dots = points.map((p) => {
    const [x, y] = proj(Number(p.lat), Number(p.lon));
    const color = p.category === 'natural_events' ? '#3ddc97' : p.category === 'war_conflict' ? '#ff5d6c' : p.category === 'economy' ? '#ffb454' : '#4ea8ff';
    const approx = p.geo_precision === 'approximate';
    return `<a href="/event/${esc(p.id)}/${esc(p.slug)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${approx ? 6 : 4}" fill="${color}" fill-opacity="${approx ? 0.25 : 0.85}" stroke="${color}" stroke-width="1"><title>${esc(p.title)} — ${esc(p.place ?? p.country ?? '')}${approx ? ' (APPROXIMATE LOCATION)' : ''}</title></circle></a>`;
  }).join('');
  const grid = Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="1000" y2="${i * 50}" stroke="#141a24"/>`).join('')
    + Array.from({ length: 19 }, (_, i) => `<line x1="${i * 55.5}" y1="0" x2="${i * 55.5}" y2="500" stroke="#141a24"/>`).join('');
  return layout({ title: 'Mapa', current: '/map' }, `<h1>Mapa de eventos</h1>
    <p class="small dim">Projecção equirectangular simples. Pontos sólidos = coordenadas reportadas pela fonte. Pontos esbatidos e maiores = <span class="mono">APPROXIMATE LOCATION</span> (centróide de gazetteer). Só são mostrados eventos publicados com coordenadas.</p>
    ${points.length ? `<svg class="map" viewBox="0 0 1000 500" role="img" aria-label="Mapa mundial de eventos publicados">
      <rect width="1000" height="500" fill="#080b10"/>${grid}
      <line x1="0" y1="250" x2="1000" y2="250" stroke="#233040"/><line x1="500" y1="0" x2="500" y2="500" stroke="#233040"/>
      ${dots}</svg>
      <p class="small dim" style="margin-top:10px">${points.length} ponto(s).</p>`
    : `<div class="empty" style="margin-top:16px"><strong>NO VERIFIED DATA AVAILABLE</strong>Nenhum evento publicado possui coordenadas.</div>`}`);
}

// ---------------------------------------------------------------- STATUS
export function renderStatus(s: any): string {
  return layout({ title: 'Estado do sistema', current: '/status' }, `<h1>Estado do sistema</h1>
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
export function renderAbout(): string {
  return layout({ title: 'Metodologia', current: '/about' }, `<h1>Metodologia</h1>
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

export function renderSupport(): string {
  return layout({ title: 'Apoiar', current: '/support' }, `<h1>☕ Pay for a coffee</h1>
  <div class="panel" style="margin-top:16px">
    <p class="small">Ainda não estão configurados dados de pagamento nesta instalação.</p>
    <div class="empty"><strong>NO PAYMENT DETAILS CONFIGURED</strong>Revolut e endereço Ethereum serão apresentados aqui quando forem fornecidos pelo operador e definidos em variáveis de ambiente. Nenhum endereço é inventado.</div>
    <p class="small dim">Donativos nunca influenciam ranking, visibilidade, relevance, confidence, trending ou decisões editoriais.</p>
  </div>`);
}
