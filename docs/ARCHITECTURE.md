# Architecture & Specification Mapping

This document maps the 92-section master specification onto what exists in the repository, and states honestly what is not built yet and why.

---

## 1. Design rationale

### Why the event, not the article, is the primary object

An article is a *report about* something. Five outlets reporting one earthquake are five articles and one earthquake. If the article were primary, the product would be a feed with duplicates; the interesting questions — *do sources agree? what changed? how confident are we?* — are only answerable at the level of the occurrence.

So `event` owns identity (`EVT-YYYY-MM-DD-XXXXXXXX`, permanent), state, geography, measurements and scores. `article` is evidence attached to it. Titles change, events do not.

### Why the core pipeline is deterministic

The specification demands that no information is invented. A language model asked to summarise sparse inputs will produce fluent, plausible, unverifiable prose — exactly the failure mode being prohibited.

Every component in the running pipeline — classification, geocoding, clustering, contradiction detection, verification, scoring — is a pure, inspectable function of stored data. Consequences:

- results are reproducible, and tests can assert exact values;
- when inputs are insufficient the system returns `insufficient_data`, which cannot be papered over;
- the system works with zero API keys and zero inference cost;
- there is no code path where a model can author a fact.

The `Agent` interface (`src/agents/types.ts`) is designed so LLM agents drop in later as *additional* structure-extractors whose outputs are versioned, supervised and gated exactly like the deterministic ones. Until a provider is configured, they report `UNAVAILABLE` — never a guess.

### Why source reliability and event confidence are separate

Specification §11. A 98-reliability instrument like USGS reporting a magnitude produces high *source reliability* but, without independent corroboration, still limited *event confidence*. Collapsing these into one number would let a single trusted source manufacture certainty. They are stored separately, computed separately, and displayed separately.

---

## 2. Data model

23 tables in `src/db/schema.sql`, PostgreSQL dialect, identical on PGlite (local) and Render Postgres (production).

| Group | Tables |
|---|---|
| Sources | `source`, `source_health` |
| Content | `article` |
| Events | `event`, `event_state_history`, `timeline_entry` |
| Truth | `claim`, `evidence`, `conflict`, `provenance` |
| Scoring | `score`, `score_change` |
| Agents | `agent_run`, `supervisor_review`, `review_queue` |
| Metrics | `event_view` |
| Control | `audit_log`, `security_event`, `system_flag`, `schema_meta` |

Design notes worth stating:

- **`article.payload`** stores the verbatim provider record. Any extracted number can be re-derived and checked against its origin.
- **`source.publisher_group`** is what makes independence real. Thirty sites republishing one agency is one confirmation, not thirty (§13).
- **`score.factors`** is not optional. A score row without its breakdown is meaningless, and a test enforces that every persisted score has one.
- **`event_view.counted` + `reject_reason`** keeps rejected views for auditing instead of discarding them, so manipulation attempts remain visible.
- **`audit_log`** is append-only by convention and never deleted (§32, §34).

---

## 3. Pipeline stages

### Ingestion (`src/ingestion/`)

Fetch with timeout and a descriptive user agent → parse → normalize → deduplicate by URL-derived id → insert with full payload. Source health (status, latency, item count, parse failures, consecutive failures, last error) is recorded on every attempt.

**On failure, nothing is substituted.** The source is marked `offline` or `degraded`, the error is stored and surfaced on `/status`, and an audit entry is written (§42, §74).

The RSS parser is dependency-free and defensive: items without a resolvable URL are dropped (no URL ⇒ no provenance), implausible timestamps become `null` rather than being coerced, and coordinates outside valid ranges are discarded. It extracts georss/geo coordinates and structured provider fields (GDACS severity, affected population, event id) only when the feed actually publishes them.

### Classification (`src/pipeline/classify.ts`)

Weighted keyword rules across 21 categories, bilingual PT/EN, matched on **word boundaries**. Every assignment records which terms fired and the runner-up category. If nothing fires, the result is `unclassified` — and the quality gate then refuses to publish it. Nothing is forced into a bucket to fill the interface.

