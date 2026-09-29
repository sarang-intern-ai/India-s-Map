-- 0003_crs — raw per-station Community Radio records (from CRS(data).xlsx). The per-district
-- station COUNT is DERIVED from these rows by the API (never stored/duplicated), so this table is
-- the single source of truth for both the CRS DATA detail UI and the Community Radio aggregate.
-- Source-isolated by source_id, exactly like dataset_records — it cannot affect other sources.

CREATE TABLE IF NOT EXISTS crs_records (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    text NOT NULL,
  source_key   text NOT NULL,                 -- stable identity (content hash; survives reorder + edits)
  district_id  text NOT NULL,                 -- reconciled canonical id (only matched rows are stored)
  s_no         integer,
  crs_name     text NOT NULL,
  organization text,
  location     text,
  language     text,                          -- NULL when blank in the sheet → UI shows "Not available"
  hours        double precision,              -- No. of Hours; NULL when blank (this is NOT frequency)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crs_records_identity_uq ON crs_records (source_id, source_key);
CREATE INDEX IF NOT EXISTS crs_records_district_idx ON crs_records (district_id);
CREATE INDEX IF NOT EXISTS crs_records_source_idx   ON crs_records (source_id);
