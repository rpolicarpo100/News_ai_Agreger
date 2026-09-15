# Deploy gratuito perpétuo: Render + Postgres gerido + cron externo

Stack 100% gratuita **sem cartão de crédito e sem data de expiração** — ao
contrário do Render gratuito por defeito (serviço adormece aos 15 min, e o
Postgres deles **expira aos 30 dias** — por isso a base NÃO vem do Render;
ver `docs/DEPLOY.md`).

> **Histórico:** o guia original usava Koyeb, que foi adquirido pela Mistral
> (Fev/2026) e fechou o tier gratuito a novas contas. O Render continua a
> aceitar novas contas free e o `render.yaml` já estaba preparado para isto.

```
cron-job.org (a cada 30 min)            Render free (web service)
  └── POST /api/cron/run ───┐             └── serve a API + UI
                            ▼                  ▲
                    Supabase (ou Neon) ────────┘
                    Postgres 0,5 GB, sem expirar
```

| Componente | Papel | Plano gratuito | Limitação honesta |
|---|---|---|---|
| [Render](https://render.com) | Serve a API/UI | 1 web service, sem expirar | Dorme após 15 min sem tráfego; o cron de 30/30 min resolve |
| [Supabase](https://supabase.com) ou [Neon](https://neon.com) | Base Postgres | 500 MB / 0,5 GB, sem expirar, sem cartão | Supabase pausa após 7 dias inactiva — irrelevante: a ingestão de 30/30 min mantém-na activa |
| cron-job.org (ou UptimeRobot) | Dispara a ingestão | Ilimitado, sem cartão | Pode atrasar minutos em horas de pico |

O código não muda: com `DATABASE_URL` definido, a app usa Postgres real
(`src/db/index.ts`). O `Dockerfile` funciona no Render (runtime Docker) —
mas com o build padrão Node também chega (ver abaixo).

## Base de dados: Supabase OU Neon (ambos servem)

A aplicação só precisa de um Postgres com SSL — qualquer um funciona sem
mudar uma linha de código.

| | [Supabase](https://supabase.com) | [Neon](https://neon.com) |
|---|---|---|
| Armazenamento free | 500 MB | 0,5 GB |
| Expira? | Não | Não |
| Pausa por inactividade | 7 dias | Autosuspende aos 5 min (acorda sozinho) |
| Pausa relevante aqui? | Não — a ingestão de 30/30 min mantém-na activa | Não — pelo mesmo motivo |
| Ligar daqui (sem browser) | Sim, via conector (projecto **gni** já criado) | — (criar à mão, 2 min) |

> **Projecto Supabase já criado e testado**: `gni` (ref `vtqxwmvqdaovifeukexc`,
> região `eu-central-1`), role da app `gni_app` criado e testado (directa e
> pooler). Usar a connection string **pooler** (porta 5432): hostname
> `aws-0-eu-central-1.pooler.supabase.com`, user
> `gni_app.vtqxwmvqdaovifeukexc`, base `postgres`. Guardada nas preferências
> locais do workspace (`.freebuff/PREFERENCIAS.md`) — nunca commitar.

## 1. Base de dados

**Supabase (recomendado — já está criado):** ligação verificada; usar a string
pooler indicada acima. Se preferir Neon: conta → New Project (região
`eu-central-1`) → copiar a connection string **pooled**.

## 2. GitHub → Render

1. O código já está em `github.com/rpolicarpo100/News_ai_Agreger` (privado).
2. Render → sign up com GitHub (sem cartão) → **New → Web Service** →
   ligar o repositório.
3. Duas opções de build, as duas funcionam:
   - **Docker** (recomendado): o Render detecta o `Dockerfile` — imagem
     multi-stage, produção Node 20, healthcheck embutido.
   - **Node** (sem Docker): Build `npm ci --include=dev && npm run build`,
     Start `npm start`. O `check-prod-build.ts` já garante que o build
     instala as devDependencies (o compilador).
4. Plano **Free**. Health check path: `/api/health`.

### Variáveis de ambiente no Render

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a string pooler do Supabase (passo 1) — **nunca** a do Render Postgres |
| `NODE_ENV` | `production` |
| `RUN_WORKER_IN_WEB` | `true` — passa a correr o ciclo ao acordar, como reforço ao cron externo |
| `RUN_WORKER_IN_WEB` também `true`? | Sim: cada visita após sono dispara um ciclo imediato; sem isso os dados envelhecem entre pings |
| `PUBLIC_BASE_URL` | o URL do Render (ex.: `https://gni-xxxx.onrender.com`) |
| `VIEW_SALT` | gerado a 15-09-2026 (nas preferências locais do workspace) |
| `ADMIN_TOKEN` | gerado a 15-09-2026 (idem) |
| `CRON_TOKEN` | gerado a 15-09-2026 (idem) — activa o `/api/cron/run` |

> NÃO criar a base de dados pelo `render.yaml` (o Postgres free deles expira
> aos 30 dias). Se usar o Blueprint, apague a secção `databases:` e o campo
> `fromDatabase` — a base vem do Supabase.

## 3. Cron externo (substitui o GitHub Actions bloqueado)

1. Conta gratuita em <https://cron-job.org> (ou UptimeRobot).
2. Novo job: **a cada 30 minutos**, método **POST**,
   URL `https://SEU-APP.onrender.com/api/cron/run`,
   header `x-cron-token: <valor de CRON_TOKEN>`.
3. O endpoint responde `202` imediatamente e corre o ciclo completo em fundo
   (ingestão → clustering → agentes → grafo → alertas → retenção diária).
   Protecções: 503 sem `CRON_TOKEN`, 404 em token errado (timing-safe),
   409 se já houver ciclo em execução, e respeita a flag `ingestion` do
   Admin Center.

Efeito colateral útil: cada ping também **acorda o Render** — o serviço deixa
de estar adormecido quando alguém visita. Só o primeiro acesso após 15+ min
sem tráfego pode notar alguns segundos extra.

## 4. Verificar

```bash
curl https://SEU-APP.onrender.com/api/health
open https://SEU-APP.onrender.com/api/status   # fontes e contadores reais
```

Com a base vazia, a UI mostra `NO VERIFIED DATA AVAILABLE` — comportamento
correcto; desaparece após o primeiro ciclo.

## Limitações honestas

- **Render free dorme aos 15 min**; o cron de 30/30 min mantém-no quente na
  prática (~2 acordões/hora, dentro das 750 h/mês gratuitas da conta).
- **750 h/mês de instâncias free são partilhadas por conta** com outros
  serviços Render que possa ter — se somar todos, pode esgotar a quota (ver
  comentário no `ingest.yml` antigo, já substituído).
- **Supabase pausa após 7 dias inactiva** — não acontece aqui, mas se um dia
  desligar o cron, lembre-se de a acordar.
- **Custom domain** nunca é grátis (~10 €/ano); `*.onrender.com` é.

## Diagnóstico rápido

| Sintoma | Causa provável |
|---|---|
| `/api/health` 200 mas dados antigos | cron externo não criado, ou header `x-cron-token` errado |
| `503` no `/api/cron/run` | `CRON_TOKEN` não definido no Render |
| `404` no `/api/cron/run` | header com token errado |
| `worker:once` falha com SSL | Faltou `?sslmode=require` na connection string |
| Base cresce sem parar | Ver `docs/PROXIMOS-PASSOS.md` §retenção; tecto do Supabase: 500 MB |
