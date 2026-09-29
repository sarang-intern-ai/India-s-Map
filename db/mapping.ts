import type { DatasetRecord, DatasetValue } from '../src/data/datasetRecords.ts';

/**
 * Pure, lossless mapping between a {@link DatasetRecord} and a `dataset_records` DB row.
 *
 * The value union is preserved by an explicit `value_type` plus three typed columns
 * (`value_number` / `value_text` / `value_boolean`) — never an untyped text/JSON blob. Exactly
 * one typed column is populated per row (a DB CHECK constraint enforces this too). These same two
 * functions are used by the import (record → row) and the API (row → record), so a round-trip is
 * identity — which is what makes Excel and PostgreSQL produce byte-identical DatasetRecords.
 *
 * `district_name` is deliberately NOT stored: the id is the only identity, and display names come
 * from the official LGD reconciliation. It is semantically not part of the record contract.
 */

export type DbValueType = 'number' | 'text' | 'boolean';

/** The insertable columns for one dataset row (id / created_at / updated_at are DB-managed). */
export type DatasetInsert = {
  district_id: string;
  dataset_type: string;
  sub_type: string;
  value_type: DbValueType;
  value_number: number | null;
  value_text: string | null;
  value_boolean: boolean | null;
  unit: string;
  source: string | null;
  last_updated: string | null;
  notes: string | null;
  /** Logical source (e.g. "main-dataset") — deletions are scoped to it, so sources can't collide. */
  source_id: string;
  /** Stable identity within the source (see db/identity.ts). */
  source_key: string;
  /** Optional business id from the sheet's record_id column (null when absent). */
  record_id: string | null;
  /** Provenance: which file/provider produced this row. */
  source_name: string;
};

/** A row as read back from `dataset_records` (only the columns the API needs). */
export type DatasetRow = {
  district_id: string;
  dataset_type: string;
  sub_type: string;
  value_type: DbValueType;
  value_number: number | null;
  value_text: string | null;
  value_boolean: boolean | null;
  unit: string;
  source: string | null;
  last_updated: string | null;
  notes: string | null;
};

export function valueTypeOf(value: DatasetValue): DbValueType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

/** DatasetRecord → insertable columns, tagged with source identity. */
export function recordToInsert(
  record: DatasetRecord,
  opts: { sourceId: string; sourceKey: string; recordId: string | null; sourceName: string },
): DatasetInsert {
  const value_type = valueTypeOf(record.value);
  return {
    district_id: record.districtId,
    dataset_type: record.datasetType,
    sub_type: record.subType,
    value_type,
    value_number: value_type === 'number' ? (record.value as number) : null,
    value_text: value_type === 'text' ? (record.value as string) : null,
    value_boolean: value_type === 'boolean' ? (record.value as boolean) : null,
    unit: record.unit,
    source: record.source ?? null,
    last_updated: record.lastUpdated ?? null,
    notes: record.notes ?? null,
    source_id: opts.sourceId,
    source_key: opts.sourceKey,
    record_id: opts.recordId,
    source_name: opts.sourceName,
  };
}

/** DB row → DatasetRecord — the exact shape the frontend already understands. */
export function rowToRecord(row: DatasetRow): DatasetRecord {
  const value: DatasetValue =
    row.value_type === 'number'
      ? Number(row.value_number)
      : row.value_type === 'boolean'
        ? Boolean(row.value_boolean)
        : String(row.value_text ?? '');

  const record: DatasetRecord = {
    districtId: row.district_id,
    datasetType: row.dataset_type,
    subType: row.sub_type,
    value,
    unit: row.unit,
  };
  if (row.source != null) record.source = row.source;
  if (row.last_updated != null) record.lastUpdated = row.last_updated;
  if (row.notes != null) record.notes = row.notes;
  return record;
}
