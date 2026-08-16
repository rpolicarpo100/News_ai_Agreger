/**
 * Admin Control Center UI — §68, §69, §41.
 *
 * Server-rendered, no client framework, no inline secrets. Every mutating
 * control is a POST form carrying a CSRF token and a mandatory reason field,
 * because §34 requires a reason on every audited change.
 */
import { esc } from './render.js';

const CSS = `
:root{--bg:#07090d;--panel:#11161f;--bg2:#0c1017;--line:#1e2531;--line2:#2a3342;
--txt:#e8edf5;--muted:#8b96a8;--dim:#616c7e;--acc:#3ddc97;--acc2:#4ea8ff;--warn:#ffb454;--bad:#ff5d6c;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Inter,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-family:var(--sans);font-size:14.5px;line-height:1.55}
a{color:var(--acc2);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--acc2);outline-offset:2px}
.wrap{max-width:1280px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line);background:var(--bg2);position:sticky;top:0;z-index:10}
.topbar{display:flex;align-items:center;gap:16px;height:56px}
.brand{font-weight:700;letter-spacing:-.02em;color:var(--txt)}
.brand .tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--bad);border:1px solid var(--bad);
  padding:2px 6px;border-radius:4px;margin-left:8px;vertical-align:middle}
nav{display:flex;gap:2px;flex:1;overflow-x:auto}
nav a{padding:6px 11px;border-radius:7px;font-size:13px;color:var(--muted);white-space:nowrap}
nav a:hover{background:var(--panel);color:var(--txt);text-decoration:none}
nav a[aria-current=page]{color:var(--acc);background:rgba(61,220,151,.08)}
h1{font-size:23px;letter-spacing:-.03em;margin:24px 0 6px}
h2{font-size:11px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase;font-family:var(--mono);
  margin:26px 0 10px;display:flex;align-items:center;gap:10px}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
h3{font-size:14.5px;margin:0 0 10px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:15px;margin-bottom:14px}
.grid{display:grid;gap:12px}
.g2{grid-template-columns:repeat(auto-fit,minmax(360px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--dim);
  text-transform:uppercase;padding:7px 8px;border-bottom:1px solid var(--line2)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.mono{font-family:var(--mono)}
.small{font-size:12px}.dim{color:var(--dim)}.muted{color:var(--muted)}
.ok{color:var(--acc)}.warnc{color:var(--warn)}.badc{color:var(--bad)}
input,select,textarea{background:var(--bg2);border:1px solid var(--line2);color:var(--txt);
  border-radius:7px;padding:7px 9px;font-family:var(--sans);font-size:13px;width:100%}
input[type=submit],button{width:auto;cursor:pointer;font-weight:600}
button{background:var(--bg2);border:1px solid var(--line2);color:var(--txt);border-radius:7px;padding:7px 13px;font-size:13px}
button:hover{border-color:var(--acc2);color:var(--acc2)}
button.danger:hover{border-color:var(--bad);color:var(--bad)}
button.go:hover{border-color:var(--acc);color:var(--acc)}
form.inline{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
form.inline input[type=text]{flex:1;min-width:150px}
.pill{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;
  padding:4px 9px;border-radius:20px;border:1px solid var(--line2);color:var(--muted)}
.pill b{color:var(--txt)}
.chips{display:flex;flex-wrap:wrap;gap:7px}
.flag{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}
.flag:last-child{border-bottom:0}
.flag .k{font-family:var(--mono);font-size:12px}
.state{font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid var(--line2)}
.state.on{color:var(--acc);border-color:rgba(61,220,151,.4)}
.state.off{color:var(--bad);border-color:rgba(255,93,108,.4)}
.notice{border-radius:9px;padding:11px 13px;margin:14px 0;font-size:13px;border:1px solid}
.notice.ok{border-color:rgba(61,220,151,.4);background:rgba(61,220,151,.06);color:var(--acc)}
.notice.err{border-color:rgba(255,93,108,.4);background:rgba(255,93,108,.06);color:var(--bad)}
.notice.info{border-color:var(--line2);background:var(--bg2);color:var(--muted)}
.empty{border:1px dashed var(--line2);border-radius:10px;padding:26px;text-align:center;
  color:var(--muted);font-family:var(--mono);font-size:12px;letter-spacing:.06em}
.login{max-width:400px;margin:70px auto}
details{border:1px solid var(--line);border-radius:8px;padding:9px 11px;background:var(--bg2);margin:7px 0}
summary{cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:.09em;color:var(--muted);text-transform:uppercase}
pre{margin:8px 0 0;font-size:11.5px;color:var(--muted);white-space:pre-wrap;word-break:break-word;font-family:var(--mono)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const NAV: Array<[string, string]> = [
  ['/admin', 'Control Center'],
  ['/admin/sources', 'Sources'],
  ['/admin/review', 'Review Queue'],
  ['/admin/events', 'Events'],
  ['/admin/audit', 'Audit'],
  ['/admin/security', 'Security'],
];

function layout(title: string, current: string, body: string, flash?: { kind: string; msg: string }): string {
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — Admin</title><style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><div class="topbar">
  <span class="brand">GNI<span class="tag">ADMIN</span></span>
  <nav aria-label="Administração">
    ${NAV.map(([h, l]) => `<a href="${h}"${current === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
  </nav>
  <a href="/" class="small dim">↗ Site</a>
  <form method="post" action="/admin/logout" style="margin:0"><button class="danger">Sair</button></form>
</div></div></header>
<main><div class="wrap">
${flash ? `<div class="notice ${esc(flash.kind)}">${esc(flash.msg)}</div>` : ''}
${body}
</div></main></body></html>`;
}

function csrfField(token: string): string {
  return `<input type="hidden" name="_csrf" value="${esc(token)}">`;
}

// ---------------------------------------------------------------- LOGIN
export function renderLogin(next: string, error?: string, lockSeconds = 0): string {
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Admin — Entrar</title><style>${CSS}</style></head><body>
<div class="wrap"><div class="login">
  <h1>Área de administração</h1>
  <p class="small dim">Autenticação com o token de administração definido no servidor. O token nunca é enviado para o browser: é trocado por um cookie de sessão assinado e httpOnly.</p>
  ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  ${lockSeconds > 0
    ? `<div class="notice err">Bloqueado por tentativas falhadas. Tente novamente dentro de ${Math.ceil(lockSeconds / 60)} minuto(s).</div>`
    : `<form method="post" action="/admin/login" class="panel">
        <input type="hidden" name="next" value="${esc(next)}">
        <label for="tok" class="small muted">Admin token</label>
        <input id="tok" name="token" type="password" autocomplete="current-password" required autofocus style="margin:6px 0 12px">
        <button class="go" type="submit">Entrar</button>
      </form>`}
  <p class="small dim">Tentativas falhadas são registadas como eventos de segurança e accionam bloqueio progressivo.</p>
</div></div></body></html>`;
}

