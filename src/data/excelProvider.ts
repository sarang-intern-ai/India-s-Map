import type { WorkBook } from 'xlsx';
import {
  cacheBust,
  errorResult,
  normalizeRows,
  type DatasetLoadResult,
  type DatasetProvider,
  type RawCell,
} from './datasetProvider.ts';

/**
 * SheetJS is ~340 kB. It is loaded on demand — only when an Excel source is actually used — so
 * users on the demo CSV or Google Sheets never pay for it. `import type` above is erased at build
 * and adds nothing to any bundle.
 */
function loadXlsx() {
  return import('xlsx');
}

/**
 * Excel (.xlsx) source. Reads a workbook from either a configured/public URL or a user-selected
 * file (an ArrayBuffer), selects the correct worksheet, and funnels its rows through the SAME
 * {@link normalizeRows} + schema validation every other provider uses. Excel's native cell types
 * (numbers, booleans) are preserved — SheetJS is read with `raw: true`, and the normalizer keeps
 * numbers/booleans as-is rather than stringifying them.
 *
 * Worksheet selection: a single-sheet workbook is used automatically. If there are several and
 * none is configured, the load fails with a diagnostic that lists the available sheet names —
 * the wrong sheet is never picked silently.
 */
export type ExcelSource =
  | { kind: 'url'; url: string; sheetName?: string }
  | { kind: 'buffer'; data: ArrayBuffer; fileName: string; sheetName?: string };

/** Read just the worksheet names from a workbook buffer (used to offer a sheet picker). */
export async function readWorkbookSheetNames(data: ArrayBuffer): Promise<string[]> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(data, { type: 'array' });
  return wb.SheetNames;
}

export type ExcelRowsResult =
  | { ok: true; rows: RawCell[][]; sheetName: string; sheetNames: string[] }
  | { ok: false; code: string; message: string; sheetNames: string[] };

/**
 * Workbook bytes → raw header-plus-data rows for the chosen worksheet, with the SAME worksheet
 * selection rules the provider uses. Shared by {@link ExcelDatasetProvider} and the DB import so
 * there is exactly one Excel reading path — the import reuses it and then the SAME normalizer,
 * never a second parser.
 */
export async function excelRowsFromBuffer(
  data: ArrayBuffer,
  sheetName?: string,
): Promise<ExcelRowsResult> {
  const XLSX = await loadXlsx();
  let wb: WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array' });
  } catch (e: unknown) {
    return { ok: false, code: 'invalid_file', sheetNames: [],
      message: `Could not read the workbook — not a valid .xlsx file? ${e instanceof Error ? e.message : String(e)}.` };
  }
  const names = wb.SheetNames;
  if (names.length === 0) {
    return { ok: false, code: 'no_worksheet', message: 'The workbook contains no worksheets.', sheetNames: names };
  }
  let chosen = sheetName;
  if (chosen) {
    if (!names.includes(chosen)) {
      return { ok: false, code: 'missing_worksheet', sheetNames: names,
        message: `Worksheet "${chosen}" not found. Available: ${names.join(', ')}.` };
    }
  } else if (names.length === 1) {
    chosen = names[0];
  } else {
    return { ok: false, code: 'multiple_sheets', sheetNames: names,
      message: `The workbook has ${names.length} worksheets: ${names.join(', ')}. Choose which one to read.` };
  }
  const ws = wb.Sheets[chosen as string];
  if (!ws) {
    return { ok: false, code: 'no_worksheet', message: `Worksheet "${chosen}" could not be opened.`, sheetNames: names };
  }
  // header:1 → array-of-arrays; raw:true → native numbers/booleans; defval:null keeps column
  // positions stable so header alignment is preserved even with blank cells.
  const rows = XLSX.utils.sheet_to_json<RawCell[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  return { ok: true, rows, sheetName: chosen as string, sheetNames: names };
}

export class ExcelDatasetProvider implements DatasetProvider {
  readonly id = 'excel';
  readonly label = 'Excel';
  private readonly source: ExcelSource;
  constructor(source: ExcelSource) {
    this.source = source;
  }

  async load(): Promise<DatasetLoadResult> {
    let data: ArrayBuffer;
    if (this.source.kind === 'url') {
      let res: Response;
      try {
        res = await fetch(cacheBust(this.source.url), { cache: 'no-store' });
      } catch (e: unknown) {
        return errorResult(this.id, 'source_unavailable',
          `Could not reach the Excel workbook: ${e instanceof Error ? e.message : String(e)}.`);
      }
      if (!res.ok) {
        return errorResult(this.id, 'source_unavailable',
          `Excel workbook returned HTTP ${res.status} ${res.statusText}.`);
      }
      data = await res.arrayBuffer();
    } else {
      data = this.source.data;
    }

    const sheet = await excelRowsFromBuffer(data, this.source.sheetName);
    if (!sheet.ok) {
      return errorResult(this.id, sheet.code, sheet.message);
    }
    return normalizeRows(sheet.rows, this.id);
  }
}