### Geo (`src/pipeline/geo.ts`)

Provider coordinates are `exact`. Gazetteer matches are `approximate` and labelled `APPROXIMATE LOCATION` in the UI and on the map. When only the source's country of registration is known, **no coordinates are emitted at all**. False precision is the failure mode being avoided (§16).

### Clustering (`src/pipeline/cluster.ts`)

Priority order:

1. **Provider event identity** — authoritative when the feed publishes a stable id.
2. **Exact content hash** — verbatim duplicates.
3. **Similarity** — max(title Jaccard, 0.9 × body Jaccard), plus bonuses for shared rare tokens and geographic proximity.

Hard blockers run before scoring: >250 km apart with known coordinates, different countries without coordinates, or differing provider event ids ⇒ never merged.

> Both blockers exist because of defects observed against live data. Without provider identity, 255 unrelated GDACS wildfire alerts collapsed into a single "event" purely because they share a headline template. Without the proximity rule, distant same-category stories merged. Conversely, the similarity path is what correctly merges BBC + Guardian on one airstrike, and RTP + Público on one story.

### Agents (`src/agents/`)

The orchestrator selects only applicable agents (§7 — an earthquake does not run the crypto agent), executes them, and records each run with agent version, mode, input article ids, output, confidence, status and duration (§35).

| Agent | Role |
|---|---|
| `natural_events` | extracts provider measurements and coordinates verbatim |
| `war_conflict` | separates `CONFIRMED` / `CLAIMED` / `UNVERIFIED` / `DISPUTED`; attributed statements never become fact |
| `entity` | surface-form extraction, honestly labelled as unresolved |
| `contradiction` | finds numeric disagreement across sources and **shows it without resolving it** |
| `verification` | five structural checks → `VERIFIED` / `UNCERTAIN` / `UNVERIFIED` |

### Supervisor and quality gate

The supervisor is a genuinely independent layer (§8): it validates the agents' work rather than repeating it. Blocking checks (article exists, URL resolvable, title traceable to a real article) and review checks (timestamps, agent failures, confidence computed and above threshold, high impact with low confidence, unresolved conflicts) produce `APPROVE` / `REVIEW_REQUIRED` / `BLOCK`.

The quality gate (§79) then re-asks the publication questions: source exists, provenance, timestamp, classified, confidence computed, supervisor approved. Failure means the event lands in the human review queue — **it does not get published as fact**.

### Scoring (`src/pipeline/scoring.ts`)

Six scores, each a pure function with a persisted factor breakdown, versioned by `FORMULA_VERSION`. `NULL` when inputs are insufficient, rendered `N/A`. Trending requires counted views and returns `NULL` otherwise, or when an administrator has frozen it. Changes are diffed into `score_change` with a reason.

---

## 4. Security, privacy, integrity

- **Secure by default**: `ADMIN_TOKEN` unset ⇒ the entire admin API returns 503. No credential is ever shipped to the browser.
- **Timing-safe token comparison**; failed attempts write a `security_event`.
- **Rate limiting** per route-prefix and client, plus tighter limits on view recording.
- **Security headers** including CSP, `nosniff`, `Referrer-Policy`, and HSTS in production.
- **Anti-manipulation** (§27): bot user-agents rejected, 30-minute dedupe window per session per event, hourly session cap. Rejections are stored with a reason for auditing.
- **Privacy** (§71): no IP is stored. `sessionHash = sha256(salt | date | ip | ua)`, truncated, rotating daily — sufficient to stop refresh inflation, insufficient to identify a person.
- **Copyright** (§72): title, feed-provided summary, link. No full-text republication.
- **Test-data blocking** (§3): CI scans the tree for `Math.random`, faker, placeholder URLs and synthetic-dataset symbols; at runtime `guardAgainstTestData()` exits a production process whose database contains flagged rows or suspect hosts. Host matching is used rather than whole-URL matching, because a Guardian article *about* deepfakes is real journalism, not fake data.

---

