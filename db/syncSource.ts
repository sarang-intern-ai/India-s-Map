import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './env.ts';
import {
  parseCsv,
  normalizeRowsDetailed,
  cacheBust,
  type DetailedLoadResult,
} from '../src/data/datasetProvider.ts';
import { excelRowsFromBuffer } from '../src/data/excelProvider.ts';
import { readWordDataset } from './wordDataset.ts';
import { readCrsSpeechDataset } from './crsSpeechDataset.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';

/**
 * Server-side source acquisition for the sync service. It REUSES the exact frontend normalization
 * (`normalizeRowsDetailed`) and the shared readers (`excelRowsFromBuffer`, `parseCsv`) — only the
 * acquisition (read a local file / fetch a URL) is here, never a second parser. Both an Excel
 * workbook and a public Google Sheet reduce to the same normalized records + side-channel
 * (record_id / line) the sync needs.
 */

export type SyncSourceConfig =
  | { kind: 'excel'; file: string; sheetName: string }
  | { kind: 'google'; url: string }
  | { kind: 'word'; file: string }
  | { kind: 'crs'; file: string }
  | { kind: 'crs-speech'; file: string };

/** Codes that mean the whole source is unusable — the sync must refuse and keep the last-good DB. */
export const FATAL_SOURCE_CODES = new Set([
  'empty_source', 'missing_columns', 'invalid_file', 'source_unavailable',
  'invalid_response', 'multiple_sheets', 'missing_worksheet', 'no_worksheet', 'empty_result',
  // Word/DOCX fatals:
  'unreadable_docx', 'no_tables', 'missing_header', 'no_data_rows',
]);

let cachedReconciler: Reconciler | null = null;
function reconciler(): Reconciler {
  if (!cachedReconciler) cachedReconciler = buildReconciler();
  return cachedReconciler;
}

export type SourceReadResult =
  | ({ ok: true } & DetailedLoadResult)
  | { ok: false; code: string; message: string; diagnostics: DetailedLoadResult['diagnostics'] };

