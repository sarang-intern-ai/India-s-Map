import {
  DatasetRecord,
  type DatasetDiagnostic,
  type DatasetValue,
} from './datasetRecords.ts';

/**
 * The source abstraction. A provider turns ONE external source (the local demo CSV, a published
 * Google Sheet, or an Excel workbook) into normalized {@link DatasetRecord}s, plus any
 * diagnostics it found while parsing its own rows.
 *
 * The UI never sees a provider. `loadDatasetRecords()` drives one or more providers, merges
 * their records into a single normalized array, and groups them. Swapping Google Sheets for
 * Excel — or later for a database — is implementing this interface again; nothing in the panel
 * changes. Every provider funnels its rows through the SAME {@link normalizeRows} +
 * {@link DatasetRecord} validation, so normalization is defined once, not per source.
 */
export interface DatasetProvider {
  /** Stable id for diagnostics/provenance, e.g. "local-demo-csv", "google-sheets", "excel". */
  readonly id: string;
  /** Human label for the UI ("Demo dataset", "Google Sheets", "Excel"), never a secret. */
  readonly label: string;
  load(): Promise<DatasetLoadResult>;
}

export type DatasetLoadResult = {
  /** Validated, normalized records. Malformed input never reaches this array. */
  records: DatasetRecord[];
  /** Everything that could not be turned into a clean record, reported not swallowed. */
  diagnostics: DatasetDiagnostic[];
};

/**
 * A raw cell from any tabular source. CSV yields strings; Excel yields native numbers and
 * booleans (and nulls for blanks). The shared normalizer accepts all of them so Excel's real
 * types are preserved rather than stringified.
 */
export type RawCell = string | number | boolean | null | undefined;

/** Columns the normalized contract requires from any sheet-shaped source. */
const REQUIRED_COLUMNS = ['district_id', 'dataset_type', 'sub_type', 'value', 'unit'] as const;
/** Recognized optional columns. Unknown columns are ignored (forward-compatible). `record_id` is
 *  the optional business id the DB sync prefers for stable identity (see docs/DATABASE.md). */
const OPTIONAL_COLUMNS = ['source', 'last_updated', 'notes', 'district_name', 'record_id'] as const;

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas/newlines and
 * doubled `""` escapes. Returns rows of raw string cells. Kept dependency-free and tiny — the
 * dataset is small and this must run in the browser with zero extra bundle weight. Used by the
 * local CSV and Google Sheets (CSV export) providers alike.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalize newlines so CRLF and LF behave identically.
  const s = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Flush the final field/row unless the input ended exactly on a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Present any raw cell as a trimmed string (for id/type/subType/unit and header names). */
function cellToString(raw: RawCell): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

/**
 * Recover a typed value from a raw cell.
 *
 * Excel hands back native numbers/booleans — we keep them as-is (requirement: don't force Excel
 * values to strings). A CSV cell is text, so we infer: case-insensitive TRUE/FALSE → boolean, a
 * bare integer/decimal → number, otherwise text. An empty/blank cell is "missing", not a value.
 */
function cellToValue(raw: RawCell): { ok: true; value: DatasetValue } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: false };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  const t = raw.trim();
  if (t === '') return { ok: false };
  const lower = t.toLowerCase();
  if (lower === 'true') return { ok: true, value: true };
  if (lower === 'false') return { ok: true, value: false };
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return { ok: true, value: n };
  }
  return { ok: true, value: t };
}

/** Trim, and collapse a missing optional cell to `undefined` so it drops out of the record. */
function optional(raw: RawCell): string | undefined {
  const t = cellToString(raw);
  return t === '' ? undefined : t;
}

/** Drop trailing empty cells so a source that pads rows doesn't trip the column-count check. */
function trimTrailingEmpty(row: RawCell[]): RawCell[] {
  let end = row.length;
  while (end > 0 && cellToString(row[end - 1]) === '') end--;
  return row.slice(0, end);
}

