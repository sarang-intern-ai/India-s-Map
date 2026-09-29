import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { crsIdentityBase, locateColumns } from './crsDataset.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';

/**
 * The CRS Excel WRITE-BACK path — the ONLY place the workbook is modified. It reuses the parser's
 * identity primitive (`crsIdentityBase`) and column locator (`locateColumns`) plus the shared
 * `buildReconciler`, so a row written here is byte-for-byte reconcilable by the existing parser and
 * carries the SAME stable `sourceKey` the sync keys on. Excel remains the persistent source of
 * truth: these functions mutate the workbook only; reconciliation into PostgreSQL is left to the
 * existing `syncCrsOnce` engine (called by the API after a successful write, and by the watcher).
 *
 * Writes are atomic (temp file in the same directory → validate → rename over the original), so a
 * crash mid-write can never leave a half-written workbook. The temp file's basename differs from the
 * workbook's, so the directory watcher ignores it and fires only on the final rename.
 */

let cached: Reconciler | null = null;
const reconciler = (): Reconciler => (cached ??= buildReconciler());

const H = (s: unknown) => String(s ?? '').trim();
const strOrNull = (s: unknown) => (H(s) === '' ? null : H(s));
const numOrNull = (s: unknown): number | null => {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = H(s);
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** A located data row: its 0-based index in the full AOA (title + header + data) and parsed fields. */
type IndexedRow = {
  aoaRow: number;
  sourceKey: string;
  districtId: string;
  crsName: string;
  organization: string;
  location: string;
  sNo: number | null;
};

export type CrsWorkbookView = {
  /** sha256 of the workbook bytes — the conflict/version token (changes on ANY workbook edit). */
  version: string;
  /** Full array-of-arrays including the title row and header (positions preserved for writing). */
  aoa: unknown[][];
  headerRow: number;
  /** Column-name → column index within a row (sNo/state/district/organization/location/crsName/language/hours). */
  cols: Record<string, number>;
  /** sourceKey → located row. Mirrors the parser's iteration/occurrence logic exactly. */
  bySourceKey: Map<string, IndexedRow>;
  /** All indexed (reconciled) rows in workbook order. */
  rows: IndexedRow[];
  /** Highest S.No seen (for assigning the next one on add). */
  maxSNo: number;
  /** AOA index just after the last data row (where a new row is inserted to stay contiguous). */
  insertAt: number;
  sheetName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any;
};

export function workbookVersion(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read the workbook into a mutable view. Throws on unreadable/misshapen workbook (caller maps it). */
export async function readCrsWorkbook(file: string): Promise<CrsWorkbookView> {
  const XLSX = await import('xlsx');
  const bytes = readFileSync(file);
  const version = workbookVersion(bytes);
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('CRS workbook has no worksheets.');
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`CRS workbook: worksheet "${sheetName}" could not be opened.`);
  // blankrows:true + defval:null keeps every sheet row at its true position so writes are precise.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as unknown[][];

  const loc = locateColumns(aoa);
  if (!loc) throw new Error('CRS workbook: no header row with State/District/Name of CRS columns.');
  const { headerRow, idx: cols } = loc;
  const rec = reconciler();

  const bySourceKey = new Map<string, IndexedRow>();
  const rows: IndexedRow[] = [];
  const occ = new Map<string, number>();
  let maxSNo = 0;
  let insertAt = headerRow + 1;

  const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const state = H(cell(r, cols.state!));
    const district = H(cell(r, cols.district!));
    const crsName = H(cell(r, cols.crsName!));
    if (!state && !district && !crsName) continue; // blank row (matches parser skip)
    insertAt = i + 1; // last row that carries any CRS content
    if (!state || !district) continue; // malformed (parser skips)
    const m = rec.reconcile(state, district);
    if (!m.ok) continue; // unmatched district (parser skips)
    const organization = H(cell(r, cols.organization!));
    const location = H(cell(r, cols.location!));
    const base = crsIdentityBase(m.districtId, crsName, organization, location);
    const n = occ.get(base) ?? 0;
    occ.set(base, n + 1);
    const sNo = numOrNull(cell(r, cols.sNo!));
    if (sNo != null && Number.isFinite(sNo)) maxSNo = Math.max(maxSNo, sNo);
    const row: IndexedRow = { aoaRow: i, sourceKey: `${base}#${n}`, districtId: m.districtId, crsName, organization, location, sNo };
    bySourceKey.set(row.sourceKey, row);
    rows.push(row);
  }

  return { version, aoa, headerRow, cols, bySourceKey, rows, maxSNo, insertAt, sheetName, wb };
}

/** Editable fields of an existing CRS (identity fields included — editing them re-identifies the row). */
export type CrsEditableFields = {
  crsName?: string;
  organization?: string | null;
  location?: string | null;
  language?: string | null;
  hours?: number | null;
};

