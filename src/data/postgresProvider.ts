import {
  cacheBust,
  errorResult,
  type DatasetLoadResult,
  type DatasetProvider,
} from './datasetProvider.ts';
import { DatasetRecord, type DatasetDiagnostic } from './datasetRecords.ts';

/**
 * PostgreSQL source — via the backend API, never a direct DB connection (the frontend has no
 * credentials). It fetches the whole dataset as JSON and validates every row against the SAME
 * {@link DatasetRecord} contract every other provider uses, so the records it yields are
 * indistinguishable from the Excel provider's. The DistrictPanel/StatePanel and the aggregation
 * engine cannot tell PostgreSQL from Excel — only the configured source differs.
 *
 * The API base defaults to `/api` (same-origin; the Vite dev server proxies it to the API
 * process), overridable with VITE_API_BASE. No DATABASE_URL is ever exposed here.
 */
export class PostgresDatasetProvider implements DatasetProvider {
  readonly id = 'postgres';
  readonly label = 'PostgreSQL';
  private readonly base: string;
  constructor(base = '/api') {
    this.base = base.replace(/\/+$/, '');
  }

  async load(): Promise<DatasetLoadResult> {
    const url = cacheBust(`${this.base}/datasets`);
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
    } catch (e: unknown) {
      return errorResult(this.id, 'source_unavailable',
        `Could not reach the dataset API at ${this.base}: ${e instanceof Error ? e.message : String(e)}. ` +
        `Is the backend running (npm run server)?`);
    }
    if (!res.ok) {
      return errorResult(this.id, 'source_unavailable',
        `Dataset API returned HTTP ${res.status} ${res.statusText}.`);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (e: unknown) {
      return errorResult(this.id, 'invalid_response',
        `Dataset API did not return JSON: ${e instanceof Error ? e.message : String(e)}.`);
    }
    if (!Array.isArray(payload)) {
      return errorResult(this.id, 'invalid_response', 'Dataset API did not return a JSON array of records.');
    }

    const diagnostics: DatasetDiagnostic[] = [];
    const records = [];
    for (let i = 0; i < payload.length; i++) {
      const parsed = DatasetRecord.safeParse(payload[i]);
      if (parsed.success) records.push(parsed.data);
      else {
        diagnostics.push({
          level: 'error',
          code: 'schema_violation',
          message: `API record ${i}: ${parsed.error.issues.map((x) => x.message).join('; ')} — skipped.`,
          source: this.id,
        });
      }
    }
    return { records, diagnostics };
  }
}
