import {
  GoogleSheetsDatasetProvider,
  LocalDatasetProvider,
  type DatasetProvider,
} from './datasetProvider.ts';
import { ExcelDatasetProvider } from './excelProvider.ts';
import { PostgresDatasetProvider } from './postgresProvider.ts';

/**
 * The source-configuration layer. Which provider runs is decided HERE, by configuration — never
 * by branching in the UI. The DistrictPanel and DatasetPanels are identical whether the data
 * came from the demo CSV, a Google Sheet, or an Excel workbook.
 *
 *   env / user action → ActiveSource → providerForSource() → DatasetProvider → DatasetRecord[]
 *
 * `excel-file` is the one runtime source (a user-picked .xlsx); the rest come from build-time env.
 */
export type ActiveSource =
  | { kind: 'local' }
  | { kind: 'google-sheets'; url: string }
  | { kind: 'excel-url'; url: string; sheetName?: string }
  | { kind: 'excel-file'; data: ArrayBuffer; fileName: string; sheetName?: string }
  | { kind: 'postgres'; base: string };

/** Coarse kind for the status UI, collapsing the two Excel variants. */
export type SourceKind = 'local' | 'google-sheets' | 'excel' | 'postgres';

export type ResolvedSource = {
  source: ActiveSource;
  /** True when a Google Sheets CSV URL is configured, so the UI can say so honestly. */
  googleConfigured: boolean;
  /** Present when a requested external source fell back to local (e.g. URL not set). */
  note?: string;
};

function env(name: string): string | undefined {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the configured source from Vite env vars:
 *   VITE_DATASET_SOURCE          "local" | "google-sheets" | "excel"  (optional)
 *   VITE_GOOGLE_SHEETS_CSV_URL   published CSV export URL              (no secrets)
 *   VITE_EXCEL_URL               public .xlsx URL                      (optional)
 *   VITE_EXCEL_SHEET_NAME        worksheet name                        (optional)
 *
 * If a source is requested but its URL is absent, the app STILL WORKS: it falls back to the demo
 * dataset and reports why. No real URL is ever hard-coded.
 */
export function resolveConfiguredSource(): ResolvedSource {
  const type = env('VITE_DATASET_SOURCE');
  const googleUrl = env('VITE_GOOGLE_SHEETS_CSV_URL');
  const excelUrl = env('VITE_EXCEL_URL');
  const excelSheet = env('VITE_EXCEL_SHEET_NAME');
  const apiBase = env('VITE_API_BASE') ?? '/api';
  const googleConfigured = !!googleUrl;

  if (type === 'postgres') {
    return { source: { kind: 'postgres', base: apiBase }, googleConfigured };
  }

  const wantsGoogle = type === 'google-sheets' || (!type && !!googleUrl);
  const wantsExcel = type === 'excel' || (!type && !googleUrl && !!excelUrl);

  if (wantsGoogle) {
    if (googleUrl) return { source: { kind: 'google-sheets', url: googleUrl }, googleConfigured };
    return {
      source: { kind: 'local' },
      googleConfigured,
      note: 'Google Sheets selected but VITE_GOOGLE_SHEETS_CSV_URL is not set — using the demo dataset.',
    };
  }

  if (wantsExcel) {
    if (excelUrl) {
      return {
        source: { kind: 'excel-url', url: excelUrl, sheetName: excelSheet },
        googleConfigured,
      };
    }
    return {
      source: { kind: 'local' },
      googleConfigured,
      note: 'Excel selected but VITE_EXCEL_URL is not set — using the demo dataset (or upload a workbook).',
    };
  }

  return { source: { kind: 'local' }, googleConfigured };
}

/** Build the provider for an active source. The only place source kind maps to an implementation. */
export function providerForSource(source: ActiveSource): DatasetProvider {
  switch (source.kind) {
    case 'local':
      return new LocalDatasetProvider();
    case 'google-sheets':
      return new GoogleSheetsDatasetProvider(source.url);
    case 'excel-url':
      return new ExcelDatasetProvider({ kind: 'url', url: source.url, sheetName: source.sheetName });
    case 'excel-file':
      return new ExcelDatasetProvider({
        kind: 'buffer',
        data: source.data,
        fileName: source.fileName,
        sheetName: source.sheetName,
      });
    case 'postgres':
      return new PostgresDatasetProvider(source.base);
  }
}

export function sourceKind(source: ActiveSource): SourceKind {
  if (source.kind === 'google-sheets') return 'google-sheets';
  if (source.kind === 'excel-url' || source.kind === 'excel-file') return 'excel';
  if (source.kind === 'postgres') return 'postgres';
  return 'local';
}

/** Human label for the status area. */
export function sourceLabel(source: ActiveSource): string {
  switch (source.kind) {
    case 'local':
      return 'Demo dataset';
    case 'google-sheets':
      return 'Google Sheets';
    case 'excel-url':
      return 'Excel (URL)';
    case 'excel-file':
      return `Excel: ${source.fileName}`;
    case 'postgres':
      return 'PostgreSQL';
  }
}
