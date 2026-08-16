/**
 * Account + My Intelligence UI — §56, §71.
 *
 * The personal feed is a real query over followed countries, categories and
 * events. When a user follows nothing, the page says so and offers choices —
 * it does not invent a feed to look populated.
 */
import { esc, eventCard, pageShell } from './render.js';
import { CATEGORY_LABELS_PT } from '../pipeline/classify.js';

function csrfField(token: string): string {
  return `<input type="hidden" name="_csrf" value="${esc(token)}">`;
}

const AUTH_CSS = `
.auth{max-width:420px;margin:34px auto}
.auth .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px}
.auth label{display:block;font-size:12px;color:var(--muted);margin:12px 0 5px}
.auth input{width:100%;background:var(--bg2);border:1px solid var(--line2);color:var(--txt);
  border-radius:8px;padding:9px 11px;font-size:14px;font-family:var(--sans)}
.auth button{margin-top:16px;width:100%;background:var(--acc);color:#07090d;border:0;border-radius:8px;
  padding:10px;font-size:14px;font-weight:700;cursor:pointer}
.auth button:hover{opacity:.9}
.auth .alt{text-align:center;margin-top:14px;font-size:13px;color:var(--muted)}
.notice{border-radius:9px;padding:11px 13px;margin:14px 0;font-size:13px;border:1px solid}
.notice.err{border-color:rgba(255,93,108,.4);background:rgba(255,93,108,.06);color:var(--bad)}
.notice.ok{border-color:rgba(61,220,151,.4);background:rgba(61,220,151,.06);color:var(--acc)}
.tagbtn{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11.5px;
  padding:5px 10px;border-radius:20px;border:1px solid var(--line2);color:var(--muted);
  background:var(--bg2);cursor:pointer}
.tagbtn:hover{border-color:var(--acc2);color:var(--acc2)}
.tagbtn.on{border-color:rgba(61,220,151,.45);color:var(--acc);background:rgba(61,220,151,.07)}
.tagbtn.on:hover{border-color:var(--bad);color:var(--bad)}
form.ib{display:inline;margin:0}
.danger-zone{border:1px solid rgba(255,93,108,.3);border-radius:12px;padding:16px;margin-top:24px}
.danger-zone button{background:none;border:1px solid var(--bad);color:var(--bad);border-radius:8px;
  padding:8px 14px;font-size:13px;cursor:pointer;width:auto;margin-top:10px}
`;

// ---------------------------------------------------------------- login / register
export function renderAuth(mode: 'login' | 'register', opts: { error?: string; ok?: string; next?: string } = {}): string {
  const isLogin = mode === 'login';
  return pageShell({
    title: isLogin ? 'Entrar' : 'Criar conta',
    extraCss: AUTH_CSS,
    body: `<div class="auth">
      <h1 style="text-align:center">${isLogin ? 'Entrar' : 'Criar conta'}</h1>
      <p class="small dim" style="text-align:center">Uma conta serve apenas para seguir países, categorias e eventos. Guardamos o email e nada mais — sem nome, sem perfil, sem rastreio.</p>
      ${opts.error ? `<div class="notice err">${esc(opts.error)}</div>` : ''}
      ${opts.ok ? `<div class="notice ok">${esc(opts.ok)}</div>` : ''}
      <form class="panel" method="post" action="/account/${isLogin ? 'login' : 'register'}">
        <input type="hidden" name="next" value="${esc(opts.next ?? '/my')}">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required autofocus>
        <label for="password">Palavra-passe</label>
        <input id="password" name="password" type="password"
               autocomplete="${isLogin ? 'current-password' : 'new-password'}" required minlength="10">
        ${isLogin ? '' : '<p class="small dim" style="margin:6px 0 0">Mínimo 10 caracteres.</p>'}
        <button type="submit">${isLogin ? 'Entrar' : 'Criar conta'}</button>
      </form>
      <p class="alt">${isLogin
        ? 'Ainda não tem conta? <a href="/account/register">Criar conta</a>'
        : 'Já tem conta? <a href="/account/login">Entrar</a>'}</p>
    </div>`,
  });
}

// ---------------------------------------------------------------- My Intelligence
interface MyData {
  user: { id: string; email: string; created_at: string };
  follows: Array<{ kind: string; value: string }>;
  events: any[];
  bookmarks: any[];
  countries: Array<{ country: string; n: number }>;
  csrf: string;
  unread?: number;
  alertCount?: number;
  flash?: { kind: string; msg: string };
}

