import { createHash } from 'node:crypto';
import type { DatasetDiagnostic, DatasetRecord } from '../src/data/datasetRecords.ts';
import { excelRowsFromBuffer } from '../src/data/excelProvider.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';

/**
 * Parser for the "Test- CRS - Datasheet.xlsx" workbook (sheet `Sheet1`), a per-station Speech-hours
 * source for Community Radio stations. It is INDEPENDENT of `CRS(data).xlsx`: that source contributes
 * per-district station COUNTS (`Speech/Community Radio/stations`), while this one contributes each
 * station's HOURS (`Speech/<CRS name>/hours`). Different units never sum together, so the two sources
 * are complementary, source-isolated, and never double-count.
 *
 * It emits standard {@link DatasetRecord}s (datasetType `Speech`, unit `hours`) so it flows through
 * the EXISTING generic dataset_records sync → API → dynamic Speech aggregation with no frontend or
 * API change: each station is a Speech subType, and the existing unit-aware aggregation sums the
 * district's `hours` across every Speech source (panel + hover). Organization / Location / Language/s
 * are preserved as record metadata (`notes`); only Speech Data (Hrs) is a numeric metric.
 *
 * Columns (order-independent, located by name): Organization, CRS Name, Location, Language/s,
 * Speech Data (Hrs). `Location` is "District, State" (a single token, e.g. "Chandigarh", is a UT where
 * district == state). Reconciliation uses the shared canonical reconciler — never a raw name match.
 */

export type CrsSpeechRecordMeta = {
  header: string[];
  dataRows: number;
  matched: number;
  unmatched: { organization: string; crsName: string; location: string; reason: string }[];
  districts: number;
};

export type CrsSpeechReadResult =
  | {
      ok: true;
      records: DatasetRecord[];
      recordIds: (string | null)[];
      lines: number[];
      diagnostics: DatasetDiagnostic[];
      meta: CrsSpeechRecordMeta;
    }
  | { ok: false; code: string; message: string; diagnostics: DatasetDiagnostic[] };

const H = (s: unknown) => String(s ?? '').trim();
const numOrNull = (s: unknown): number | null => {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = H(s).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const norm = (s: string) => H(s).toLowerCase().replace(/\s+/g, ' ');

/** Locate the header row + column indices by NAME (order-independent), skipping any title rows.
 *  Exported so the write-back path (db/crsSpeechWorkbook.ts) locates the exact same columns. */
export function locateColumns(rows: unknown[][]): { headerRow: number; idx: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const lc = (rows[i] ?? []).map((c) => H(c).toLowerCase());
    const organization = lc.findIndex((c) => c.includes('organization'));
    const crsName = lc.findIndex((c) => c.includes('crs name') || c === 'name of crs' || c === 'name');
    const location = lc.findIndex((c) => c.includes('location'));
    const speech = lc.findIndex((c) => c.includes('speech data') || (c.includes('speech') && c.includes('hr')));
    if (organization !== -1 && crsName !== -1 && location !== -1 && speech !== -1) {
      const language = lc.findIndex((c) => c.includes('language'));
      return { headerRow: i, idx: { organization, crsName, location, language, speech } };
    }
  }
  return null;
}

/** "District, State" → {district, state}. One bare token → a UT where district === state.
 *  Exported so the write-back path reconciles a row's Location identically to the parser. */
export function parseLocation(loc: string): { district: string; state: string } | null {
  const parts = H(loc).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { district: parts[0]!, state: parts[0]! };
  return { state: parts[parts.length - 1]!, district: parts.slice(0, -1).join(', ') };
}