export type CrsAddInput = {
  districtId: string;
  crsName: string;
  organization?: string | null;
  location?: string | null;
  language?: string | null;
  hours?: number | null;
};

export type CrsWriteOk = {
  ok: true;
  version: string; // new workbook version after the write
  sourceKey: string; // identity of the affected row (post-edit for update/add)
  action: 'add' | 'update' | 'delete';
};
export type CrsWriteErr = {
  ok: false;
  status: number; // HTTP status hint
  code: 'conflict' | 'not_found' | 'duplicate' | 'validation' | 'unresolved_district' | 'write_failed' | 'source_unavailable';
  message: string;
};
export type CrsWriteResult = CrsWriteOk | CrsWriteErr;

/** Validate a hours value: blank/undefined → null; otherwise a finite number ≥ 0 (else validation error). */
function coerceHours(v: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { ok: true, value: null };
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'No. of Hours must be a number ≥ 0, or blank.' };
  return { ok: true, value: n };
}

async function persist(view: CrsWorkbookView, file: string): Promise<{ ok: true; version: string } | CrsWriteErr> {
  const XLSX = await import('xlsx');
  try {
    // Rebuild only the CRS sheet from the (mutated) AOA; other sheets and the title/header rows are
    // preserved. Values round-trip (numbers stay numeric, blanks stay blank) so untouched rows keep
    // an identical fingerprint — no spurious churn.
    const newWs = XLSX.utils.aoa_to_sheet(view.aoa);
    view.wb.Sheets[view.sheetName] = newWs;
    const out = XLSX.write(view.wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer | Uint8Array;
    const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
    const dir = dirname(file);
    // Leading dot + distinct suffix → basename differs from the workbook, so the directory watcher
    // ignores this temp file and fires only on the final rename below.
    const tmp = join(dir, `.${basename(file)}.tmp-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(tmp, buf);
      renameSync(tmp, file); // atomic replace; original stays intact if this throws
    } catch (e: unknown) {
      if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* best-effort cleanup */ } }
      return { ok: false, status: 500, code: 'write_failed',
        message: `Could not write the CRS workbook: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, version: workbookVersion(buf) };
  } catch (e: unknown) {
    return { ok: false, status: 500, code: 'write_failed',
      message: `Could not build the CRS workbook: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function setCell(view: CrsWorkbookView, aoaRow: number, colKey: string, value: unknown) {
  const c = view.cols[colKey];
  if (c === undefined || c < 0) return;
  const row = (view.aoa[aoaRow] ??= []);
  row[c] = value;
}

/** UPDATE an existing CRS, located by its stable sourceKey. Only provided fields change. */
export async function updateCrs(file: string, sourceKey: string, fields: CrsEditableFields, baseVersion?: string): Promise<CrsWriteResult> {
  let view: CrsWorkbookView;
  try { view = await readCrsWorkbook(file); } catch (e: unknown) {
    return { ok: false, status: 503, code: 'source_unavailable', message: e instanceof Error ? e.message : String(e) };
  }
  if (baseVersion && baseVersion !== view.version)
    return { ok: false, status: 409, code: 'conflict', message: 'The CRS workbook changed since you loaded it. Refresh and retry.' };

  const target = view.bySourceKey.get(sourceKey);
  if (!target) return { ok: false, status: 404, code: 'not_found', message: 'CRS record not found (it may have been changed or removed). Refresh and retry.' };

  // Resolve the resulting identity fields (unchanged ones keep their current value).
  const crsName = fields.crsName !== undefined ? H(fields.crsName) : target.crsName;
  if (!crsName) return { ok: false, status: 400, code: 'validation', message: 'Name of CRS cannot be empty.' };
  const organization = fields.organization !== undefined ? H(fields.organization) : target.organization;
  const location = fields.location !== undefined ? H(fields.location) : target.location;

  let hours: number | null | undefined;
  if (fields.hours !== undefined) {
    const h = coerceHours(fields.hours);
    if (!h.ok) return { ok: false, status: 400, code: 'validation', message: h.message };
    hours = h.value;
  }

  // Duplicate guard: if the edit changes identity fields and the resulting identity collides with a
  // DIFFERENT existing row, refuse rather than create an ambiguous duplicate.
  const identityChanged = crsName !== target.crsName || organization !== target.organization || location !== target.location;
  if (identityChanged) {
    const newBase = crsIdentityBase(target.districtId, crsName, organization, location);
    const collides = view.rows.some((r) => r.aoaRow !== target.aoaRow &&
      crsIdentityBase(r.districtId, r.crsName, r.organization, r.location) === newBase);
    if (collides) return { ok: false, status: 409, code: 'duplicate', message: 'Another CRS with the same name, organization and location already exists in this district.' };
  }

  // Apply only the requested fields to the located row.
  if (fields.crsName !== undefined) setCell(view, target.aoaRow, 'crsName', crsName);
  if (fields.organization !== undefined) setCell(view, target.aoaRow, 'organization', organization || null);
  if (fields.location !== undefined) setCell(view, target.aoaRow, 'location', location || null);
  if (fields.language !== undefined) setCell(view, target.aoaRow, 'language', strOrNull(fields.language));
  if (hours !== undefined) setCell(view, target.aoaRow, 'hours', hours);

  const saved = await persist(view, file);
  if (!saved.ok) return saved;
  // New occurrence for the (possibly changed) identity is #0 relative to the persisted set only if it
  // was unique; report the base identity so the client can re-key. The definitive key comes from the
  // next read/sync; this is a best-effort echo.
  const base = crsIdentityBase(target.districtId, crsName, organization, location);
  return { ok: true, version: saved.version, sourceKey: identityChanged ? `${base}#0` : sourceKey, action: 'update' };
}

/** ADD a new CRS. The district must resolve to a canonical id; State/District text is derived from it. */
export async function addCrs(file: string, input: CrsAddInput, baseVersion?: string): Promise<CrsWriteResult> {
  let view: CrsWorkbookView;
  try { view = await readCrsWorkbook(file); } catch (e: unknown) {
    return { ok: false, status: 503, code: 'source_unavailable', message: e instanceof Error ? e.message : String(e) };
  }
  if (baseVersion && baseVersion !== view.version)
    return { ok: false, status: 409, code: 'conflict', message: 'The CRS workbook changed since you loaded it. Refresh and retry.' };

  const crsName = H(input.crsName);
  if (!crsName) return { ok: false, status: 400, code: 'validation', message: 'Name of CRS is required.' };
  const districtId = H(input.districtId);
  const canon = reconciler().canonicalFor(districtId);
  if (!canon) return { ok: false, status: 400, code: 'unresolved_district', message: `District "${districtId}" is not a canonical district.` };

  const organization = H(input.organization ?? '');
  const location = H(input.location ?? '');
  const h = coerceHours(input.hours);
  if (!h.ok) return { ok: false, status: 400, code: 'validation', message: h.message };
  const language = strOrNull(input.language);

  // Duplicate guard: exact identity (district+name+org+location) already present → refuse.
  const base = crsIdentityBase(districtId, crsName, organization, location);
  const dup = view.rows.some((r) => crsIdentityBase(r.districtId, r.crsName, r.organization, r.location) === base);
  if (dup) return { ok: false, status: 409, code: 'duplicate', message: 'A CRS with the same name, organization and location already exists in this district.' };

  // Build the new row aligned to the header columns; State/District come from the canonical mapping.
  const newRow: unknown[] = [];
  const width = Math.max(...Object.values(view.cols).filter((c) => c >= 0)) + 1;
  for (let c = 0; c < width; c++) newRow[c] = null;
  const put = (colKey: string, value: unknown) => { const c = view.cols[colKey]; if (c !== undefined && c >= 0) newRow[c] = value; };
  put('sNo', view.maxSNo + 1);
  put('state', canon.stateName);
  put('district', canon.districtName);
  put('organization', organization || null);
  put('location', location || null);
  put('crsName', crsName);
  put('language', language);
  put('hours', h.value);

  view.aoa.splice(view.insertAt, 0, newRow); // keep the table contiguous

  const saved = await persist(view, file);
  if (!saved.ok) return saved;
  return { ok: true, version: saved.version, sourceKey: `${base}#0`, action: 'add' };
}

/** DELETE a CRS, located by its stable sourceKey. The row is physically removed from the workbook. */
export async function deleteCrs(file: string, sourceKey: string, baseVersion?: string): Promise<CrsWriteResult> {
  let view: CrsWorkbookView;
  try { view = await readCrsWorkbook(file); } catch (e: unknown) {
    return { ok: false, status: 503, code: 'source_unavailable', message: e instanceof Error ? e.message : String(e) };
  }
  if (baseVersion && baseVersion !== view.version)
    return { ok: false, status: 409, code: 'conflict', message: 'The CRS workbook changed since you loaded it. Refresh and retry.' };

  const target = view.bySourceKey.get(sourceKey);
  if (!target) return { ok: false, status: 404, code: 'not_found', message: 'CRS record not found (it may have been changed or removed). Refresh and retry.' };

  view.aoa.splice(target.aoaRow, 1); // physically remove the row (rows below shift up)

  const saved = await persist(view, file);
  if (!saved.ok) return saved;
  return { ok: true, version: saved.version, sourceKey, action: 'delete' };
}

/** Just the current workbook version token (for GET /api/crs/version and the list-response header). */
export async function crsWorkbookVersion(file: string): Promise<string | null> {
  try { return workbookVersion(readFileSync(file)); } catch { return null; }
}