/**
 * The single normalization path shared by every provider. Header-driven (column ORDER does not
 * matter, only the names), tolerant of missing trailing optional columns, strict about the five
 * required columns, and type-preserving for Excel. Every rejected row becomes a diagnostic
 * keyed by its line number — nothing is silently dropped.
 */
/**
 * Like {@link DatasetLoadResult} but with per-record side-channel data the DB sync needs — the
 * 1-based source line and the optional `record_id` column value (business id) — WITHOUT changing
 * the {@link DatasetRecord} contract. `lines[i]` / `recordIds[i]` correspond to `records[i]`.
 */
export type DetailedLoadResult = DatasetLoadResult & {
  lines: number[];
  recordIds: (string | null)[];
};

/** Detailed variant that also reports each record's source line + optional record_id. {@link normalizeRows} wraps it. */
export function normalizeRowsDetailed(rows: RawCell[][], sourceId: string): DetailedLoadResult {
  const diagnostics: DatasetDiagnostic[] = [];
  const records: DatasetRecord[] = [];
  const lines: number[] = [];
  const recordIds: (string | null)[] = [];

  // First row that has any non-empty cell is the header.
  const headerIndex = rows.findIndex((r) => r.some((c) => cellToString(c) !== ''));
  if (headerIndex === -1) {
    diagnostics.push({
      level: 'error',
      code: 'empty_source',
      message: `Source "${sourceId}" is empty — no header row found.`,
      source: sourceId,
    });
    return { records, lines, recordIds, diagnostics };
  }

  const header = (rows[headerIndex] ?? []).map((c) => cellToString(c).toLowerCase());
  const colIndex = new Map<string, number>();
  header.forEach((name, i) => {
    if (!colIndex.has(name)) colIndex.set(name, i);
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !colIndex.has(c));
  if (missing.length > 0) {
    diagnostics.push({
      level: 'error',
      code: 'missing_columns',
      message: `Source "${sourceId}" is missing required column(s): ${missing.join(', ')}. ` +
        `Expected header: ${[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(', ')}.`,
      source: sourceId,
    });
    return { records, lines, recordIds, diagnostics };
  }

  const cell = (row: RawCell[], name: string): RawCell => {
    const i = colIndex.get(name);
    return i === undefined ? undefined : row[i];
  };

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const rawRow = rows[r];
    if (!rawRow) continue;
    const line = r + 1; // 1-based for humans
    const row = trimTrailingEmpty(rawRow);
    // Skip fully blank lines silently — they are formatting, not data.
    if (row.length === 0) continue;

    if (row.length > header.length) {
      diagnostics.push({
        level: 'error',
        code: 'malformed_row',
        message: `Line ${line}: has ${row.length} columns but the header has ${header.length}. ` +
          `A likely unescaped separator — row skipped.`,
        source: sourceId,
      });
      continue;
    }

    const districtId = cellToString(cell(row, 'district_id'));
    const datasetType = cellToString(cell(row, 'dataset_type'));
    const subType = cellToString(cell(row, 'sub_type'));
    const unit = cellToString(cell(row, 'unit'));
    const rawValue = cell(row, 'value');

    const problems: string[] = [];
    if (districtId === '') problems.push('district_id is empty');
    if (datasetType === '') problems.push('dataset_type is empty');
    if (subType === '') problems.push('sub_type is empty');

    const coerced = cellToValue(rawValue);
    if (!coerced.ok) problems.push('value is empty');

    if (problems.length > 0) {
      diagnostics.push({
        level: 'error',
        code: 'malformed_row',
        message: `Line ${line}: ${problems.join('; ')} — row skipped.`,
        source: sourceId,
      });
      continue;
    }

    const candidate = {
      districtId,
      datasetType,
      subType,
      value: (coerced as { ok: true; value: DatasetValue }).value,
      unit, // may legitimately be '' for boolean/text
      districtName: optional(cell(row, 'district_name')),
      source: optional(cell(row, 'source')),
      lastUpdated: optional(cell(row, 'last_updated')),
      notes: optional(cell(row, 'notes')),
    };

    // Validate against the contract as a final guard, so a bug in coercion can never emit a
    // record that violates the schema the whole app relies on.
    const parsed = DatasetRecord.safeParse(candidate);
    if (!parsed.success) {
      diagnostics.push({
        level: 'error',
        code: 'schema_violation',
        message: `Line ${line}: ${parsed.error.issues.map((i) => i.message).join('; ')} — row skipped.`,
        source: sourceId,
      });
      continue;
    }
    records.push(parsed.data);
    lines.push(line);
    recordIds.push(optional(cell(row, 'record_id')) ?? null);
  }

  return { records, lines, recordIds, diagnostics };
}

