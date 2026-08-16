-- GLOBAL NEWS INTELLIGENCE — canonical schema
-- Dialect: PostgreSQL (runs on Render Postgres and on PGlite locally)
-- Rule: every row that reaches the frontend must be traceable to a real source row.

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------- SOURCES
CREATE TABLE IF NOT EXISTS source (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  homepage_url      TEXT NOT NULL,
  feed_url          TEXT NOT NULL,
  kind              TEXT NOT NULL,      -- rss | geojson | api
  origin_type       TEXT NOT NULL,      -- official | scientific | agency | outlet
  country           TEXT,
  language          TEXT NOT NULL,
  categories        TEXT NOT NULL DEFAULT '',
  publisher_group   TEXT,               -- independence: same group => not independent
  syndication_of    TEXT REFERENCES source(id),
  reliability_score INTEGER,            -- 0..100, NULL = not yet assessed
  reliability_basis TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  blocked           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_health (
  source_id        TEXT PRIMARY KEY REFERENCES source(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'unknown', -- online | degraded | offline | unknown
  last_attempt_at  TIMESTAMPTZ,
  last_success_at  TIMESTAMPTZ,
  last_error       TEXT,
  response_ms      INTEGER,
  items_last_run   INTEGER,
  parse_failures   INTEGER NOT NULL DEFAULT 0,
  consecutive_fail INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- ARTICLES
CREATE TABLE IF NOT EXISTS article (
  id             TEXT PRIMARY KEY,          -- ART-<sha1(url)>
  source_id      TEXT NOT NULL REFERENCES source(id),
  url            TEXT NOT NULL UNIQUE,
  canonical_url  TEXT,
  title          TEXT NOT NULL,
  summary        TEXT,                      -- source-provided abstract only, never generated prose
  raw_hash       TEXT NOT NULL,
  content_hash   TEXT NOT NULL,             -- normalized title+summary, for duplicate detection
  published_at   TIMESTAMPTZ,
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  language       TEXT,
  category       TEXT,                      -- assigned by classifier
  category_basis TEXT,                      -- which rule/keyword fired: no opaque scores
  geo_country    TEXT,
  geo_place      TEXT,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  geo_precision  TEXT,                      -- exact | approximate | unknown
  geo_basis      TEXT,
  event_id       TEXT,
  is_test_data   BOOLEAN NOT NULL DEFAULT FALSE,
  payload        TEXT NOT NULL              -- verbatim provider record (JSON)
);
CREATE INDEX IF NOT EXISTS idx_article_event      ON article(event_id);
CREATE INDEX IF NOT EXISTS idx_article_published  ON article(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_chash      ON article(content_hash);
CREATE INDEX IF NOT EXISTS idx_article_category   ON article(category);

-- ---------------------------------------------------------------- EVENTS
CREATE TABLE IF NOT EXISTS event (
  id              TEXT PRIMARY KEY,          -- EVT-YYYY-MM-DD-XXXXXXXX (permanent)
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,             -- always the title of a real article
  title_source_id TEXT REFERENCES article(id),
  category        TEXT NOT NULL,
  status          TEXT NOT NULL,             -- see lifecycle
  verification    TEXT NOT NULL DEFAULT 'UNVERIFIED', -- VERIFIED|UNCERTAIN|DISPUTED|UNVERIFIED
  country         TEXT,
  place           TEXT,
  lat             DOUBLE PRECISION,
  lon             DOUBLE PRECISION,
  geo_precision   TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  last_verified_at TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  article_count   INTEGER NOT NULL DEFAULT 0,
  independent_sources INTEGER NOT NULL DEFAULT 0,
  measurements    TEXT,                       -- JSON of provider-supplied numbers only
  is_test_data    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_event_activity ON event(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_category ON event(category);
CREATE INDEX IF NOT EXISTS idx_event_country  ON event(country);
CREATE INDEX IF NOT EXISTS idx_event_status   ON event(status);

CREATE TABLE IF NOT EXISTS event_state_history (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeline_entry (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  at         TIMESTAMPTZ NOT NULL,
  label      TEXT NOT NULL,
  article_id TEXT REFERENCES article(id),
  source_id  TEXT REFERENCES source(id),
  confidence INTEGER
);
CREATE INDEX IF NOT EXISTS idx_timeline_event ON timeline_entry(event_id, at);

-- ---------------------------------------------------------------- CLAIMS / EVIDENCE
CREATE TABLE IF NOT EXISTS claim (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,     -- verbatim or structured, never paraphrased into new facts
  kind        TEXT NOT NULL,     -- FACT|STATEMENT|CLAIMED|MEASUREMENT|OPINION
  status      TEXT NOT NULL,     -- CONFIRMED|CLAIMED|UNVERIFIED|DISPUTED|DEBUNKED
  first_article_id TEXT REFERENCES article(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id         TEXT PRIMARY KEY,
  claim_id   TEXT NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES article(id),
  source_id  TEXT NOT NULL REFERENCES source(id),
  stance     TEXT NOT NULL,      -- supports | contradicts | mentions
  excerpt    TEXT,               -- short quote from the source, attributed
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conflict (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,      -- magnitude | depth | casualties | date | location
  detail     TEXT NOT NULL,      -- JSON: [{source_id, article_id, value}]
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved   BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------- PROVENANCE
CREATE TABLE IF NOT EXISTS provenance (
  id          BIGSERIAL PRIMARY KEY,
  object_type TEXT NOT NULL,     -- event | claim | score | measurement
  object_id   TEXT NOT NULL,
  field       TEXT NOT NULL,
  value       TEXT,
  source_id   TEXT REFERENCES source(id),
  article_id  TEXT REFERENCES article(id),
  origin_url  TEXT,
  derivation  TEXT NOT NULL,     -- verbatim | computed | provider_field
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prov_object ON provenance(object_type, object_id);

-- ---------------------------------------------------------------- SCORING
CREATE TABLE IF NOT EXISTS score (
  id           BIGSERIAL PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,    -- relevance|confidence|life_impact|trending|evidence_strength|source_reliability
  value        INTEGER,          -- NULL == N/A (insufficient data). Never a random filler.
  factors      TEXT NOT NULL,    -- JSON [{factor, weight, input, contribution}]
  formula_ver  TEXT NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_score_event ON score(event_id, kind, computed_at DESC);

CREATE TABLE IF NOT EXISTS score_change (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  old_value  INTEGER,
  new_value  INTEGER,
  reason     TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- AGENTS / AI
CREATE TABLE IF NOT EXISTS agent_run (
  id            BIGSERIAL PRIMARY KEY,
  event_id      TEXT REFERENCES event(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  mode          TEXT NOT NULL,   -- deterministic | llm
  model         TEXT,
  model_version TEXT,
  prompt_version TEXT,
  input_refs    TEXT NOT NULL,   -- JSON list of article ids
  output        TEXT NOT NULL,   -- JSON
  confidence    INTEGER,
  status        TEXT NOT NULL,   -- ok | insufficient_data | unavailable | blocked
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agentrun_event ON agent_run(event_id, started_at DESC);

CREATE TABLE IF NOT EXISTS supervisor_review (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL,      -- APPROVE | REANALYZE | BLOCK | REVIEW_REQUIRED
  findings   TEXT NOT NULL,      -- JSON list of check results
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_queue (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 50,
  state      TEXT NOT NULL DEFAULT 'open', -- open | approved | rejected | held
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- VIEWS / TRENDING
CREATE TABLE IF NOT EXISTS event_view (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,   -- salted hash, no raw IP stored
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  counted     BOOLEAN NOT NULL DEFAULT TRUE,
  reject_reason TEXT            -- dedupe_window | rate_limit | bot_pattern
);
CREATE INDEX IF NOT EXISTS idx_view_event ON event_view(event_id, at DESC);

-- ---------------------------------------------------------------- AUDIT / SECURITY
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id  TEXT,
  prev_state TEXT,
  new_state  TEXT,
  reason     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type, object_id, at DESC);

CREATE TABLE IF NOT EXISTS security_event (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind    TEXT NOT NULL,
  severity TEXT NOT NULL,
  detail  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_flag (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'system'
);

-- ---------------------------------------------------------------- USERS (§56, §71)
-- Data minimisation: email + password hash only. No name, no profile, no tracking.
CREATE TABLE IF NOT EXISTS app_user (
  id            TEXT PRIMARY KEY,          -- USR-<random>
  email         TEXT NOT NULL UNIQUE,
  email_lower   TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,             -- scrypt: N$r$p$salt$hash, never plaintext
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  disabled      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_session (
  id         TEXT PRIMARY KEY,             -- opaque random token id
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,                -- sha256 of the cookie secret; raw value never stored
  csrf       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_session_user ON user_session(user_id, expires_at);

-- Follows: countries, categories, individual events (§56)
CREATE TABLE IF NOT EXISTS follow (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                -- country | category | event
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_follow_user ON follow(user_id);

CREATE TABLE IF NOT EXISTS bookmark (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmark_user ON bookmark(user_id, created_at DESC);
