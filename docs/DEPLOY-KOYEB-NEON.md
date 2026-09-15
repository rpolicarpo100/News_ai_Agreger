# Deploy gratuito perpétuo: Koyeb + Neon + GitHub Actions

Stack 100% gratuita **sem cartão de crédito e sem data de expiração** — ao
contrário do Render gratuito (serviço adormece aos 15 min, Postgres expira aos
30 dias — ver `docs/DEPLOY.md`).

```
GitHub Actions (a cada 30 min)          Koyeb (web service)
  └── npm run worker:once ───┐            └── serve a API + UI
                             ▼                 ▲
                        Neon Postgres ─────────┘
                        (0,5 GB, sem expirar)
```

| Componente | Papel | Plano gratuito | Limitação honesta |
|---|---|---|---|
| [Koyeb](https://www.koyeb.com) | Serve a API/UI | 1 web service, nunca expira | Dorme após 1 h sem tráfego; acordar demora segundos |
| [Neon](https://neon.com) | Base de dados Postgres | 0,5 GB, 100 CU-h/mês, sem cartão | Compute autosuspende aos 5 min de inactividade (acorda automaticamente) |
| GitHub Actions | Ingestão (cron) | Público: ilimitado; privado: 2 000 min/mês | Cron pode atrasar alguns minutos em horas de pico |

O código não muda: com `DATABASE_URL` definido, a aplicação usa Postgres real
(`src/db/index.ts`) — o mesmo SQL do PGlite local.

---

## 1. Neon: criar a base de dados

1. Conta em <https://neon.com> (login com GitHub, sem cartão).
2. **New Project** → nome `gni` → região `AWS Frankfurt (eu-central-1)` (a mais
   próxima de Portugal).
3. Copie a **connection string** e use a variante **pooled** (hostname com
   `-pooler`) — o web service faz ligações curtas e o pooler do Neon conta-as
   melhor contra o limite de ligações. A string inclui utilizador e password
   (não a reproduzimos aqui: o scanner de segredos bloqueia URLs com
   credenciais inline, mesmo de exemplo) e termina em `?sslmode=require`.

## 2. GitHub: código + segredo

1. Crie o repositório e envie o código (instruções de push em
   `docs/DEPLOY.md` — não precisa de deploy key para o Koyeb/Actions lerem).
2. **Settings → Secrets and variables → Actions → New repository secret**:
   - `DATABASE_URL` = connection string pooled do passo 1.
3. O workflow `.github/workflows/ingest.yml` fica activo automaticamente.
   Primeira execução: **Actions → Scheduled Ingestion → Run workflow**.

## 3. Koyeb: o web service

1. Conta em <https://app.koyeb.com> (login com GitHub, sem cartão).
2. **Create Service → GitHub** → seleccione o repositório.
3. Builder: **Dockerfile** (detecção automática — o `Dockerfile` já está no
   repositório; só serve tráfego, não ingere).
4. Instance: **Free**. Região: `fra` (Frankfurt).
5. Exposed port: `3000`. Health check: **`/api/health`**.
6. Environment variables:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Neon (passo 1) |
   | `NODE_ENV` | `production` |
   | `RUN_WORKER_IN_WEB` | `false` — a ingestão é do Actions; o serviço web só serve |
   | `PUBLIC_BASE_URL` | o URL público do Koyeb (ex.: `https://xxx-yyy.koyeb.app`) |
   | `VIEW_SALT` | `openssl rand -hex 32` |
   | `ADMIN_TOKEN` | `openssl rand -hex 32` — sem ele, `/admin` fica em 503 (seguro por omissão) |

7. Deploy. A migração do schema (`CREATE TABLE IF NOT EXISTS`, idempotente)
   corre sozinha no arranque.

## 4. Verificar

```bash
# API viva?
curl https://SEU-APP.koyeb.app/api/health

# Fontes e contadores reais (aguardar o 1.º ciclo do Actions ~2-5 min):
open https://SEU-APP.koyeb.app/api/status
```

Com a base vazia, a UI mostra `NO VERIFIED DATA AVAILABLE` em vez de conteúdo
inventado — é o comportamento correcto; desaparece após o primeiro ciclo.

---

## Porque é que o cron corre a cada 30 minutos

O plano gratuito do Neon dá **100 CU-h/mês** (CU = unidade de compute). O
serviço acorda por cada ciclo de ingestão:

| Cadência | CU-h/mês aprox. | Veredicto |
|---|---|---|
| 10 min (CYCLE_MINUTES do Render) | ~150 + serve | **excede** o gratuito |
| **30 min** | **~50** | seguro, com folga para as visitas ao site |
| 60 min | ~25 | aceitável; notícias menos frescas |

Se um dia mudar de plano, basta afinar o `cron:` no `ingest.yml` e
`CYCLE_MINUTES`.

## O que já está tratado neste repositório

- **`Dockerfile`** — imagem de produção multi-stage; o container só serve
  (`RUN_WORKER_IN_WEB=false` no Koyeb).
- **`.github/workflows/ingest.yml`** — cron de 30 min, `concurrency` para não
  acumular execuções, `timeout-minutes: 15` para não queimar minutos pendurado.
- **`src/worker.ts`** — agora também corre a **retenção** (máx. 1×/dia,
  heartbeat registado em `system_flag`): no stack gratuito a ingestão não passa
  pelo processo web, e é a retenção que mantém a base dentro dos 0,5 GB do Neon
  (ver `src/pipeline/retention.ts` — já existia para o limite de 1 GB do Render).
- **Migração idempotente** — Actions e web podem correr `migrate()` contra o
  Neon sem conflito.

## Limitações honestas (sem surpresas)

- **Koyeb dorme após 1 h sem tráfego.** O primeiro visitante espera segundos a
  mais (cold start) e o Neon pode demorar mais alguns a acordar. Não perde
  dados; apenas latency pontual.
- **GitHub Actions em repos privados consome minutos** (2 000/mês gratuitos;
  este workflow usa ~1 min por ciclo ≈ 1 500/mês — cabe, com pouco folga; em
  repos públicos é ilimitado). O cron da GitHub pode atrasar em horas de pico —
  é normal e inofensivo.
- **Neon autosuspende** entre ciclos — o web service acorda-o à primeira
  consulta (latência extra de 1-2 s na primeira request).
- **Custom domain** nunca é grátis (registo ~10 €/ano); o URL `*.koyeb.app` é.

## Diagnóstico rápido

| Sintoma | Causa provável |
|---|---|
| `/api/health` 200 mas dados antigos | Actions desactivado no repo, ou segredo `DATABASE_URL` em falta |
| `worker:once` falha com SSL | Faltou `?sslmode=require` na connection string |
| `retention` nunca aparece no log do worker | Normal — só corre 1×/dia (ver `system_flag.retention_last_run_at`) |
| Base cresce sem parar | Verificar `docs/PROXIMOS-PASSOS.md` §retenção; o tecto do Neon (0,5 GB) é menor que o do Render |
