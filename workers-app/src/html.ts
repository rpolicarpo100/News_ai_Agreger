/**
 * Fase 2 — rotas HTML (server-rendering) no Worker.
 *
 * Importa as funções de renderização originais (src/web/render.ts) —
 * são puras, sem dependência do Express. Recebem dados e devolvem
 * strings HTML. O wrangler esbuild resolve as dependências de cada
 * módulo em runtime.
 *
 * Adaptadores: cada rota busca dados via data.ts e transforma-os no
 * formato que o render espera (labels, freshness, etc.).
 */
import { Hono } from 'hono';
import pg from 'pg';
import { publishedEvents, eventDetail, systemStatus, searchEvents, mapEvents } from './data';

type Bindings = { DATABASE_URL?: string; HYPERDRIVE?: Hyperdrive };
type Variables = { pool: pg.Pool };

/* ---------------------------------------------------------------- page shell — HTML mínimo, funciona sem render.ts */

function shell(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Global News Intelligence</title>
<style>
:root{--bg:#0a0e14;--panel:#141a24;--line:#2a3340;--txt:#f2f5fa;--muted:#aab4c6;--acc:#4ee7a5;--warn:#ffc069;--bad:#ff7b87}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font:15px/1.6 system-ui,sans-serif;padding:20px;max-width:960px;margin:auto}
h1{font-size:1.6rem;margin-bottom:12px;color:var(--acc)}
h2{font-size:1.2rem;margin:18px 0 8px;color:var(--muted)}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:10px}
.empty{color:var(--muted);font-style:italic;padding:20px;text-align:center}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;margin-right:6px}
.b-natural{background:#1a3a2a;color:#7fd7a2}.b-war{background:#3a1a1a;color:#ff7b87}
.b-economy{background:#3a2a1a;color:#ffc069}.b-tech{background:#1a2a3a;color:#6cb8ff}
.b-politics{background:#2a1a3a;color:#d0a9f5}
.grid{display:grid;gap:10px}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>${body}<footer style="margin-top:30px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px">Global News Intelligence · Cloudflare Workers · Dados verificados, nunca inventados</footer></body></html>`;
}

function esc(s: unknown) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!)); }
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s; }
function timeAgo(date: string) {
  const d = Date.now() - new Date(date).getTime();
  if (d < 3600e3) return `${Math.floor(d/60e3)}m atrás`;
  if (d < 86400e3) return `${Math.floor(d/3600e3)}h atrás`;
  return `${Math.floor(d/86400e3)}d atrás`;
}
const CAT_BADGE: Record<string, string> = {
  natural_events: 'b-natural', war_conflict: 'b-war', economy: 'b-economy',
  technology: 'b-tech', politics: 'b-politics',
};
const CAT_LABEL: Record<string, string> = {
  natural_events: 'Natureza', war_conflict: 'Guerra', economy: 'Economia',
  technology: 'Tecnologia', politics: 'Política', health: 'Saúde',
  environment: 'Ambiente', science: 'Ciência', crime: 'Crime', society: 'Sociedade',
};

function eventCard(e: any) {
  const badge = CAT_BADGE[e.category] ?? '';
  const label = CAT_LABEL[e.category] ?? e.category;
  const conf = e.confidence != null ? `${e.confidence}%` : 'N/A';
  const impact = e.life_impact != null ? `${e.life_impact}` : 'N/A';
  return `<div class="card">
    <span class="badge ${badge}">${esc(label)}</span>
    <span style="color:var(--muted);font-size:12px">${e.country ?? ''} · ${timeAgo(e.last_activity_at)}</span>
    <h3 style="margin:6px 0 4px"><a href="/event/${e.id}">${esc(e.title)}</a></h3>
    <div style="font-size:12px;color:var(--muted)">Confiança: ${conf} · Impacto: ${impact} · Artigos: ${e.article_count ?? 0}</div>
  </div>`;
}

/* ---------------------------------------------------------------- rotas */

export function registerHtmlRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

  /* GET / — home */
  app.get('/', async (c) => {
    const p = c.get('pool');
    const [breaking, trending, top] = await Promise.all([
      publishedEvents(p, { order: 'recent', limit: 6, sinceHours: 12 }),
      publishedEvents(p, { order: 'trending', limit: 6 }),
      publishedEvents(p, { order: 'relevance', limit: 8 }),
    ]);
    const status = await systemStatus(p);
    const sections = [
      { title: 'Últimas notícias (12h)', events: breaking },
      { title: 'Em destaque', events: trending },
      { title: 'Mais relevantes', events: top },
    ];
    let body = `<h1>🌍 Global News Intelligence</h1>
      <p style="color:var(--muted);margin-bottom:20px">Dados verificados de fontes reais. Nada é inventado.</p>`;
    const anyData = [...breaking, ...trending, ...top].length > 0;
    if (!anyData) {
      body += `<div class="empty">NO VERIFIED DATA AVAILABLE<br><small>A aguardar primeiro ciclo de ingestão</small></div>`;
    } else {
      for (const sec of sections) {
        if (!sec.events.length) continue;
        body += `<h2>${esc(sec.title)}</h2><div class="grid">${sec.events.map(eventCard).join('')}</div>`;
      }
    }
    body += `<div style="margin-top:20px;padding:12px;background:var(--panel);border-radius:8px;font-size:13px">
      <strong>Estado:</strong> ${status.counts.events} eventos · ${status.counts.articles} artigos · ${status.counts.published} publicados · ${status.counts.sources_enabled} fontes activas
      <br><a href="/status">Ver estado completo</a> · <a href="/events">Todos os eventos</a> · <a href="/map">Mapa</a></div>`;
    return c.html(shell('Início', body));
  });

  /* GET /events — lista */
  app.get('/events', async (c) => {
    const p = c.get('pool');
    const order = (c.req.query('order') as any) ?? 'recent';
    const category = c.req.query('category') ?? undefined;
    const events = await publishedEvents(p, { order, category, limit: 50 });
    let body = `<h1>Eventos</h1>`;
    if (category) body += `<p style="color:var(--muted)">Categoria: <strong>${esc(category)}</strong></p>`;
    body += `<div style="margin:10px 0;font-size:13px">Ordenar: <a href="/events?order=recent">Recente</a> · <a href="/events?order=trending">Tendência</a> · <a href="/events?order=relevance">Relevância</a> · <a href="/events?order=impact">Impacto</a></div>`;
    if (!events.length) {
      body += `<div class="empty">Sem eventos</div>`;
    } else {
      body += `<div class="grid">${events.map(eventCard).join('')}</div>`;
    }
    return c.html(shell('Eventos', body));
  });

  /* GET /event/:id — detalhe */
  app.get('/event/:id', async (c) => {
    const p = c.get('pool');
    const detail = await eventDetail(p, c.req.param('id'));
    if (!detail) return c.html(shell('Não encontrado', '<div class="empty">Evento não encontrado</div>'), 404);
    const e = detail.event;
    const badge = CAT_BADGE[e.category] ?? '';
    const label = CAT_LABEL[e.category] ?? e.category;
    let body = `<a href="/events" style="font-size:13px">← Voltar</a>
      <span class="badge ${badge}" style="margin-left:12px">${esc(label)}</span>
      <h1 style="margin:10px 0">${esc(e.title)}</h1>
      <div style="color:var(--muted);font-size:13px;margin-bottom:16px">${esc(e.country ?? '')} · ${esc(e.place ?? '')} · ${timeAgo(e.last_activity_at)}</div>`;
    if (detail.scores.length) {
      body += `<h2>Pontuações</h2><div class="card" style="display:flex;gap:16px;flex-wrap:wrap">`;
      for (const s of detail.scores) {
        body += `<div><div style="font-size:11px;color:var(--muted)">${esc(s.kind)}</div><div style="font-size:20px;font-weight:700">${s.value != null ? s.value : 'N/A'}</div></div>`;
      }
      body += `</div>`;
    }
    if (detail.articles.length) {
      body += `<h2>Fontes (${detail.articles.length})</h2>`;
      for (const a of detail.articles.slice(0, 10)) {
        body += `<div class="card"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><div style="font-size:12px;color:var(--muted)">${esc(a.source_name)} · ${timeAgo(a.published_at)}</div></div>`;
      }
    }
    body += `<div style="margin-top:12px;font-size:12px;color:var(--muted)">ID: ${esc(e.id)} · Artigos: ${detail.articles.length} · Views: ${detail.views.total}</div>`;
    return c.html(shell(e.title, body));
  });

  /* GET /search — pesquisa */
  app.get('/search', async (c) => {
    const p = c.get('pool');
    const q = c.req.query('q') ?? '';
    let events: any[] = [];
    if (q) events = await searchEvents(p, q);
    let body = `<h1>Pesquisa</h1>
      <form method="get" action="/search" style="margin:12px 0">
        <input name="q" value="${esc(q)}" placeholder="Pesquisar eventos..." style="width:100%;max-width:400px;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--txt);font-size:15px">
      </form>`;
    if (q) {
      body += `<p style="color:var(--muted)">${events.length} resultado(s) para "<strong>${esc(q)}</strong>"</p>`;
      if (events.length) body += `<div class="grid">${events.map(eventCard).join('')}</div>`;
    }
    return c.html(shell('Pesquisa', body));
  });

  /* GET /map — mapa */
  app.get('/map', async (c) => {
    const p = c.get('pool');
    const points = await mapEvents(p);
    let body = `<h1>Mapa</h1>`;
    if (!points.length) {
      body += `<div class="empty">Sem eventos com coordenadas</div>`;
    } else {
      body += `<div id="map" style="height:500px;background:var(--panel);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--muted)">${points.length} eventos — mapa a carregar...</div>`;
      body += `<script>
        (async()=>{
          const pts=${JSON.stringify(points)};
          const map=document.getElementById('map');
          if(!pts.length){map.textContent='Sem dados';return}
          const lats=pts.map(p=>p.lat),lons=pts.map(p=>p.lon);
          const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);
          const pad=20;const w=map.clientWidth,h=map.clientHeight;
          const proj=(lat,lon)=>[pad+(lon-minLon)/(maxLon-minLon||1)*(w-2*pad),pad+(maxLat-lat)/(maxLat-minLat||1)*(h-2*pad)];
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.setAttribute('width','100%');svg.setAttribute('height','100%');
          svg.setAttribute('viewBox','0 0 '+w+' '+h);
          for(const p of pts){const[x,y]=proj(p.lat,p.lon);const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
            c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r','5');
            c.setAttribute('fill','#4ee7a5');c.setAttribute('opacity','0.8');
            const t=document.createElementNS('http://www.w3.org/2000/svg','title');t.textContent=p.title;c.appendChild(t);svg.appendChild(c)}
          map.innerHTML='';map.appendChild(svg);
        })()
      </script>`;
    }
    return c.html(shell('Mapa', body));
  });

  /* GET /status — estado */
  app.get('/status', async (c) => {
    const p = c.get('pool');
    const status = await systemStatus(p);
    let body = `<h1>Estado do sistema</h1>
      <div class="card">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;text-align:center">
          <div><div style="font-size:24px;font-weight:700;color:var(--acc)">${status.counts.events}</div><div style="font-size:12px;color:var(--muted)">Eventos</div></div>
          <div><div style="font-size:24px;font-weight:700;color:var(--acc)">${status.counts.articles}</div><div style="font-size:12px;color:var(--muted)">Artigos</div></div>
          <div><div style="font-size:24px;font-weight:700;color:var(--acc)">${status.counts.published}</div><div style="font-size:12px;color:var(--muted)">Publicados</div></div>
          <div><div style="font-size:24px;font-weight:700;color:var(--warn)">${status.counts.sources_enabled}</div><div style="font-size:12px;color:var(--muted)">Fontes</div></div>
          <div><div style="font-size:24px;font-weight:700;color:var(--acc)">${status.counts.views}</div><div style="font-size:12px;color:var(--muted)">Views</div></div>
        </div>
      </div>`;
    if (status.sources.length) {
      body += `<h2>Fontes (${status.sources.length})</h2>`;
      for (const s of status.sources) {
        const color = s.status === 'online' ? 'var(--acc)' : s.status === 'degraded' ? 'var(--warn)' : 'var(--bad)';
        body += `<div class="card" style="border-left:3px solid ${color}">
          <strong>${esc(s.name)}</strong> <span style="color:var(--muted);font-size:12px">${esc(s.status)}</span>
          ${s.last_error ? `<div style="color:var(--bad);font-size:12px">${esc(truncate(s.last_error, 80))}</div>` : ''}
        </div>`;
      }
    }
    return c.html(shell('Estado', body));
  });
}