/**
 * The single normalization path shared by every provider. Header-driven (column ORDER does not
 * matter, only the names), tolerant of missing trailing optional columns, strict about the five
 * required columns, and type-preserving for Excel. Every rejected row becomes a diagnostic
 * keyed by its line number — nothing is silently dropped.
 */
export function normalizeRows(rows: RawCell[][], sourceId: string): DatasetLoadResult {
  const { records, diagnostics } = normalizeRowsDetailed(rows, sourceId);
  return { records, diagnostics };
}

/** Append a cache-busting param so a manual refresh bypasses any browser/CDN caching. */
export function cacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_=${Date.now()}`;
}

/**
 * V1 development/demo source: the local CSV under public/data/. Same logical schema as the
 * external sources, so it is a true fallback, not a special format. Fetches from the app's own
 * origin.
 */
export class LocalDatasetProvider implements DatasetProvider {
  readonly id = 'local-demo-csv';
  readonly label = 'Demo dataset';
  private readonly url: string;
  constructor(url = '/data/district-datasets.csv') {
    this.url = url;
  }

  async load(): Promise<DatasetLoadResult> {
    const res = await fetch(this.url, { headers: { accept: 'text/csv' }, cache: 'no-store' });
    if (!res.ok) {
      return errorResult(this.id, 'source_unavailable',
        `Could not load ${this.url} — HTTP ${res.status} ${res.statusText}.`);
    }
    return normalizeRows(parseCsv(await res.text()), this.id);
  }
}

/**
 * Google Sheets source. V1 reads a PUBLISHED CSV export URL (File → Share → Publish to web, or a
 * `…/export?format=csv` link). No API key, OAuth token or service-account credential ever lives
 * in the frontend — a private sheet cannot be fetched safely client-side and would need a
 * server-side provider instead (reported, never worked around). The CSV goes through the exact
 * same parser + normalizer as the local provider.
 */
export class GoogleSheetsDatasetProvider implements DatasetProvider {
  readonly id = 'google-sheets';
  readonly label = 'Google Sheets';
  private readonly url: string;
  constructor(url: string) {
    this.url = url;
  }

  async load(): Promise<DatasetLoadResult> {
    let res: Response;
    try {
      res = await fetch(cacheBust(this.url), { headers: { accept: 'text/csv' }, cache: 'no-store' });
    } catch (e: unknown) {
      return errorResult(this.id, 'source_unavailable',
        `Could not reach the Google Sheet: ${e instanceof Error ? e.message : String(e)}. ` +
        `If the sheet is private it cannot be fetched client-side — a server-side provider is required.`);
    }
    if (!res.ok) {
      return errorResult(this.id, 'source_unavailable',
        `Google Sheet returned HTTP ${res.status} ${res.statusText}. ` +
        `Ensure the sheet is published to the web as CSV (private sheets need a backend).`);
    }
    const text = await res.text();
    // A published sheet that isn't actually public often returns an HTML sign-in page.
    if (/^\s*<(?:!doctype|html)/i.test(text)) {
      return errorResult(this.id, 'invalid_response',
        `The Google Sheet URL returned HTML, not CSV — it is probably not published publicly. ` +
        `Publish it to the web as CSV, or use a server-side provider for a private sheet.`);
    }
    return normalizeRows(parseCsv(text), this.id);
  }
}

/** Build a single-diagnostic failure result without repeating the shape everywhere. */
export function errorResult(source: string, code: string, message: string): DatasetLoadResult {
  return { records: [], diagnostics: [{ level: 'error', code, message, source }] };
}
