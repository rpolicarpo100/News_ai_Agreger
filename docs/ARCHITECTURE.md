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
| Accounts | `app_user`, `user_session`, `follow`, `bookmark` |
| Graph | `event_relation` |
| Alerts | `alert_rule`, `notification` |

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

### Alerts (`src/pipeline/alerts.ts`)

Rules are evaluated against published events on every pipeline cycle, and immediately on creation so a new rule is never silently empty until the next run. Two invariants:

- **No unconstrained rules.** A rule with no filter at all is refused rather than matching everything.
- **N/A never passes a threshold.** Score comparisons coalesce a missing value to `-1`, so an event whose confidence could not be computed does not satisfy `confidence >= 50`. Treating unknown as passing would manufacture certainty.

Notifications carry a `UNIQUE (user_id, rule_id, event_id)` constraint, so re-running the cycle cannot re-notify. Deleting an account cascades to both rules and notifications.

The Daily Brief selects and ranks real events; it does not write prose. Its window is measured on `published_at` (server-generated) rather than `last_activity_at`, because feeds legitimately publish timestamps a few minutes in the future and those were leaking events into windows they did not belong to. That same discovery led to clamping `last_activity_at` to `now()` at write time in the clustering stage.

### Event graph (`src/pipeline/graph.ts`)

Five relation kinds, each edge storing `strength` (0-100) and a written `basis`. Relations are discovered from shared evidence; when two events share nothing measurable, no edge exists.

Tuning against live data drove four corrections, each of which is now a regression test:

1. **False precision.** Gazetteer country centroids are identical for every event in a country, so measuring between two of them reported "0 km apart" at strength 95. Distance is now computed only between coordinates the source actually published (`geo_precision='exact'`); approximate positions degrade to a weaker, clearly-labelled country-level statement (§16).
2. **Publisher country as location.** `country='GB', geo_precision='unknown'` means only "the BBC published it". A Belgian wildfire was being linked to a Virginia shooting on that basis. Country now counts as a location claim only when it came from the text or from coordinates.
3. **Template headlines.** Raw Jaccard rated "Green forest fire notification in Angola" and "... in Zambia" as near-identical, producing 3453 meaningless topic edges. Similarity is now IDF-weighted against the current batch, so boilerplate contributes almost nothing: 3453 → 169 edges, with *higher* average strength.
4. **Boilerplate entities.** "Depth", "UTC", "MMI IV" and navigation chrome like "Today's APOD Archive Submissions" were counting as shared actors. Fixed at both ends: the entity agent rejects runs longer than three words and word-repeating fragments, and the graph filters entities by corpus document-frequency plus a proper-noun shape test.

Points 3 and 4 use corpus statistics rather than hardcoded lists, so they generalise to feeds that have not been added yet.

