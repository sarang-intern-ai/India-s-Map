-- 0001_init — external dataset schema (district datasets only; NO geometry, NO PostGIS).
-- The geographic data stays static in public/data/lgd-2024/ and is never copied here.

-- dataset_records: one normalized atomic row per DatasetRecord.
CREATE TABLE IF NOT EXISTS dataset_records (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Canonical join key. Same string the map uses (e.g. '469', '490'). NEVER a name.
  district_id   text NOT NULL CHECK (length(trim(district_id)) > 0),
  dataset_type  text NOT NULL CHECK (length(trim(dataset_type)) > 0),
  sub_type      text NOT NULL CHECK (length(trim(sub_type)) > 0),

  -- Typed value union: exactly one of the three columns is populated per value_type.
  value_type    text NOT NULL CHECK (value_type IN ('number', 'text', 'boolean')),
  value_number  double precision,
  value_text    text,
  value_boolean boolean,

  -- Unit is data; may be '' for boolean/text, but never NULL.
  unit          text NOT NULL DEFAULT '',

  source        text,
  last_updated  text,
  notes         text,

  -- Import provenance / idempotency identity (see docs/DATABASE.md).
  source_name   text NOT NULL,
  source_key    text NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Exactly one typed value, matching value_type.
  CONSTRAINT dataset_records_one_value CHECK (
    (value_type = 'number'  AND value_number  IS NOT NULL AND value_text IS NULL AND value_boolean IS NULL) OR
    (value_type = 'text'    AND value_text    IS NOT NULL AND value_number IS NULL AND value_boolean IS NULL) OR
    (value_type = 'boolean' AND value_boolean IS NOT NULL AND value_number IS NULL AND value_text IS NULL)
  ),
  CONSTRAINT dataset_records_time_order CHECK (updated_at >= created_at)
);

-- Idempotency identity: one row per source row. UNIQUE on source_key lets re-import upsert the
-- same source row instead of duplicating it. It is intentionally NOT unique on
-- (district_id, dataset_type, sub_type) — legitimate duplicate observations (distinct source
-- rows) must be allowed to coexist and be flagged by the app, not merged by the database.
CREATE UNIQUE INDEX IF NOT EXISTS dataset_records_source_key_uq ON dataset_records (source_key);

-- Indexes for the two expected queries (district lookup; state rollup via districts_reference).
CREATE INDEX IF NOT EXISTS dataset_records_district_idx      ON dataset_records (district_id);
CREATE INDEX IF NOT EXISTS dataset_records_district_type_idx ON dataset_records (district_id, dataset_type);
CREATE INDEX IF NOT EXISTS dataset_records_type_idx          ON dataset_records (dataset_type);

-- districts_reference: the MINIMAL identity mapping the DB needs — districtId → stateId.
-- Seeded from the project's authoritative hierarchy (public/data/lgd-2024/hierarchy.json), never
-- from spreadsheet state names. No polygons, no names beyond the ids.
CREATE TABLE IF NOT EXISTS districts_reference (
  district_id text PRIMARY KEY,
  state_id    text NOT NULL CHECK (length(trim(state_id)) > 0)
);
CREATE INDEX IF NOT EXISTS districts_reference_state_idx ON districts_reference (state_id);
