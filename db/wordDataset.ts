import type { DatasetRecord } from '../src/data/datasetRecords.ts';
import type { DatasetDiagnostic } from '../src/data/datasetRecords.ts';
import { parseDocxTables } from './wordParser.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';

/**
 * Turns the Community Radio DOCX into the same normalized {@link DatasetRecord}s the rest of the
 * pipeline consumes. Three explicit layers (per requirement):
 *
 *   RAW station rows  →  StationRecord[] (one entity per row, ALL attributes preserved)
 *                     →  district reconciliation (canonical districtId; unmatched reported)
 *                     →  DatasetRecord[]  (the ONE safe metric: station COUNT per district)
 *
 * Only the station count is aggregated. Numeric-looking fields that are NOT metrics — Frequency of
 * Operation (MHz), Contact Number — are preserved on the raw record but never summed.
 */

export const WORD_DATASET_TYPE = 'Speech';
export const WORD_SUB_TYPE = 'Community Radio';
export const WORD_UNIT = 'stations';

export type StationRecord = {
  sNo: number;
  state: string;
  district: string;
  organization: string;
  location: string;
  crsName: string;
  frequency: string; // raw MHz string — NOT a metric
  contact: string; // trailing contact block (variable columns) — NOT a metric
  districtId: string | null; // resolved canonical id, or null if unreconciled
};

export type WordReadResult =
  | {
      ok: true;
      records: DatasetRecord[];
      recordIds: (string | null)[];
      diagnostics: DatasetDiagnostic[];
      meta: WordMeta;
    }
  | { ok: false; code: string; message: string; diagnostics: DatasetDiagnostic[]; meta?: WordMeta };

export type WordMeta = {
  tables: number;
  header: string[] | null;
  stationRows: number;
  matched: number;
  unmatched: { state: string; district: string; count: number }[];
  matchedDistricts: number;
  stations: StationRecord[];
};

const intCell = (s: string) => /^\d+$/.test((s ?? '').replace(/\s+/g, ''));

/** Parse the DOCX bytes into raw StationRecords + a structural report. Never throws for data
 *  problems — structural failures come back as a typed fatal result so the sync keeps last-good. */
export function readWordDataset(bytes: Uint8Array, reconciler?: Reconciler): WordReadResult {
  let tables: string[][][];
  try {
    tables = parseDocxTables(bytes);
  } catch (e: unknown) {
    return { ok: false, code: 'unreadable_docx', diagnostics: [], message: e instanceof Error ? e.message : String(e) };
  }
  return buildWordDataset(tables, reconciler);
}

/** Build the dataset from already-extracted tables. Split out so it is unit-testable with
 *  synthetic tables (malformed rows, unknown districts) without constructing a .docx. */
export function buildWordDataset(tables: string[][][], reconciler?: Reconciler): WordReadResult {
  if (tables.length === 0) {
    return { ok: false, code: 'no_tables', diagnostics: [], message: 'The document contains no tables.' };
  }

  // The header is the row whose columns name State and District. It appears once.
  let header: string[] | null = null;
  for (const t of tables) {
    for (const r of t) {
      const c1 = (r[1] ?? '').toLowerCase();
      const c2 = (r[2] ?? '').toLowerCase();
      if (!intCell(r[0] ?? '') && c1.includes('state') && c2.includes('district')) {
        header = r;
        break;
      }
    }
    if (header) break;
  }
  if (!header) {
    return { ok: false, code: 'missing_header', diagnostics: [],
      message: 'No header row with State/District columns found — unexpected document structure.' };
  }

  const rec = reconciler ?? buildReconciler();
  const stations: StationRecord[] = [];
  const diagnostics: DatasetDiagnostic[] = [];

  for (const t of tables) {
    for (const r of t) {
      // A data row is one whose first cell is an integer S.No. Empty rows and headers are skipped.
      if (!intCell(r[0] ?? '')) continue;
      if (r.length < 3 || !(r[1] ?? '').trim() || !(r[2] ?? '').trim()) {
        diagnostics.push({ level: 'warning', code: 'malformed_row', source: 'word',
          message: `S.No ${r[0]}: missing state/district — row skipped.` });
        continue;
      }
      const state = r[1]!.trim();
      const district = r[2]!.trim();
      const m = rec.reconcile(state, district);
      stations.push({
        sNo: Number((r[0] ?? '').replace(/\s+/g, '')),
        state, district,
        organization: (r[3] ?? '').trim(),
        location: (r[4] ?? '').trim(),
        crsName: (r[5] ?? '').trim(),
        frequency: (r[6] ?? '').trim(),
        contact: r.slice(7).join(' | ').trim(),
        districtId: m.ok ? m.districtId : null,
      });
    }
  }

  if (stations.length === 0) {
    return { ok: false, code: 'no_data_rows', diagnostics,
      message: 'No station data rows found (would empty the dataset) — refusing to sync.' };
  }

  // Report unmatched districts (aggregated, one diagnostic per distinct pair).
  const unmatchedMap = new Map<string, { state: string; district: string; count: number }>();
  const counts = new Map<string, number>(); // districtId → station count
  for (const s of stations) {
    if (s.districtId) counts.set(s.districtId, (counts.get(s.districtId) ?? 0) + 1);
    else {
      const key = `${s.state}||${s.district}`;
      const cur = unmatchedMap.get(key);
      if (cur) cur.count++;
      else unmatchedMap.set(key, { state: s.state, district: s.district, count: 1 });
    }
  }
  for (const u of unmatchedMap.values()) {
    diagnostics.push({ level: 'warning', code: 'unknown_district', source: 'word',
      message: `Unreconciled district "${u.state} / ${u.district}" (${u.count} station(s)) — not inserted.` });
  }

  // Derive the ONE safe metric: station count per canonical district.
  const records: DatasetRecord[] = [];
  const recordIds: (string | null)[] = [];
  for (const [districtId, count] of counts) {
    records.push({
      districtId,
      datasetType: WORD_DATASET_TYPE,
      subType: WORD_SUB_TYPE,
      value: count,
      unit: WORD_UNIT,
      source: 'Community Radio stations (CRAI) — DOCX',
    });
    recordIds.push(`cr:${districtId}`); // stable identity: one count row per district
  }

  const meta: WordMeta = {
    tables: tables.length,
    header,
    stationRows: stations.length,
    matched: stations.filter((s) => s.districtId).length,
    unmatched: [...unmatchedMap.values()].sort((a, b) => b.count - a.count),
    matchedDistricts: counts.size,
    stations,
  };
  return { ok: true, records, recordIds, diagnostics, meta };
}
