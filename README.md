# Global News Intelligence

**Event-first news intelligence. Real sources, full provenance, explainable scoring, complete audit trail.**

This is not an aggregator. Articles are raw material; the unit of the system is the **event** — a permanent, traceable object that many articles can attach to, that accumulates a timeline, that records where every number came from, and that says plainly when it does not know something.

```
REAL SOURCES → INGESTION → NORMALIZATION → CLASSIFICATION → EVENT DETECTION
→ CLUSTERING → SPECIALIST AGENTS → VERIFICATION → SUPERVISOR → SCORING
→ QUALITY GATE → AUDIT → DATABASE → FRONTEND / API
```

---

## The one rule that overrides every other

**Nothing is ever invented.** Not an event, a number, a coordinate, a quote, a source, a score, or a view count.

This is enforced mechanically, not by convention:

| Guarantee | Where it is enforced |
|---|---|
| Every event traces back to a real article URL | `qualityGate()` blocks publication; a test asserts no published event lacks one |
| Scores are pure functions of stored inputs | `src/pipeline/scoring.ts` — every score persists its factor breakdown |
| A score that cannot be computed is `NULL` → rendered `N/A` | never a filler number |
| Trending requires counted views | no views ⇒ `N/A`, never estimated |
| `Math.random()` cannot reach shipped code | `npm run check:testdata` fails the build |
| Test data cannot reach production | `guardAgainstTestData()` exits the process; CI scans the tree |
| Source failures are shown, not hidden | `/status` reports `offline` / `degraded` with the real error |
| Conflicting numbers are displayed, not resolved | `contradictionAgent` → `SOURCE CONFLICT` panel |
| Copyright | stores title, feed-provided summary and link only — never full text |
| Privacy | no IP stored; view sessions are a salted hash rotating every 24h; accounts store email + scrypt hash only |

If there is no data, the UI says `NO VERIFIED DATA AVAILABLE`. An empty interface is preferable to a false one.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 — embedded Postgres, no setup
```

The first cycle runs at boot: it fetches every registered feed, clusters, verifies, scores and publishes. No API keys are needed — all sources are public feeds.

```bash
npm run worker:once  # run one pipeline cycle and print a full report
npm run gate         # secrets scan → test-data scan → typecheck → 33 tests
npm test
```

With no `DATABASE_URL`, the app uses embedded PGlite at `./data/pgdata`. Set `DATABASE_URL` and it uses real Postgres — identical SQL, no code change.

---

## Deploy: GitHub → Render

```bash
git init && git add -A && git commit -m "Global News Intelligence: foundation + event engine"
git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Then in Render: **New → Blueprint → select the repo**. `render.yaml` provisions a Postgres instance and the web service, generates `VIEW_SALT` and `ADMIN_TOKEN`, and wires `DATABASE_URL` automatically.

After the first deploy set `PUBLIC_BASE_URL` to your Render URL so canonical tags and `sitemap.xml` are correct.

On the free plan the ingestion worker runs inside the web process (`RUN_WORKER_IN_WEB=true`). On a paid plan, enable the `gni-worker` service in `render.yaml` and set `RUN_WORKER_IN_WEB=false` to separate ingestion from serving.

Health check: `GET /api/health`.

---

## What is running today

14 registered sources, all real and publicly documented:

| Kind | Sources |
|---|---|
| Scientific / official | USGS Earthquakes, GDACS (UN/EC), NOAA Tsunami, NASA, ESA, WHO, ECB |
| Outlets | BBC World, BBC Technology, The Guardian, Público, RTP, Observador |
| Preprints | arXiv cs.AI (labelled *not peer reviewed*) |

A representative live cycle: **700 articles → 367 events → 325 published**, 118 exact duplicates collapsed, 133 articles attached to existing events.

Feeds that break are reported as broken. arXiv publishes nothing at weekends, so it shows `degraded` — it is not backfilled.

---

## Architecture

| Concern | Module |
|---|---|
| Ingestion + source health | `src/ingestion/` |
| Classification, geo, clustering, scoring, freshness, views | `src/pipeline/` |
| Agent framework, specialists, orchestrator, supervisor | `src/agents/` |
| API, security middleware | `src/api/` |
| Server-rendered UI | `src/web/render.ts` |
| Schema (23 tables) | `src/db/schema.sql` |

### Event graph

Related events come from typed, evidenced edges rather than a "same category" guess. Five relation kinds — `same_location`, `same_actor`, `same_topic`, `temporal_sequence`, `cross_domain_impact` — each storing the evidence that produced it, shown to the reader:

```
[Sequência temporal 61]  M 2.8 - 10 km ENE of Coso Junction, CA
   Mesmo tipo de acontecimento na mesma área, com 14h de intervalo.
[Mesmas entidades 76]    Democrats demand answers from Trump on USS Abraham Lincoln
   Entidades em comum: Trump, Donald Trump, Iran.
```

`cross_domain_impact` explicitly states that it is correlation, not causation — inferring cause from co-occurrence would be an invented conclusion (§30).

Tuning this against live data cut 5058 edges down to 788 *useful* ones. Four defects, all found by inspecting real output: gazetteer centroids made every pair in a country "0 km apart"; publisher-inferred countries treated a BBC byline as a location; template headlines made unrelated wildfires "the same topic"; and feed furniture ("Depth", "UTC", "APOD Archive Submissions") counted as shared actors. Fixes are corpus-based (IDF weighting, entity document-frequency) rather than hardcoded blocklists, so they generalise to feeds not yet added.

### Event identity

`EVT-YYYY-MM-DD-XXXXXXXX` — permanent. The title may change; the event does not. This is what makes updates, timelines, history, SEO and the future public API possible.

