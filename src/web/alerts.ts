/**
 * Alerts, inbox and Daily Brief UI — §57, §58.
 */
import { esc, eventCard, pageShell } from './render.js';
import { CATEGORY_LABELS_PT } from '../pipeline/classify.js';
import { describeRule } from '../pipeline/alerts.js';

const CSS = `
.rule{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:14px;
  display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}
.rule.off{opacity:.55}
.rule h4{margin:0 0 4px;font-size:14.5px}
.rule .crit{font-family:var(--mono);font-size:11.5px;color:var(--acc2)}
.rule form{display:inline;margin:0}
.rule button{background:var(--bg2);border:1px solid var(--line2);color:var(--muted);border-radius:7px;
  padding:6px 11px;font-size:12px;cursor:pointer;font-family:var(--mono)}
.rule button:hover{border-color:var(--acc2);color:var(--acc2)}
.rule button.danger:hover{border-color:var(--bad);color:var(--bad)}
.newrule{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px}
.newrule .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;margin-bottom:11px}
.newrule label{display:block;font-size:11px;color:var(--dim);font-family:var(--mono);
  letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px}
.newrule input,.newrule select{width:100%;background:var(--bg2);border:1px solid var(--line2);
  color:var(--txt);border-radius:7px;padding:8px 10px;font-size:13px;font-family:var(--sans)}
.newrule .sub{background:var(--acc);color:#07090d;border:0;border-radius:8px;padding:9px 18px;
  font-weight:700;font-size:13.5px;cursor:pointer;width:auto}
.check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.check input{width:auto}
.notif{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);align-items:flex-start}
.notif.unread{background:linear-gradient(90deg,rgba(61,220,151,.05),transparent);
  margin:0 -10px;padding-left:10px;padding-right:10px;border-radius:6px}
.dot2{width:7px;height:7px;border-radius:50%;background:var(--acc);margin-top:7px;flex-shrink:0}
.dot2.read{background:var(--line2)}
.badge{display:inline-flex;min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:var(--acc);
  color:#07090d;font-size:10.5px;font-weight:700;align-items:center;justify-content:center;
  font-family:var(--mono);margin-left:5px;vertical-align:middle}
.brief-sec{margin-bottom:26px}
.brief-line{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line)}
.brief-line .sc{font-family:var(--mono);font-size:11px;color:var(--dim);white-space:nowrap}
.notice{border-radius:9px;padding:11px 13px;margin:14px 0;font-size:13px;border:1px solid}
.notice.err{border-color:rgba(255,93,108,.4);background:rgba(255,93,108,.06);color:var(--bad)}
.notice.ok{border-color:rgba(61,220,151,.4);background:rgba(61,220,151,.06);color:var(--acc)}
`;

const csrfField = (t: string) => `<input type="hidden" name="_csrf" value="${esc(t)}">`;

// ---------------------------------------------------------------- alerts
export function renderAlerts(d: {
  rules: any[]; countries: Array<{ country: string; n: number }>;
  csrf: string; flash?: { kind: string; msg: string };
}): string {
  const rules = d.rules.length ? d.rules.map((r) => `
    <div class="rule ${r.enabled ? '' : 'off'}">
      <div style="flex:1;min-width:220px">
        <h4>${esc(r.name)} ${r.enabled ? '' : '<span class="chip">DESACTIVADO</span>'}</h4>
        <div class="crit">${esc(describeRule(r))}</div>
        <div class="small dim" style="margin-top:4px">
          ${r.last_fired_at ? `Último disparo: ${esc(new Date(r.last_fired_at).toISOString().slice(0, 16).replace('T', ' '))}` : 'Ainda não disparou.'}
          · ${esc(r.matches ?? 0)} notificação(ões)
        </div>
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <form method="post" action="/my/alerts/${esc(r.id)}/toggle">
          ${csrfField(d.csrf)}
          <input type="hidden" name="enabled" value="${r.enabled ? 'false' : 'true'}">
          <button type="submit">${r.enabled ? 'Desactivar' : 'Activar'}</button>
        </form>
        <form method="post" action="/my/alerts/${esc(r.id)}/delete">
          ${csrfField(d.csrf)}
          <button type="submit" class="danger">Eliminar</button>
        </form>
      </div>
    </div>`).join('')
    : `<div class="empty"><strong>SEM ALERTAS</strong>Crie um alerta abaixo. Só será notificado quando existir um evento real que corresponda aos critérios.</div>`;

  const cats = Object.entries(CATEGORY_LABELS_PT).filter(([k]) => k !== 'unclassified')
    .map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
  const countries = d.countries
    .map((c) => `<option value="${esc(c.country)}">${esc(c.country)} (${c.n})</option>`).join('');

  return pageShell({
    title: 'Alertas', current: '/my/alerts', extraCss: CSS,
    body: `<h1>Alertas</h1>
    <p class="small dim">Um alerta é uma regra sobre eventos reais. Quando um evento publicado corresponde, recebe uma notificação na <a href="/my/inbox">caixa de entrada</a>. A entrega é dentro da aplicação — não é necessário configurar email.</p>
    ${d.flash ? `<div class="notice ${esc(d.flash.kind)}">${esc(d.flash.msg)}</div>` : ''}

    <h2 class="sec">Novo alerta</h2>
    <form class="newrule" method="post" action="/my/alerts">
      ${csrfField(d.csrf)}
      <div class="row">
        <div><label for="an">Nome</label><input id="an" name="name" required maxlength="80" placeholder="Ex.: Sismos fortes"></div>
        <div><label for="ac">Categoria</label><select id="ac" name="category"><option value="">Qualquer</option>${cats}</select></div>
        <div><label for="ay">País</label><select id="ay" name="country"><option value="">Qualquer</option>${countries}</select></div>
      </div>
      <div class="row">
        <div><label for="mc">Confidence mínima</label><input id="mc" name="min_confidence" type="number" min="0" max="100" placeholder="—"></div>
        <div><label for="mi">Life impact mínimo</label><input id="mi" name="min_impact" type="number" min="0" max="100" placeholder="—"></div>
        <div><label for="mr">Relevance mínima</label><input id="mr" name="min_relevance" type="number" min="0" max="100" placeholder="—"></div>
      </div>
      <label class="check"><input type="checkbox" name="only_verified" value="true"> Apenas eventos com verificação VERIFIED</label>
      <p class="small dim" style="margin:11px 0">Um evento cujo score seja N/A <strong>não</strong> satisfaz um limiar: um valor desconhecido nunca conta como aprovado.</p>
      <button class="sub" type="submit">Criar alerta</button>
    </form>

    <h2 class="sec">Os seus alertas (${d.rules.length})</h2>
    ${rules}`,
  });
}