// ---------------------------------------------------------------- CONTROL CENTER
const FLAG_LABELS: Record<string, { label: string; desc: string; safe: string; alt: string }> = {
  ingestion: { label: 'Ingestão', desc: 'Recolha de novos artigos das fontes.', safe: 'on', alt: 'off' },
  auto_publish: { label: 'Publicação automática', desc: 'Publicar eventos que passem o quality gate sem revisão humana.', safe: 'on', alt: 'off' },
  ai_analysis: { label: 'Análise por agentes', desc: 'Execução dos agentes de análise e verificação.', safe: 'on', alt: 'off' },
  trending_frozen: { label: 'Trending congelado', desc: 'Quando congelado, o score de trending passa a N/A em todos os eventos.', safe: 'no', alt: 'yes' },
  restricted_mode: { label: 'Modo restrito', desc: 'Reservado para incidentes: sinaliza operação em modo degradado.', safe: 'no', alt: 'yes' },
};

export function renderControlCenter(d: any, csrf: string, flash?: any): string {
  const s = d.status;
  const online = s.sources.filter((x: any) => x.status === 'online').length;
  const degraded = s.sources.filter((x: any) => x.status !== 'online').length;

  const flags = Object.entries(s.flags).map(([k, v]) => {
    const meta = FLAG_LABELS[k] ?? { label: k, desc: '', safe: 'on', alt: 'off' };
    const isSafe = v === meta.safe;
    const target = isSafe ? meta.alt : meta.safe;
    return `<div class="flag">
      <div>
        <div class="k">${esc(meta.label)} <span class="state ${isSafe ? 'on' : 'off'}">${esc(v)}</span></div>
        <div class="small dim">${esc(meta.desc)}</div>
      </div>
      <form method="post" action="/admin/flags" class="inline">
        ${csrfField(csrf)}
        <input type="hidden" name="key" value="${esc(k)}">
        <input type="hidden" name="value" value="${esc(target)}">
        <input type="text" name="reason" placeholder="Motivo (obrigatório)" required aria-label="Motivo da alteração" style="width:190px">
        <button class="${isSafe ? 'danger' : 'go'}">→ ${esc(target)}</button>
      </form>
    </div>`;
  }).join('');

  return layout('Control Center', '/admin', `
  <h1>Control Center</h1>
  <p class="small dim">Estado real do sistema. Todas as acções desta área são auditadas com actor, estado anterior, estado novo e motivo.</p>

  <h2>Sistema</h2>
  <div class="chips">
    <span class="pill">Artigos <b>${s.counts.articles}</b></span>
    <span class="pill">Eventos <b>${s.counts.events}</b></span>
    <span class="pill">Publicados <b class="ok">${s.counts.published}</b></span>
    <span class="pill">Em revisão <b class="${s.counts.review_open ? 'warnc' : ''}">${s.counts.review_open}</b></span>
    <span class="pill">Conflitos <b class="${s.counts.conflicts ? 'badc' : ''}">${s.counts.conflicts}</b></span>
    <span class="pill">Views contadas <b>${s.counts.views}</b></span>
    <span class="pill">Fontes online <b class="${degraded ? 'warnc' : 'ok'}">${online}/${s.sources.length}</b></span>
    <span class="pill">Auditoria <b>${s.counts.audit_entries}</b></span>
    <span class="pill">Driver <b>${esc(s.driver)}</b></span>
  </div>

  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div>
      <h2>🚨 Emergency Mode</h2>
      <div class="panel">${flags}</div>

      <h2>Pipeline</h2>
      <div class="panel">
        <h3>Executar ciclo manualmente</h3>
        <p class="small dim">Ingestão → clustering → agentes → supervisor → scoring. Pode demorar alguns segundos.</p>
        <form method="post" action="/admin/pipeline/run" class="inline">
          ${csrfField(csrf)}
          <input type="text" name="reason" placeholder="Motivo (obrigatório)" required style="width:220px">
          <button class="go">Correr agora</button>
        </form>
      </div>
    </div>

    <div>
      <h2>Análise</h2>
      <div class="panel"><p class="small" style="margin:0">${esc(s.ai_analysis)}</p></div>

      <h2>Actividade recente</h2>
      <div class="panel">
        ${d.recentAudit.length ? `<table><tbody>${d.recentAudit.map((a: any) => `
          <tr><td class="mono dim small" style="white-space:nowrap">${esc(new Date(a.at).toISOString().slice(5, 16).replace('T', ' '))}</td>
          <td class="mono small">${esc(a.actor)}</td>
          <td class="small">${esc(a.action)} <span class="dim">${esc(a.object_type)}</span><br><span class="dim">${esc((a.reason ?? '').slice(0, 70))}</span></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">SEM REGISTOS</div>'}
        <p class="small dim" style="margin:10px 0 0"><a href="/admin/audit">Ver auditoria completa →</a></p>
      </div>

      <h2>Segurança</h2>
      <div class="panel">
        ${d.recentSecurity.length ? `<table><tbody>${d.recentSecurity.map((e: any) => `
          <tr><td class="mono dim small" style="white-space:nowrap">${esc(new Date(e.at).toISOString().slice(5, 16).replace('T', ' '))}</td>
          <td class="mono small ${e.severity === 'high' ? 'badc' : e.severity === 'medium' ? 'warnc' : ''}">${esc(e.kind)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">SEM EVENTOS DE SEGURANÇA</div>'}
      </div>
    </div>
  </div>`, flash);
}

// ---------------------------------------------------------------- SOURCES
export function renderAdminSources(sources: any[], csrf: string, flash?: any): string {
  return layout('Sources', '/admin/sources', `
  <h1>Fontes</h1>
  <p class="small dim">Estado real de cada feed. Uma fonte que falha é marcada como offline — nunca é substituída por dados inventados. Bloquear uma fonte impede novas ingestões sem apagar o histórico.</p>
  <div class="panel" style="margin-top:14px">
  <table>
    <thead><tr><th>Fonte</th><th>Tipo</th><th>Grupo</th><th>Fiab.</th><th>Estado</th><th>Itens</th><th>ms</th><th>Artigos</th><th>Acção</th></tr></thead>
    <tbody>
    ${sources.map((s) => `<tr>
      <td><a href="${esc(s.homepage_url)}" target="_blank" rel="noopener nofollow">${esc(s.name)}</a>
        <div class="mono dim small">${esc(s.id)} · ${esc(s.country ?? '—')} · ${esc(s.language)}</div>
        ${s.last_error ? `<div class="small badc">${esc(String(s.last_error).slice(0, 60))}</div>` : ''}</td>
      <td class="mono small">${esc(s.origin_type)}</td>
      <td class="mono small dim">${esc(s.publisher_group)}</td>
      <td class="mono">${s.reliability_score ?? 'N/A'}</td>
      <td class="mono small ${s.status === 'online' ? 'ok' : s.status === 'degraded' ? 'warnc' : 'badc'}">${esc(s.status ?? 'unknown')}${s.blocked ? '<br><span class="badc">BLOQUEADA</span>' : ''}</td>
      <td class="mono">${s.items_last_run ?? '—'}</td>
      <td class="mono dim">${s.response_ms ?? '—'}</td>
      <td class="mono">${s.articles}</td>
      <td><form method="post" action="/admin/sources/${esc(s.id)}/block" class="inline">
        ${csrfField(csrf)}
        <input type="hidden" name="blocked" value="${s.blocked ? 'false' : 'true'}">
        <input type="text" name="reason" placeholder="Motivo" required style="width:110px">
        <button class="${s.blocked ? 'go' : 'danger'}">${s.blocked ? 'Desbloquear' : 'Bloquear'}</button>
      </form></td>
    </tr>
    ${s.reliability_basis ? `<tr><td colspan="9" class="small dim" style="padding-top:0;border-bottom:1px solid var(--line2)">Base da fiabilidade: ${esc(s.reliability_basis)}</td></tr>` : ''}`).join('')}
    </tbody>
  </table></div>`, flash);
}

// ---------------------------------------------------------------- REVIEW QUEUE
export function renderReviewQueue(items: any[], csrf: string, flash?: any): string {
  return layout('Review Queue', '/admin/review', `
  <h1>Fila de revisão humana</h1>
  <p class="small dim">Eventos que não passaram o quality gate ou que o supervisor marcou para revisão. Nada aqui está publicado. Aprovar publica o evento; rejeitar mantém-no fora do site. Ambas as decisões ficam auditadas.</p>
  ${items.length ? items.map((i) => `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
          <h3 style="margin-bottom:4px">${esc(i.title)}</h3>
          <div class="mono dim small">${esc(i.event_id)} · prioridade ${esc(i.priority)} · criado ${esc(new Date(i.created_at).toISOString().slice(0, 16).replace('T', ' '))}</div>
          <p class="small warnc" style="margin:8px 0 0">${esc(i.reason)}</p>
          <p class="small" style="margin:6px 0 0"><a href="/event/${esc(i.event_id)}/x" target="_blank">Ver evento →</a></p>
        </div>
        <form method="post" action="/admin/review/${esc(i.id)}/resolve" class="inline" style="align-items:flex-start">
          ${csrfField(csrf)}
          <input type="text" name="reason" placeholder="Motivo da decisão" required style="width:170px">
          <button name="decision" value="approved" class="go">Aprovar</button>
          <button name="decision" value="rejected" class="danger">Rejeitar</button>
          <button name="decision" value="held">Suspender</button>
        </form>
      </div>
    </div>`).join('')
  : '<div class="empty">FILA VAZIA — nenhum evento aguarda revisão humana</div>'}`, flash);
}

// ---------------------------------------------------------------- EVENTS
export function renderAdminEvents(events: any[], q: string, csrf: string, flash?: any): string {
  return layout('Events', '/admin/events', `
  <h1>Eventos</h1>
  <form method="get" action="/admin/events" class="inline" style="margin:14px 0">
    <input type="text" name="q" value="${esc(q)}" placeholder="Pesquisar por título ou ID…" style="max-width:340px">
    <button>Pesquisar</button>
  </form>
  ${events.length ? `<div class="panel"><table>
    <thead><tr><th>Evento</th><th>Categoria</th><th>Estado</th><th>Verificação</th><th>Artigos</th><th>Conf.</th><th>Acção</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td><a href="/event/${esc(e.id)}/${esc(e.slug)}" target="_blank">${esc(e.title.slice(0, 70))}</a>
        <div class="mono dim small">${esc(e.id)}</div></td>
      <td class="mono small">${esc(e.category)}</td>
      <td class="mono small ${e.status === 'PUBLISHED' ? 'ok' : 'warnc'}">${esc(e.status)}</td>
      <td class="mono small">${esc(e.verification)}</td>
      <td class="mono">${e.article_count} <span class="dim">/ ${e.independent_sources}g</span></td>
      <td class="mono">${e.confidence ?? 'N/A'}</td>
      <td><form method="post" action="/admin/events/${esc(e.id)}/status" class="inline">
        ${csrfField(csrf)}
        <input type="hidden" name="status" value="${e.status === 'PUBLISHED' ? 'SUPERVISOR_REVIEW' : 'PUBLISHED'}">
        <input type="text" name="reason" placeholder="Motivo" required style="width:110px">
        <button class="${e.status === 'PUBLISHED' ? 'danger' : 'go'}">${e.status === 'PUBLISHED' ? 'Despublicar' : 'Publicar'}</button>
      </form></td></tr>`).join('')}
    </tbody></table></div>`
  : `<div class="empty">${q ? 'SEM RESULTADOS' : 'SEM EVENTOS'}</div>`}`, flash);
}

// ---------------------------------------------------------------- AUDIT
export function renderAudit(entries: any[], flash?: any): string {
  return layout('Audit', '/admin/audit', `
  <h1>Registo de auditoria</h1>
  <p class="small dim">Append-only. Alterações automáticas e manuais. O histórico anterior nunca é apagado (§32, §34).</p>
  ${entries.length ? `<div class="panel"><table>
    <thead><tr><th>Quando</th><th>Actor</th><th>Acção</th><th>Objecto</th><th>Antes → Depois</th><th>Motivo</th></tr></thead>
    <tbody>${entries.map((a) => `<tr>
      <td class="mono dim small" style="white-space:nowrap">${esc(new Date(a.at).toISOString().replace('T', ' ').slice(0, 19))}</td>
      <td class="mono small">${esc(a.actor)}</td>
      <td class="mono small">${esc(a.action)}</td>
      <td class="mono small dim">${esc(a.object_type)}<br>${esc((a.object_id ?? '').slice(0, 28))}</td>
      <td class="small dim" style="max-width:280px">${a.prev_state || a.new_state
        ? `<span class="mono">${esc(String(a.prev_state ?? '—').slice(0, 60))}</span> → <span class="mono">${esc(String(a.new_state ?? '—').slice(0, 60))}</span>`
        : '—'}</td>
      <td class="small">${esc(a.reason)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">SEM REGISTOS</div>'}`, flash);
}

// ---------------------------------------------------------------- SECURITY
export function renderSecurity(events: any[], flash?: any): string {
  return layout('Security', '/admin/security', `
  <h1>Eventos de segurança</h1>
  <p class="small dim">Falhas de autenticação, validação CSRF, limites de taxa, tentativas de manipulação de views e detecção de dados de teste.</p>
  ${events.length ? `<div class="panel"><table>
    <thead><tr><th>Quando</th><th>Severidade</th><th>Tipo</th><th>Detalhe</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td class="mono dim small" style="white-space:nowrap">${esc(new Date(e.at).toISOString().replace('T', ' ').slice(0, 19))}</td>
      <td class="mono small ${e.severity === 'high' ? 'badc' : e.severity === 'medium' ? 'warnc' : 'dim'}">${esc(e.severity)}</td>
      <td class="mono small">${esc(e.kind)}</td>
      <td class="small dim" style="word-break:break-word">${esc(String(e.detail).slice(0, 200))}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">SEM EVENTOS DE SEGURANÇA REGISTADOS</div>'}`, flash);
}
