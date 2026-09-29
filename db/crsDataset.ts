import { createHash } from 'node:crypto';
import type { DatasetDiagnostic } from '../src/data/datasetRecords.ts';
import { excelRowsFromBuffer } from '../src/data/excelProvider.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';

/**
 * Parser for the detailed Community Radio Excel workbook (`CRS(data).xlsx`, sheet `Sheet1`). Unlike
 * the Word source (which only yields a per-district count), this workbook has ONE row per station
 * with its attributes, so it is the *authoritative detailed* Community Radio source: the per-station
 * records feed the CRS DATA UI, and the per-district station COUNT is DERIVED from them (never
 * duplicated in the sheet).
 *
 * Reuses `excelRowsFromBuffer` (same Excel reader as every other source) and the shared district
 * reconciler — no second reader, no second reconciliation system. Header-driven (a title row above
 * the header is skipped); column ORDER does not matter.
 */

export type CrsRecord = {
  sNo: number | null;
  state: string;
  district: string;
  organization: string;
  location: string;
  crsName: string;
  language: string | null; // blank in the sheet → null (shown as "Not available")
  hours: number | null; // No. of Hours — blank → null; NOT frequency
  districtId: string; // reconciled canonical id (only matched rows are kept)
  sourceKey: string; // stable identity (survives reorder + language/hours edits)
};

export type CrsReadResult =
  | { ok: true; records: CrsRecord[]; diagnostics: DatasetDiagnostic[]; meta: CrsMeta }
  | { ok: false; code: string; message: string; diagnostics: DatasetDiagnostic[] };

export type CrsMeta = {
  header: string[];
  dataRows: number;
  matched: number;
  unmatched: { state: string; district: string; count: number }[];
  districts: number;
};

const H = (s: unknown) => String(s ?? '').trim();
const intOrNull = (s: unknown) => {
  const t = H(s).replace(/\s+/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
};
const numOrNull = (s: unknown) => {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = H(s);
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const strOrNull = (s: unknown) => {
  const t = H(s);
  return t === '' ? null : t;
};

/**
 * Stable CRS identity base (16-hex) from the fields that define a station's identity — the canonical
 * districtId + name + organization + location. Deliberately EXCLUDES S.No/position (so reorder is a
 * no-op) and language/hours (so those edits are UPDATEs, not delete+insert). The full `sourceKey`
 * appends an occurrence suffix (`#n`) to keep exact duplicates distinct — see `buildCrsDataset`.
 *
 * Exported so the Excel WRITE-BACK path (db/crsWorkbook.ts) computes byte-identical identities to the
 * parser here — there is exactly one identity definition in the project.
 */
export function crsIdentityBase(
  districtId: string,
  crsName: string,
  organization: string,
  location: string,
): string {
  return createHash('sha1')
    .update([districtId, crsName, organization, location].join(' '))
    .digest('hex')
    .slice(0, 16);
}

/** Find the header row + column indices by NAME (order-independent), skipping any title row above. */
export function locateColumns(rows: unknown[][]): { headerRow: number; idx: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const lc = cells.map((c) => H(c).toLowerCase());
    const state = lc.findIndex((c) => c.includes('state'));
    const district = lc.findIndex((c) => c.includes('district'));
    const name = lc.findIndex((c) => c.includes('name of crs'));
    if (state !== -1 && district !== -1 && name !== -1) {
      const find = (re: RegExp) => lc.findIndex((c) => re.test(c));
      return {
        headerRow: i,
        idx: {
          sNo: find(/s\.?\s*n/), state, district,
          organization: find(/organi/), location: find(/location/), crsName: name,
          language: find(/language/), hours: find(/hours/),
        },
      };
    }
  }
  return null;
}

export function buildCrsDataset(rows: unknown[][], reconciler?: Reconciler): CrsReadResult {
  const loc = locateColumns(rows);
  if (!loc) {
    return { ok: false, code: 'missing_header', diagnostics: [],
      message: 'No header row with CRS State/District/Name columns found.' };
  }
  const { headerRow, idx } = loc;
  const header = (rows[headerRow] ?? []).map(H);
  const rec = reconciler ?? buildReconciler();

  const records: CrsRecord[] = [];
  const diagnostics: DatasetDiagnostic[] = [];
  const unmatched = new Map<string, { state: string; district: string; count: number }>();
  const occ = new Map<string, number>();
  let dataRows = 0;

  const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const state = H(cell(r, idx.state!));
    const district = H(cell(r, idx.district!));
    const crsName = H(cell(r, idx.crsName!));
    // A data row has a state+district (blank/decorative rows are skipped).
    if (!state && !district && !crsName) continue;
    dataRows++;
    if (!state || !district) {
      diagnostics.push({ level: 'warning', code: 'malformed_row', source: 'crs',
        message: `Row ${i + 1}: missing state/district — skipped.` });
      continue;
    }
    const m = rec.reconcile(state, district);
    if (!m.ok) {
      const key = `${state}||${district}`;
      const cur = unmatched.get(key);
      if (cur) cur.count++;
      else unmatched.set(key, { state, district, count: 1 });
      continue; // §5: do not attach to a random district
    }
    const organization = H(cell(r, idx.organization!));
    const location = H(cell(r, idx.location!));
    // Stable identity: excludes language/hours (mutable) so an edit is an UPDATE, and excludes
    // S.No/position so reordering is a no-op. Occurrence suffix keeps exact duplicates distinct.
    const base = crsIdentityBase(m.districtId, crsName, organization, location);
    const n = occ.get(base) ?? 0;
    occ.set(base, n + 1);
    records.push({
      sNo: intOrNull(cell(r, idx.sNo!)),
      state, district,
      organization, location, crsName,
      language: strOrNull(cell(r, idx.language!)),
      hours: numOrNull(cell(r, idx.hours!)),
      districtId: m.districtId,
      sourceKey: `${base}#${n}`,
    });
  }

  if (records.length === 0) {
    return { ok: false, code: 'no_data_rows', diagnostics,
      message: 'No reconcilable CRS rows found — refusing to sync (would empty the dataset).' };
  }

  for (const u of unmatched.values()) {
    diagnostics.push({ level: 'warning', code: 'unknown_district', source: 'crs',
      message: `Unreconciled CRS district "${u.state} / ${u.district}" (${u.count} station(s)) — not attached.` });
  }

  const districts = new Set(records.map((r) => r.districtId)).size;
  return { ok: true, records, diagnostics,
    meta: { header, dataRows, matched: records.length, unmatched: [...unmatched.values()].sort((a, b) => b.count - a.count), districts } };
}

/** Read the CRS workbook bytes → CrsRecords (reuses the shared Excel reader). */
export async function readCrsDataset(bytes: Uint8Array, reconciler?: Reconciler): Promise<CrsReadResult> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const sheet = await excelRowsFromBuffer(ab, 'Sheet1');
  if (!sheet.ok) return { ok: false, code: sheet.code, message: sheet.message, diagnostics: [] };
  return buildCrsDataset(sheet.rows as unknown[][], reconciler);
}