export function buildCrsSpeechDataset(rows: unknown[][], reconciler?: Reconciler): CrsSpeechReadResult {
  const loc = locateColumns(rows);
  if (!loc) {
    return {
      ok: false,
      code: 'missing_columns',
      diagnostics: [],
      message: 'No header row with Organization/CRS Name/Location/Speech Data columns found.',
    };
  }
  const { headerRow, idx } = loc;
  const header = (rows[headerRow] ?? []).map(H);
  const rec = reconciler ?? buildReconciler();

  const records: DatasetRecord[] = [];
  const recordIds: (string | null)[] = [];
  const lines: number[] = [];
  const diagnostics: DatasetDiagnostic[] = [];
  const unmatched: CrsSpeechRecordMeta['unmatched'] = [];
  let dataRows = 0;

  const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const organization = H(cell(r, idx.organization!));
    const crsName = H(cell(r, idx.crsName!));
    const location = H(cell(r, idx.location!));
    if (!organization && !crsName && !location) continue; // blank/decorative row
    dataRows++;

    if (!crsName) {
      diagnostics.push({ level: 'warning', code: 'malformed_row', source: 'crs-speech',
        message: `Row ${i + 1}: missing CRS Name — skipped.` });
      continue;
    }
    const parsed = parseLocation(location);
    if (!parsed) {
      diagnostics.push({ level: 'warning', code: 'malformed_row', source: 'crs-speech',
        message: `Row ${i + 1} ("${crsName}"): missing/unparseable Location — skipped.` });
      continue;
    }
    const m = rec.reconcile(parsed.state, parsed.district);
    if (!m.ok) {
      unmatched.push({ organization, crsName, location, reason: m.reason });
      continue; // do NOT invent a district mapping
    }

    const hours = numOrNull(cell(r, idx.speech!));
    if (hours === null) {
      diagnostics.push({ level: 'warning', code: 'missing_value', source: 'crs-speech',
        message: `Row ${i + 1} ("${crsName}"): non-numeric/blank Speech Data (Hrs) — no Speech contribution.` });
      continue;
    }

    const language = idx.language! >= 0 ? H(cell(r, idx.language!)) : '';
    // Stable identity: districtId + organization + CRS name + location. Excludes the value (hours)
    // so an edit is an UPDATE, and is position-independent so a reorder is a no-op. Changing any
    // identity field yields a new record_id (delete+insert — the project's identity semantics).
    const rid = 'crs-speech:' + createHash('sha1')
      .update([m.districtId, norm(organization), norm(crsName), norm(location)].join('|'))
      .digest('hex').slice(0, 16);

    records.push({
      districtId: m.districtId,
      datasetType: 'Speech',
      subType: crsName,
      value: hours,
      unit: 'hours',
      source: 'Test CRS Speech Datasheet (Excel)',
      notes: `Organization: ${organization}; Location: ${location}${language ? `; Language/s: ${language}` : ''}`,
    });
    recordIds.push(rid);
    lines.push(i + 1);
  }

  if (records.length === 0) {
    return { ok: false, code: 'no_data_rows', diagnostics,
      message: 'No reconcilable Speech rows found — refusing to sync (would empty the source).' };
  }

  for (const u of unmatched) {
    diagnostics.push({ level: 'warning', code: 'unknown_district', source: 'crs-speech',
      message: `Unreconciled CRS "${u.crsName}" at "${u.location}" (${u.reason}) — not attached.` });
  }

  const districts = new Set(records.map((r) => r.districtId)).size;
  return {
    ok: true,
    records,
    recordIds,
    lines,
    diagnostics,
    meta: { header, dataRows, matched: records.length, unmatched, districts },
  };
}

/** Read the workbook bytes → DatasetRecords (reuses the shared Excel reader; sheet `Sheet1`). */
export async function readCrsSpeechDataset(bytes: Uint8Array, reconciler?: Reconciler): Promise<CrsSpeechReadResult> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const sheet = await excelRowsFromBuffer(ab, 'Sheet1');
  if (!sheet.ok) return { ok: false, code: sheet.code, message: sheet.message, diagnostics: [] };
  return buildCrsSpeechDataset(sheet.rows as unknown[][], reconciler);
}