`cross_domain_impact` links categories that often co-occur meaningfully (war→energy→economy, earthquake→transport), but only with a shared located country and a tight window — and its basis explicitly states that the relation is correlational. Asserting causation from co-occurrence would be precisely the invented conclusion §30 forbids.

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
- **Admin sessions**: the `ADMIN_TOKEN` is exchanged for an httpOnly cookie carrying `base64(expiry).hmac(token, "session|expiry")`. Because the HMAC key *is* the admin token, rotating the credential invalidates every live session — the correct behaviour for a rotation. Progressive lockout after 5 failed logins, recorded as security events.
- **User passwords**: Node's built-in scrypt (N=16384, r=8, p=1) with a unique 16-byte salt per password. Session cookies are opaque random tokens; only their SHA-256 is stored, so a database leak yields no usable cookies. Login returns one message for both unknown email and wrong password, and performs hashing work even when the account does not exist, so neither response body nor timing discloses whether an account exists.
- **CSRF**: double-submit tokens on every mutating admin and account form. Failures are logged.
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
| 29 | Event graph | Built: 5 typed relation kinds, each edge storing its evidence; correlation never presented as causation |
| 30 | Scenarios | Deliberately no invented probabilities |
| 31–32 | Review queue, human override | Built and audited |
| 33–35 | Audit agent, trail, AI versioning | Built |
| 36–39 | Security agent, architecture, API, DB security | Built |
| 40 | Backup / DR | Render-managed Postgres; restore testing is an operational task |
| 41 | Emergency controls | Built: 5 audited flags |
| 42 | Source health | Built and surfaced on `/status` |
| 43–56 | Frontend, navigation, dashboard, cards, event page, map, search, filters, trending, most viewed, today | Built |
| 56 | Personal Intelligence | Built: accounts, follows (country/category/event), bookmarks, personal feed, GDPR export + erasure |
| 57–58 | Alerts, daily brief | Built: rule engine with in-app inbox delivery; brief selects real events and generates no prose |
| 59–60 | Sharing, SEO | Canonical URLs, OG tags, JSON-LD, sitemap, robots |
| 61 | Multilingual | UI in PT-PT; category labels centralised for extraction |
| 62 | Database | 23 tables |
| 63–67 | Queues, cache, performance, scalability, cost | Background cycle, indexed queries, modular design, zero inference cost |
| 68–69 | Admin centre | Built: control center, sources, review queue, events, audit, security |
| 70 | Monitoring | `/api/status` + `/api/health` |
| 71–73 | Privacy, copyright, accessibility | Built: data minimisation, self-service export + erasure, no full text, semantic HTML, skip link, focus states, reduced motion, ARIA |
| 74–75 | Fail safe, no fake states | Built |
| 76–78 | Quality gates, testing | Built: 33 tests + CI |
| 79 | Information quality gate | Built |
| 80–82 | Analytics, retention, growth | Real counters only; no fake engagement |
| 83–84 | Support / independence | Built: verified Revolut link + EIP-55-checked ETH address, locally-rendered QR codes, copy buttons. Independence enforced by an executable test asserting no scoring/ranking module can import payment config |
| 85 | Future architecture | Interfaces prepared |
| 86 | Phases | Phases 1–3 complete; 4 largely complete; 5 substantially complete |
| 87–92 | Definition of done, philosophy | Data/intelligence/trust/security/quality met for the built surface |

---

## 5b. Payment details

Three rules govern `/support`:

1. **Never display unverified payment data.** §83 says never invent it; the corollary is never to show what has not been checked. The Ethereum address is validated against its EIP-55 checksum at render time. Failure means the method is withheld and the problem surfaced, not silently shown.
2. **Never involve a third party.** QR codes are encoded and rendered to inline SVG in-process. Sending a recipient address to an external image API would leak it and create a tampering surface on the money path.
3. **Never let money touch editorial.** §84 is enforced by a test that reads the source of every scoring, clustering, graph and agent module and asserts none imports the support config or reads `SUPPORT_*` environment variables.

A hand-written QR encoder was built first and discarded: it produced correctly-sized matrices whose modules disagreed with the reference implementation. An unscannable payment QR is worse than a dependency, so it was replaced with `qrcode-generator` (zero transitive dependencies) and verified module-for-module against Python's `qrcode`. Keccak-256, by contrast, was kept in-house — 70 lines, verified against the known-answer and all four EIP-55 vectors — because it removes a supply-chain dependency from the code path that validates the address.

---

## 6. Roadmap

**Next**
1. LLM specialist agents behind the existing `Agent` interface, constrained to structure extraction and cited claims, versioned and supervised like every other agent.
2. Email as a second alert channel, plus password reset (both need the same provider, so they ship together). The in-app inbox means neither is blocking today.
3. Graph traversal UI: explore multi-hop paths between events, with every hop showing its evidence.

**Then**
4. LLM specialist agents behind the existing `Agent` interface, constrained to structure extraction and cited claims, versioned and supervised like every other agent. Cost controls per §67.
5. Additional languages — the fact layer stays untranslated by construction (§61).
6. Public API with keys and quotas.

**Operational**
7. Restore testing. An untested backup is not a backup (§40).
8. Source expansion, each with a written reliability basis. No source is added without one.
