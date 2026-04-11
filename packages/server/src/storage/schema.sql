-- Pages metadata index (source of truth is .md files on disk)
CREATE TABLE IF NOT EXISTS pages (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  aliases     TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL DEFAULT 'chat',
  created_at  TEXT NOT NULL,
  modified_at TEXT NOT NULL
);

-- Full-text search on page content
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title,
  content,
  tags,
  tokenize='porter unicode61'
);

-- Explicit links (Layer 1 - derived from wikilinks in .md files)
CREATE TABLE IF NOT EXISTS links (
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

-- Semantic associations (Layer 2)
CREATE TABLE IF NOT EXISTS associations (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  weight      REAL NOT NULL CHECK(weight >= 0.0 AND weight <= 1.0),
  reason      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  stale       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_assoc_source ON associations(source_id);
CREATE INDEX IF NOT EXISTS idx_assoc_target ON associations(target_id);
CREATE INDEX IF NOT EXISTS idx_assoc_type   ON associations(type);

-- Association audit log
CREATE TABLE IF NOT EXISTS association_log (
  id              TEXT PRIMARY KEY,
  association_id  TEXT NOT NULL,
  action          TEXT NOT NULL,
  old_weight      REAL,
  new_weight      REAL,
  model_id        TEXT NOT NULL,
  timestamp       TEXT NOT NULL,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_assoc_log_assoc ON association_log(association_id);

-- Graph positions (pinned nodes)
CREATE TABLE IF NOT EXISTS graph_positions (
  page_id TEXT PRIMARY KEY,
  x       REAL NOT NULL,
  y       REAL NOT NULL
);

-- Chat history
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  graph_delta TEXT,
  created_at  TEXT NOT NULL
);

-- Source memories: original captured items from connectors
-- (Screenpipe Memories, future: Gmail messages, Granola transcripts, etc.)
CREATE TABLE IF NOT EXISTS memory_sources (
  id              TEXT PRIMARY KEY,
  external_source TEXT NOT NULL,             -- "screenpipe", "gmail", etc.
  external_id     TEXT NOT NULL,             -- the upstream id
  content         TEXT NOT NULL,             -- original text
  source_label    TEXT NOT NULL,             -- e.g. "screenpipe / digital-clone"
  tags            TEXT NOT NULL DEFAULT '[]',
  importance      REAL,
  captured_at     TEXT NOT NULL,             -- when the upstream system captured it
  ingested_at     TEXT NOT NULL,             -- when we processed it
  blocked         INTEGER NOT NULL DEFAULT 0 -- if 1, ingestion skips this source
);

CREATE INDEX IF NOT EXISTS idx_memory_sources_external
  ON memory_sources(external_source, external_id);

-- Which source memories produced/touched a page
CREATE TABLE IF NOT EXISTS page_sources (
  page_id    TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  action     TEXT NOT NULL,                  -- "created" or "updated"
  created_at TEXT NOT NULL,
  PRIMARY KEY (page_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_page_sources_source ON page_sources(source_id);

-- Which source memories produced/touched an association
CREATE TABLE IF NOT EXISTS association_sources (
  association_id TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (association_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_assoc_sources_source ON association_sources(source_id);

-- Cached synthesized profile for each page
CREATE TABLE IF NOT EXISTS page_profiles (
  page_id       TEXT PRIMARY KEY,
  profile_md    TEXT NOT NULL,
  source_count  INTEGER NOT NULL DEFAULT 0,
  generated_at  TEXT NOT NULL,
  generated_by  TEXT NOT NULL,
  stale         INTEGER NOT NULL DEFAULT 0
);

-- Event log: chronological record of meaningful events. Stores
-- references to pages/sources, NOT content snippets, so deleting a
-- page or source automatically scrubs the displayed value (the log
-- view resolves IDs to current state at read time).
CREATE TABLE IF NOT EXISTS event_log (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,    -- "ingest", "page_create", "page_update",
                                --  "page_delete", "source_delete",
                                --  "source_block", "lint", "chat_query"
  page_id     TEXT,             -- nullable reference (not enforced)
  source_id   TEXT,             -- nullable reference (not enforced)
  text        TEXT,             -- only for inherently-content events
                                --  (chat_query, lint summary)
  meta        TEXT,             -- JSON, for extras like counts
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(type);
CREATE INDEX IF NOT EXISTS idx_event_log_page ON event_log(page_id);
CREATE INDEX IF NOT EXISTS idx_event_log_source ON event_log(source_id);

-- Connectors: external data sources
CREATE TABLE IF NOT EXISTS connectors (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,            -- "screenpipe", "gmail", "granola", etc.
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 0,
  config          TEXT NOT NULL DEFAULT '{}',  -- JSON: connector-specific settings
  state           TEXT NOT NULL DEFAULT '{}',  -- JSON: cursor, last_sync, stats
  last_sync_at    TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type);