export function renderMyIntelligence(d: MyData): string {
  const followed = new Set(d.follows.map((f) => `${f.kind}:${f.value}`));
  const followedCategories = d.follows.filter((f) => f.kind === 'category');
  const followedCountries = d.follows.filter((f) => f.kind === 'country');
  const followedEvents = d.follows.filter((f) => f.kind === 'event');

  const toggle = (kind: string, value: string, label: string) => {
    const on = followed.has(`${kind}:${value}`);
    return `<form class="ib" method="post" action="/my/follow">
      ${csrfField(d.csrf)}
      <input type="hidden" name="kind" value="${esc(kind)}">
      <input type="hidden" name="value" value="${esc(value)}">
      <input type="hidden" name="action" value="${on ? 'unfollow' : 'follow'}">
      <button class="tagbtn ${on ? 'on' : ''}" type="submit"
        aria-pressed="${on}">${on ? '✓ ' : '+ '}${esc(label)}</button>
    </form>`;
  };

  const categoryPicker = Object.entries(CATEGORY_LABELS_PT)
    .filter(([k]) => k !== 'unclassified')
    .map(([k, label]) => toggle('category', k, label)).join(' ');

  const countryPicker = d.countries.length
    ? d.countries.map((c) => toggle('country', c.country, `${c.country} (${c.n})`)).join(' ')
    : '<span class="small dim">Nenhum país com eventos publicados neste momento.</span>';

  const feed = d.events.length
    ? `<div class="grid g3">${d.events.map(eventCard).join('')}</div>`
    : `<div class="empty"><strong>${followed.size ? 'SEM EVENTOS PUBLICADOS' : 'AINDA NÃO SEGUE NADA'}</strong>${
        followed.size
          ? 'Segue estes temas, mas nenhum evento publicado corresponde neste momento. Nada é gerado para preencher o espaço.'
          : 'Escolha categorias ou países abaixo para construir o seu feed pessoal.'}</div>`;

  const bookmarks = d.bookmarks.length
    ? `<div class="grid g3">${d.bookmarks.map(eventCard).join('')}</div>`
    : '<div class="empty"><strong>SEM GUARDADOS</strong>Abra um evento e use "Guardar" para o encontrar aqui.</div>';

  return pageShell({
    title: 'My Intelligence',
    current: '/my',
    extraCss: AUTH_CSS,
    body: `
    <h1>My Intelligence</h1>
    <p class="small dim">Feed construído exclusivamente a partir do que segue. Sessão iniciada como <span class="mono">${esc(d.user.email)}</span>.</p>
    <div class="chips" style="margin:12px 0 4px">
      <a class="tagbtn" href="/my/inbox">✉ Caixa de entrada${d.unread ? ` (${d.unread})` : ''}</a>
      <a class="tagbtn" href="/my/alerts">🔔 Alertas${d.alertCount ? ` (${d.alertCount})` : ''}</a>
      <a class="tagbtn" href="/brief">📄 Daily Brief</a>
    </div>
    ${d.flash ? `<div class="notice ${esc(d.flash.kind)}">${esc(d.flash.msg)}</div>` : ''}

    <h2 class="sec">O seu feed${followed.size ? ` — ${followedCategories.length} categoria(s), ${followedCountries.length} país(es), ${followedEvents.length} evento(s)` : ''}</h2>
    ${feed}

    <h2 class="sec">Guardados</h2>
    ${bookmarks}

    <h2 class="sec">Seguir categorias</h2>
    <div class="chips">${categoryPicker}</div>

    <h2 class="sec">Seguir países</h2>
    <p class="small dim" style="margin-top:-6px">Apenas países com eventos publicados. A lista reflecte os dados reais.</p>
    <div class="chips">${countryPicker}</div>

    <h2 class="sec">Conta e privacidade</h2>
    <div class="panel">
      <p class="small">Conta criada em ${esc(new Date(d.user.created_at).toISOString().slice(0, 10))}.</p>
      <p class="small dim">Guardamos apenas: o seu email, a palavra-passe em forma cifrada (scrypt), e a lista do que segue. Não guardamos nome, localização, endereço IP nem histórico de leitura.</p>
      <p class="small"><a href="/my/export">Exportar os meus dados (JSON)</a></p>
      <div class="danger-zone">
        <strong class="small">Eliminar conta</strong>
        <p class="small dim" style="margin:6px 0 0">Elimina permanentemente a conta, sessões, seguidos e guardados. Não é reversível.</p>
        <form method="post" action="/my/delete" onsubmit="return confirm('Eliminar permanentemente a conta? Esta acção não pode ser revertida.')">
          ${csrfField(d.csrf)}
          <button type="submit">Eliminar a minha conta</button>
        </form>
      </div>
    </div>`,
  });
}