## 5. Section-by-section status

| § | Requirement | Status |
|---|---|---|
| 1–2 | Pipeline, zero simulation | Built; enforced by gate + CI + runtime guard |
| 3 | Test-data blocking | Built (two layers) |
| 4 | Engineering priorities | Followed: integrity → security → accuracy → verifiability |
| 5–6 | Event-first, lifecycle | Built; permanent ids, `event_state_history` |
| 7–8 | Orchestrator, supervisor | Built, with selective agent execution |
| 9 | Specialist agents | 5 deterministic agents built; framework ready for the rest |
| 10–13 | Source intelligence, reliability, provenance, independence | Built; `publisher_group` drives independence |
| 14–15 | Duplicates/clustering, entities | Built |
| 16–17 | Geo, timeline | Built, with explicit approximation labelling |
| 18–19 | Verification, contradiction | Built; conflicts shown, never auto-resolved |
| 20–21 | Scoring, transparency | Built; "Why this score?" on every event |
| 22–24 | Event intelligence, updates, change detection | Built; `score_change` powers "What changed?" |
| 25–26 | Freshness, trending | Built; category-dependent thresholds; trending needs real views |
| 27–28 | Anti-manipulation, views | Built |
| 29 | Event graph | Related-events implemented; full graph is roadmap |
| 30 | Scenarios | Deliberately no invented probabilities |
| 31–32 | Review queue, human override | Built and audited |
| 33–35 | Audit agent, trail, AI versioning | Built |
| 36–39 | Security agent, architecture, API, DB security | Built |
| 40 | Backup / DR | Render-managed Postgres; restore testing is an operational task |
| 41 | Emergency controls | Built: 5 audited flags |
| 42 | Source health | Built and surfaced on `/status` |
| 43–56 | Frontend, navigation, dashboard, cards, event page, map, search, filters, trending, most viewed, today | Built |
| 57–58 | Alerts, daily brief | Schema ready; not exposed (would be empty) |
| 59–60 | Sharing, SEO | Canonical URLs, OG tags, JSON-LD, sitemap, robots |
| 61 | Multilingual | UI in PT-PT; category labels centralised for extraction |
| 62 | Database | 23 tables |
| 63–67 | Queues, cache, performance, scalability, cost | Background cycle, indexed queries, modular design, zero inference cost |
| 68–69 | Admin centre | API complete; admin UI is roadmap |
| 70 | Monitoring | `/api/status` + `/api/health` |
| 71–73 | Privacy, copyright, accessibility | Built: no PII, no full text, semantic HTML, skip link, focus states, reduced motion, ARIA |
| 74–75 | Fail safe, no fake states | Built |
| 76–78 | Quality gates, testing | Built: 33 tests + CI |
| 79 | Information quality gate | Built |
| 80–82 | Analytics, retention, growth | Real counters only; no fake engagement |
| 83–84 | Support / independence | Shows `NO PAYMENT DETAILS CONFIGURED`; donations cannot affect ranking (no such code path exists) |
| 85 | Future architecture | Interfaces prepared |
| 86 | Phases | Phases 1–3 complete; 4 largely complete; 5 substantially complete |
| 87–92 | Definition of done, philosophy | Data/intelligence/trust/security/quality met for the built surface |

---

## 6. Roadmap

**Next**
1. Admin UI over the existing admin API (the API is complete; only the interface is missing).
2. Accounts + "My Intelligence" — follow countries, categories, events; then alerts and the daily brief become meaningful rather than empty.
3. Full event graph: typed relations (`caused_by`, `escalation_of`, `same_actor`) on top of the current related-events query.

**Then**
4. LLM specialist agents behind the existing `Agent` interface, constrained to structure extraction and cited claims, versioned and supervised like every other agent. Cost controls per §67.
5. Additional languages — the fact layer stays untranslated by construction (§61).
6. Public API with keys and quotas.

**Operational**
7. Restore testing. An untested backup is not a backup (§40).
8. Source expansion, each with a written reliability basis. No source is added without one.