### Clustering, in priority order

1. **Provider event identity** — GDACS and similar publish a stable `eventid`. Authoritative: episodes of one disaster merge, distinct disasters never do.
2. **Exact content hash** — verbatim duplicates.
3. **Lexical + geographic + temporal similarity** — with hard blockers: >250 km apart with known coordinates, or different countries, is never merged.

Both defects that this design prevents were found against live data, not imagined: 255 unrelated wildfires collapsing into one event, and the same Lebanon airstrike sitting in two separate events.

### Source reliability ≠ event confidence

Deliberately separate dimensions, never summed. A 98-reliability source reporting something no one else has yet corroborated still yields an `UNCERTAIN` event. Two feeds from the same publisher group count as **one** confirmation — `publisher_group` drives this.

### Scoring

Six scores: `relevance`, `confidence`, `life_impact`, `trending`, `evidence_strength`, `source_reliability`. Each stores a factor list, so the UI can always answer **"Why this score?"**:

```
independent_publisher_groups   = 2    → +24
official_or_scientific_source  = 0    →   0
best_source_reliability        = 85   → +17
corroborating_article_count    = 3    → +10
unresolved_source_conflicts    = 0    →   0
                                        = 51
```

Changes are diffed into `score_change` with a reason, powering **"What changed?"**.

### Supervisor + quality gate

The orchestrator selects only relevant agents (an earthquake does not run the crypto agent) and records every run with agent version, mode, inputs and duration. The supervisor then independently validates the output — title traceable to a real article, URLs resolvable, timestamps present, confidence computed, no unresolved conflicts — and returns `APPROVE` / `REVIEW_REQUIRED` / `BLOCK`. Anything not approved goes to the human review queue instead of being published.

---

## Admin & accounts

**Admin Control Center** at `/admin` — control center with emergency flags, source health, review queue, event overrides, audit log and security events. Login exchanges the server-side `ADMIN_TOKEN` for an httpOnly signed session cookie; the token never reaches the browser, and rotating it invalidates every live session. Every mutating form carries a CSRF token and requires a written reason, which is stored in the audit trail with before/after state. Failed logins trigger progressive lockout and are recorded as security events. With `ADMIN_TOKEN` unset the entire area returns 503.

**Accounts** at `/account/register` and `/my` — follow categories, countries and individual events; bookmark events; get a personal feed built from real published events only. Data minimisation is the design constraint: an account is an email, a scrypt password hash, and a list of follows. No name, no profile, no behavioural tracking. Session cookies are opaque random tokens stored only as SHA-256, so a database leak yields no usable sessions. `/my/export` returns everything held about the user as JSON; account deletion cascades to sessions, follows and bookmarks (§71).

`/admin`, `/api/admin`, `/my` and `/account` are excluded from `robots.txt`.

## API

```
GET  /api/health
GET  /api/status                 counters, flags, per-source health
GET  /api/events                 ?category= &country= &order= &min_confidence= &min_impact= &since_hours=
GET  /api/events/:id             full intelligence: sources, scores+factors, timeline, conflicts, agent runs, supervisor
GET  /api/search?q=              supports "life impact above 80", "today", country and category terms
GET  /api/map                    geolocated events
GET  /api/sources                registry + live health
POST /api/events/:id/view        anti-manipulation applied
```

Admin (bearer `ADMIN_TOKEN`; returns **503 when unset** — secure by default):

```
GET  /api/admin/flags            emergency controls
POST /api/admin/flags            auto_publish · ai_analysis · trending_frozen · restricted_mode · ingestion
GET  /api/admin/review-queue
POST /api/admin/review-queue/:id/resolve
POST /api/admin/sources/:id/block
GET  /api/admin/audit
POST /api/admin/pipeline/run
```

Every admin action is written to `audit_log` with actor, before state, after state and reason. Nothing is ever silently overwritten.

---

## Testing

63 tests covering the critical paths named in the specification: duplicate detection, clustering, source conflict, missing sources, fake-data detection, stale data, score calculation, view counting, trending manipulation, agent failure, authorization, session forgery, CSRF, brute-force lockout, password hashing, GDPR export and erasure, graph relation quality, and regressions for every defect found against live feeds (CDATA parsing, template over-merging, substring misclassification, future timestamps, false-precision graph edges, boilerplate entities).

```bash
npm run gate   # the full pre-deploy sequence; any failure blocks deployment
```

CI runs the same gate on every push (`.github/workflows/ci.yml`).

---

## Status against the specification

**Built and running:** architecture, data model (23 tables), ingestion, normalization, provenance, event model + lifecycle, agent framework, orchestrator, supervisor, verification, contradiction detection, scoring with transparency, freshness, view system, anti-manipulation, audit trail, AI versioning, emergency controls, security middleware, quality gates, test-data blocking, home dashboard, event pages, map, search, filters, trending, category/country pages, SEO, accessibility, PT-PT UI, testing.

Also built: the Admin Control Center (§68, §69, §41) and accounts with My Intelligence (§56, §71).

**Deliberately not faked:** LLM specialist agents are defined by the `Agent` interface but no provider is wired, so they report `UNAVAILABLE` rather than guess. Payment details show `NO PAYMENT DETAILS CONFIGURED` until you supply real ones. Alerts and the daily brief are next: the follow graph they depend on now exists, but a notification system with no delivery channel configured would be a button that does nothing.

See `docs/ARCHITECTURE.md` for the full section-by-section mapping and the roadmap.

---

**Trust the data. Verify the event. Explain the intelligence. Audit everything.**
