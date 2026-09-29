import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { locateColumns, parseLocation } from './crsSpeechDataset.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';

/**
 * WRITE-BACK path for the Speech-hours workbook (Test- CRS - Datasheet.xlsx) — the ONLY place it is
 * modified from the UI. It owns the fields the CRS card sources from this workbook: Location,
 * Language/s and Speech Data (Hrs). It locates the target row by the same identity the join uses
 * (canonical districtId + normalized CRS Name, with Organization as a tie-breaker), updates only the
 * requested cells, and writes atomically (temp file in the same dir → rename). Reconciliation into
 * PostgreSQL is left to the existing generic sync (`syncOnce` for the crs-speech source), called by
 * the API after the write and by the watcher — Excel stays the source of truth for these fields.
 */

let cached: Reconciler | null = null;
const reconciler = (): Reconciler => (cached ??= buildReconciler());

const H = (s: unknown) => String(s ?? '').trim();
const norm = (s: unknown) => H(s).toLowerCase().replace(/\s+/g, ' ');

type SpeechRow = { aoaRow: number; districtId: string; crsName: string; organization: string; location: string };

export type SpeechWorkbookView = {
  version: string; // sha256 of the workbook bytes (conflict token)
  aoa: unknown[][];
  headerRow: number;
  cols: Record<string, number>;
  rows: SpeechRow[];
  sheetName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any;
};

export function speechWorkbookVersion(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function readSpeechWorkbook(file: string): Promise<SpeechWorkbookView> {
  const XLSX = await import('xlsx');
  const bytes = readFileSync(file);
  const version = speechWorkbookVersion(bytes);
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Speech workbook has no worksheets.');
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Speech workbook: worksheet "${sheetName}" could not be opened.`);
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as unknown[][];

  const loc = locateColumns(aoa);
  if (!loc) throw new Error('Speech workbook: no header row with Organization/CRS Name/Location/Speech Data columns.');
  const { headerRow, idx: cols } = loc;
  const rec = reconciler();
  const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

  const rows: SpeechRow[] = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const organization = H(cell(r, cols.organization!));
    const crsName = H(cell(r, cols.crsName!));
    const location = H(cell(r, cols.location!));
    if (!organization && !crsName && !location) continue;
    if (!crsName) continue;
    const parsed = parseLocation(location);
    if (!parsed) continue;
    const m = rec.reconcile(parsed.state, parsed.district);
    if (!m.ok) continue;
    rows.push({ aoaRow: i, districtId: m.districtId, crsName, organization, location });
  }
  return { version, aoa, headerRow, cols, rows, sheetName, wb };
}

export type SpeechEditFields = { location?: string | null; language?: string | null; hours?: number | null };

export type SpeechWriteOk = { ok: true; version: string; action: 'update' };
export type SpeechWriteErr = {
  ok: false;
  status: number;
  code: 'conflict' | 'not_found' | 'ambiguous' | 'validation' | 'write_failed' | 'source_unavailable';
  message: string;
};
export type SpeechWriteResult = SpeechWriteOk | SpeechWriteErr;

function coerceHours(v: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { ok: true, value: null };
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'Speech Data (Hrs) must be a number ≥ 0, or blank.' };
  return { ok: true, value: n };
}

async function persist(view: SpeechWorkbookView, file: string): Promise<{ ok: true; version: string } | SpeechWriteErr> {
  const XLSX = await import('xlsx');
  try {
    const newWs = XLSX.utils.aoa_to_sheet(view.aoa);
    view.wb.Sheets[view.sheetName] = newWs;
    const out = XLSX.write(view.wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer | Uint8Array;
    const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
    const tmp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    } catch (e: unknown) {
      if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* best-effort */ } }
      return { ok: false, status: 500, code: 'write_failed', message: `Could not write the Speech workbook: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, version: speechWorkbookVersion(buf) };
  } catch (e: unknown) {
    return { ok: false, status: 500, code: 'write_failed', message: `Could not build the Speech workbook: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Update Location / Language/s / Speech Data (Hrs) for the row matching (districtId + CRS name [+
 * organization]). Only provided fields are written. `location`/`language` write directly; `hours`
 * writes to Speech Data (Hrs). Deterministic match — no fuzzy logic.
 */
export async function updateSpeechRow(
  file: string,
  match: { districtId: string; crsName: string; organization?: string | null },
  fields: SpeechEditFields,
  baseVersion?: string,
): Promise<SpeechWriteResult> {
  let view: SpeechWorkbookView;
  try { view = await readSpeechWorkbook(file); } catch (e: unknown) {
    return { ok: false, status: 503, code: 'source_unavailable', message: e instanceof Error ? e.message : String(e) };
  }
  if (baseVersion && baseVersion !== view.version)
    return { ok: false, status: 409, code: 'conflict', message: 'The Speech workbook changed since you loaded it. Refresh and retry.' };

  const candidates = view.rows.filter((r) => r.districtId === match.districtId && norm(r.crsName) === norm(match.crsName));
  let target: SpeechRow | undefined;
  if (candidates.length === 0) {
    return { ok: false, status: 404, code: 'not_found', message: 'No matching Speech record for this CRS (refresh and retry, or this station has no Speech-hours row).' };
  } else if (candidates.length === 1) {
    target = candidates[0];
  } else {
    target = candidates.find((r) => norm(r.organization) === norm(match.organization)) ?? undefined;
    if (!target) return { ok: false, status: 409, code: 'ambiguous', message: 'Multiple Speech rows match this CRS; cannot determine which to edit.' };
  }

  if (fields.hours !== undefined) {
    const h = coerceHours(fields.hours);
    if (!h.ok) return { ok: false, status: 400, code: 'validation', message: h.message };
  }

  const setCell = (colKey: string, value: unknown) => {
    const c = view.cols[colKey];
    if (c === undefined || c < 0) return;
    (view.aoa[target!.aoaRow] ??= [])[c] = value;
  };
  if (fields.location !== undefined) setCell('location', H(fields.location) || null);
  if (fields.language !== undefined) setCell('language', H(fields.language) || null);
  if (fields.hours !== undefined) {
    const h = coerceHours(fields.hours) as { ok: true; value: number | null };
    setCell('speech', h.value);
  }

  const saved = await persist(view, file);
  if (!saved.ok) return saved;
  return { ok: true, version: saved.version, action: 'update' };
}

/** Current workbook version token (for GET /api/crs-speech/version and optimistic concurrency). */
export async function speechWorkbookVersionOf(file: string): Promise<string | null> {
  try { return speechWorkbookVersion(readFileSync(file)); } catch { return null; }
}