// ---------------------------------------------------------------- inbox
export function renderInbox(d: { items: any[]; unread: number; csrf: string }): string {
  const list = d.items.length ? d.items.map((n) => `
    <div class="notif ${n.read_at ? '' : 'unread'}">
      <span class="dot2 ${n.read_at ? 'read' : ''}" aria-hidden="true"></span>
      <div style="flex:1;min-width:0">
        <a href="/event/${esc(n.event_id)}/${esc(n.slug)}"><strong style="font-size:14px">${esc(n.title)}</strong></a>
        <div class="meta" style="margin-top:4px">
          <span>${esc(CATEGORY_LABELS_PT[n.category] ?? n.category)}</span>
          <span class="chip ${esc(n.verification)}">${esc(n.verification)}</span>
          ${n.country ? `<span>${esc(n.country)}</span>` : ''}
          <span>${esc(new Date(n.created_at).toISOString().slice(0, 16).replace('T', ' '))}</span>
        </div>
        <div class="small dim" style="margin-top:3px">${esc(n.reason)}</div>
      </div>
    </div>`).join('')
    : `<div class="empty"><strong>CAIXA DE ENTRADA VAZIA</strong>Nenhum evento real correspondeu aos seus alertas. Nada é gerado para preencher esta página.</div>`;

  return pageShell({
    title: 'Caixa de entrada', current: '/my/inbox', extraCss: CSS,
    body: `<h1>Caixa de entrada${d.unread ? `<span class="badge">${d.unread}</span>` : ''}</h1>
    <p class="small dim">Notificações geradas pelos seus <a href="/my/alerts">alertas</a>. Cada uma aponta para um evento publicado e indica que critério a despoletou.</p>
    ${d.unread ? `<form method="post" action="/my/inbox/read" style="margin:14px 0">
      ${csrfField(d.csrf)}
      <button type="submit" style="background:var(--bg2);border:1px solid var(--line2);color:var(--muted);
        border-radius:7px;padding:7px 13px;font-size:12.5px;cursor:pointer;font-family:var(--mono)">Marcar todas como lidas</button>
    </form>` : ''}
    <div class="panel" style="margin-top:14px">${list}</div>`,
  });
}

// ---------------------------------------------------------------- daily brief
export function renderBrief(b: any, signedIn: boolean): string {
  const sections = b.sections.map((s: any) => `
    <div class="brief-sec">
      <h2 class="sec">${esc(s.heading)}</h2>
      <div class="grid g3">${s.events.map(eventCard).join('')}</div>
    </div>`).join('');

  return pageShell({
    title: 'Daily Intelligence Brief', current: '/brief', extraCss: CSS,
    description: 'Resumo diário construído a partir de acontecimentos reais publicados nas últimas 24 horas.',
    body: `<h1>Daily Intelligence Brief</h1>
    <p class="small dim">Janela de ${esc(b.windowHours)} horas · gerado ${esc(new Date(b.generatedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC
      · ${esc(b.totals.published)} eventos publicados nesta janela${b.personalised ? ' · personalizado com o que segue' : ''}</p>

    ${!signedIn ? `<div class="panel" style="margin:14px 0"><p class="small" style="margin:0">
      Este é o resumo geral. <a href="/account/login?next=%2Fbrief">Entre</a> para incluir uma secção com os países, categorias e eventos que segue.</p></div>` : ''}

    ${b.sections.length ? sections
      : `<div class="empty" style="margin-top:16px"><strong>NO VERIFIED DATA AVAILABLE</strong>
         Nenhum evento foi publicado nesta janela de tempo. O resumo não é preenchido artificialmente.</div>`}

    <div class="panel" style="margin-top:20px">
      <p class="small dim" style="margin:0">${esc(b.note)}</p>
    </div>`,
  });
}
