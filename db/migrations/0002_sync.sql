-- 0002_sync — automatic spreadsheet → PostgreSQL synchronization support.

-- Explicit logical source + optional business record id, for a stable identity that survives row
-- reorder/insert/delete (see docs/DATABASE.md §identity). `source_key` becomes the STABLE identity
-- within a source (a record_id when the sheet provides one, else a content hash of the semantic
-- fields + occurrence), not the old file:sheet:line position.
ALTER TABLE dataset_records ADD COLUMN IF NOT EXISTS source_id  text NOT NULL DEFAULT 'main-dataset';
ALTER TABLE dataset_records ADD COLUMN IF NOT EXISTS record_id  text;

-- Replace the position-based unique with a per-source identity unique. The first sync rewrites the
-- old file:sheet:line keys into content-hash keys (one-time), atomically.
DROP INDEX IF EXISTS dataset_records_source_key_uq;
CREATE UNIQUE INDEX IF NOT EXISTS dataset_records_identity_uq ON dataset_records (source_id, source_key);
CREATE INDEX IF NOT EXISTS dataset_records_source_id_idx ON dataset_records (source_id);

-- Sync history — one row per completed attempt. No secrets.
CREATE TABLE IF NOT EXISTS dataset_sync_runs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id         text NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  status            text NOT NULL CHECK (status IN ('success', 'no_changes', 'failed')),
  rows_read         int NOT NULL DEFAULT 0,
  inserted_count    int NOT NULL DEFAULT 0,
  updated_count     int NOT NULL DEFAULT 0,
  deleted_count     int NOT NULL DEFAULT 0,
  unchanged_count   int NOT NULL DEFAULT 0,
  warning_count     int NOT NULL DEFAULT 0,
  error_count       int NOT NULL DEFAULT 0,
  source_fingerprint text,
  message           text
);
CREATE INDEX IF NOT EXISTS dataset_sync_runs_source_idx ON dataset_sync_runs (source_id, id DESC);

-- Lightweight serving state per source — powers GET /api/datasets/version so the frontend can
-- cheaply detect a data change without refetching the whole dataset.
CREATE TABLE IF NOT EXISTS dataset_source_state (
  source_id        text PRIMARY KEY,
  fingerprint      text,
  version          text,            -- changes iff the served data changed
  data_updated_at  timestamptz,     -- when the served data last actually changed
  last_sync_status text,            -- success | no_changes | failed
  last_synced_at   timestamptz      -- when a sync last ran (even a no-op)
);