/** Resolve the sync source from server-side env (falls back to the bundled Excel workbook). */
export function resolveSyncSource(): SyncSourceConfig {
  loadEnv();
  const type = (process.env.SYNC_SOURCE ?? '').trim().toLowerCase();
  const googleUrl = (process.env.VITE_GOOGLE_SHEETS_CSV_URL ?? '').trim();

  if (type === 'word') {
    const file = (process.env.SYNC_WORD_FILE ?? '').trim() || 'public/data/community-radio-stations.docx';
    return { kind: 'word', file };
  }

  if (type === 'crs') {
    const file = (process.env.SYNC_CRS_FILE ?? '').trim() || 'public/data/CRS(data).xlsx';
    return { kind: 'crs', file };
  }

  if (type === 'crs-speech') {
    const file = (process.env.SYNC_CRS_SPEECH_FILE ?? '').trim() || 'public/data/Test- CRS - Datasheet.xlsx';
    return { kind: 'crs-speech', file };
  }

  const wantsGoogle = type === 'google' || (!type && !!googleUrl);
  if (wantsGoogle && googleUrl) return { kind: 'google', url: googleUrl };

  // Excel: a server-readable FILE path (not the browser '/data/...' URL). Derive a sensible default
  // from VITE_EXCEL_URL, allow SYNC_EXCEL_FILE to override.
  const explicit = (process.env.SYNC_EXCEL_FILE ?? '').trim();
  const viteUrl = (process.env.VITE_EXCEL_URL ?? '').trim();
  const fromVite = viteUrl.startsWith('/data/') ? join('public', viteUrl.replace(/^\//, '')) : '';
  const file = explicit || fromVite || 'public/data/sample_india_district_dataset.xlsx';
  const sheetName = (process.env.VITE_EXCEL_SHEET_NAME ?? process.env.SYNC_EXCEL_SHEET ?? 'DistrictData').trim();
  return { kind: 'excel', file, sheetName };
}

function classify(detailed: DetailedLoadResult): SourceReadResult {
  const fatal = detailed.diagnostics.find((d) => d.level === 'error' && FATAL_SOURCE_CODES.has(d.code));
  if (fatal) return { ok: false, code: fatal.code, message: fatal.message, diagnostics: detailed.diagnostics };
  if (detailed.records.length === 0) {
    // Refuse to sync an empty result — it would wipe the last-good data.
    return {
      ok: false, code: 'empty_result',
      message: 'Source produced 0 valid records — refusing to sync (would empty the dataset).',
      diagnostics: detailed.diagnostics,
    };
  }
  return { ok: true, ...detailed };
}

export async function readSyncSource(config: SyncSourceConfig): Promise<SourceReadResult> {
  if (config.kind === 'crs') {
    // CRS is a detailed (per-station) source reconciled into crs_records by syncCrsOnce, not the
    // generic DatasetRecord path; syncOnce delegates before reaching here.
    return { ok: false, code: 'source_unavailable', diagnostics: [],
      message: 'CRS source is handled by syncCrsOnce, not readSyncSource.' };
  }
  if (config.kind === 'word') {
    let buf: Buffer;
    try {
      buf = readFileSync(config.file);
    } catch (e: unknown) {
      return { ok: false, code: 'source_unavailable', diagnostics: [],
        message: `Could not read Word file ${config.file}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const word = readWordDataset(new Uint8Array(buf), reconciler());
    if (!word.ok) return { ok: false, code: word.code, message: word.message, diagnostics: word.diagnostics };
    // Adapt to the DetailedLoadResult shape the sync consumes (lines are unused — identity is the
    // record_id "cr:<districtId>").
    return { ok: true, records: word.records, recordIds: word.recordIds, lines: word.records.map((_, i) => i + 1), diagnostics: word.diagnostics };
  }

  if (config.kind === 'crs-speech') {
    // A per-station Speech-HOURS Excel source. It reconciles to canonical districtIds and emits
    // standard Speech/hours DatasetRecords, so it rides the SAME generic dataset_records sync as the
    // main Excel source — a new source_id, its own fingerprint/version, no bespoke engine.
    let buf: Buffer;
    try {
      buf = readFileSync(config.file);
    } catch (e: unknown) {
      return { ok: false, code: 'source_unavailable', diagnostics: [],
        message: `Could not read CRS Speech file ${config.file}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const speech = await readCrsSpeechDataset(new Uint8Array(buf), reconciler());
    if (!speech.ok) return { ok: false, code: speech.code, message: speech.message, diagnostics: speech.diagnostics };
    return { ok: true, records: speech.records, recordIds: speech.recordIds, lines: speech.lines, diagnostics: speech.diagnostics };
  }

  if (config.kind === 'excel') {
    let buf: Buffer;
    try {
      buf = readFileSync(config.file);
    } catch (e: unknown) {
      return { ok: false, code: 'source_unavailable', diagnostics: [],
        message: `Could not read Excel file ${config.file}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const sheet = await excelRowsFromBuffer(ab, config.sheetName);
    if (!sheet.ok) return { ok: false, code: sheet.code, message: sheet.message, diagnostics: [] };
    return classify(normalizeRowsDetailed(sheet.rows, 'excel'));
  }

  // Google Sheets (public CSV export).
  let res: Response;
  try {
    res = await fetch(cacheBust(config.url), { headers: { accept: 'text/csv' }, cache: 'no-store' });
  } catch (e: unknown) {
    return { ok: false, code: 'source_unavailable', diagnostics: [],
      message: `Could not reach the Google Sheet: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    return { ok: false, code: 'source_unavailable', diagnostics: [],
      message: `Google Sheet returned HTTP ${res.status} ${res.statusText}.` };
  }
  const text = await res.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) {
    return { ok: false, code: 'invalid_response', diagnostics: [],
      message: 'Google Sheet URL returned HTML, not CSV — is it published to the web as CSV?' };
  }
  return classify(normalizeRowsDetailed(parseCsv(text), 'google'));
}
