// Minimal backend API. The frontend talks to THIS, never to PostgreSQL directly, so DATABASE_URL
// stays server-side only. Returns the exact DatasetRecord shape the frontend already understands.
// Run: npm run server   (the Vite dev server proxies /api → here)
//
// Endpoints:
//   GET /api/health                       → { ok, records, districts, types }
//   GET /api/datasets                     → DatasetRecord[]  (whole dataset; used by the provider)
//   GET /api/datasets/district/:districtId → DatasetRecord[]  (one district; [] if none)
//   GET /api/datasets/state/:stateId       → DatasetRecord[]  (all districts in the state)
import { createServer } from 'node:http';
import { makePool } from './pool.ts';
import { apiPort, loadEnv } from './env.ts';
import { rowToRecord, type DatasetRow } from './mapping.ts';
import { addCrs, updateCrs, deleteCrs, crsWorkbookVersion, type CrsWriteResult, type CrsEditableFields } from './crsWorkbook.ts';
import { updateSpeechRow, speechWorkbookVersionOf, type SpeechEditFields, type SpeechWriteResult } from './crsSpeechWorkbook.ts';
import { syncCrsOnce } from './crsSync.ts';
import { syncOnce, type SyncResult } from './sync.ts';
import type { DatasetRecord } from '../src/data/datasetRecords.ts';

const pool = makePool();

/** The detailed Community Radio source. Its per-district station COUNT is DERIVED here from
 *  crs_records (never stored), so the "Community Radio: N stations" aggregate is always consistent
 *  with the raw CRS rows and can never double-count against another source. */
const CRS_SOURCE = 'community-radio-crs';

/** The authoritative CRS workbook the API reads AND writes. Excel is the persistent source of truth;
 *  PostgreSQL is a synchronized cache reconciled from it by `syncCrsOnce`. */
loadEnv();
const CRS_FILE = (process.env.SYNC_CRS_FILE ?? '').trim() || 'public/data/CRS(data).xlsx';

/** The Speech-hours workbook + its source_id — owner of the Location / Language/s / Speech Data (Hrs)
 *  fields shown on the CRS card. Edited via the generic dataset sync, isolated from the CRS source. */
const SPEECH_FILE = (process.env.SYNC_CRS_SPEECH_FILE ?? '').trim() || 'public/data/Test- CRS - Datasheet.xlsx';
const SPEECH_SOURCE_ID = (process.env.CRS_SPEECH_SOURCE_ID ?? '').trim() || 'crs-speech-hours';

// Columns are qualified with the `d` alias so the state query's JOIN (districts_reference also has
// district_id) is unambiguous. Output column names are unchanged, so rowToRecord still maps them.
const SELECT_COLS =
  'd.district_id, d.dataset_type, d.sub_type, d.value_type, d.value_number, d.value_text, d.value_boolean, d.unit, d.source, d.last_updated, d.notes';
const ORDER = 'ORDER BY d.id';

function crsCountRecord(districtId: string, n: number): DatasetRecord {
  return { districtId, datasetType: 'Speech', subType: 'Community Radio', value: n, unit: 'stations',
    source: 'Community Radio stations (CRS Excel) — detailed' };
}
/** Synthesize the per-district Community Radio count DatasetRecords from crs_records. */
async function crsCounts(scope: { district?: string; state?: string }): Promise<DatasetRecord[]> {
  let sql: string, params: string[];
  if (scope.district) {
    sql = `SELECT district_id, count(*)::int AS n FROM crs_records WHERE source_id=$1 AND district_id=$2 GROUP BY district_id`;
    params = [CRS_SOURCE, scope.district];
  } else if (scope.state) {
    sql = `SELECT c.district_id, count(*)::int AS n FROM crs_records c
             JOIN districts_reference r ON r.district_id=c.district_id
            WHERE c.source_id=$1 AND r.state_id=$2 GROUP BY c.district_id`;
    params = [CRS_SOURCE, scope.state];
  } else {
    sql = `SELECT district_id, count(*)::int AS n FROM crs_records WHERE source_id=$1 GROUP BY district_id`;
    params = [CRS_SOURCE];
  }
  const { rows } = await pool.query<{ district_id: string; n: number }>(sql, params);
  return rows.map((r) => crsCountRecord(r.district_id, r.n));
}

// Optional ?source=<source_id> isolates one logical source (used by the Excel regression test);
// omitted → all sources merged, INCLUDING the synthesized CRS Community Radio count. Filtering to a
// non-CRS source (e.g. main-dataset) excludes the CRS count, keeping the Excel parity comparison clean.
async function datasetRecordRows(where: string, params: unknown[]): Promise<DatasetRecord[]> {
  const { rows } = await pool.query<DatasetRow>(`SELECT ${SELECT_COLS} FROM dataset_records d ${where} ${ORDER}`, params);
  return rows.map(rowToRecord);
}
async function allRecords(source: string | null) {
  if (source === CRS_SOURCE) return crsCounts({});
  const base = await datasetRecordRows(source ? 'WHERE d.source_id = $1' : '', source ? [source] : []);
  return source ? base : [...base, ...(await crsCounts({}))];
}
async function districtRecords(districtId: string, source: string | null) {
  if (source === CRS_SOURCE) return crsCounts({ district: districtId });
  const base = await datasetRecordRows('WHERE d.district_id = $1' + (source ? ' AND d.source_id = $2' : ''),
    source ? [districtId, source] : [districtId]);
  return source ? base : [...base, ...(await crsCounts({ district: districtId }))];
}
async function stateRecords(stateId: string, source: string | null) {
  if (source === CRS_SOURCE) return crsCounts({ state: stateId });
  const base = await datasetRecordRows(
    'JOIN districts_reference r ON r.district_id = d.district_id WHERE r.state_id = $1' + (source ? ' AND d.source_id = $2' : ''),
    source ? [stateId, source] : [stateId]);
  return source ? base : [...base, ...(await crsCounts({ state: stateId }))];
}

/** Raw per-station CRS records for a district (for the CRS DATA UI). Default order = S.No. */
async function crsForDistrict(districtId: string) {
  const { rows } = await pool.query<{ source_key: string; s_no: number | null; crs_name: string;
    organization: string | null; location: string | null; language: string | null; hours: number | null }>(
    `SELECT source_key, s_no, crs_name, organization, location, language, hours
       FROM crs_records WHERE district_id=$1 ORDER BY s_no NULLS LAST, id`, [districtId]);
  return rows.map((r) => ({ id: r.source_key, sNo: r.s_no, crsName: r.crs_name,
    organization: r.organization, location: r.location, language: r.language, hours: r.hours }));
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*', // same-origin via Vite proxy; permissive for direct hits
    'access-control-expose-headers': 'X-CRS-Version',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(json);
}

/** Read a JSON request body (bounded). Returns {} for an empty body; throws on malformed JSON. */
function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) { req.destroy(); reject(new Error('request body too large')); }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data) as Record<string, unknown>); }
      catch { reject(new Error('malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

/**
 * Run a CRS workbook mutation, then reconcile the workbook into PostgreSQL with the EXISTING engine
 * (`syncCrsOnce`) — never a duplicate reconciliation. Excel is written first (source of truth); the
 * DB catches up here so the client gets an immediately authoritative version. The standalone watcher,
 * if running, sees the same fingerprint and no-ops (loop-safe). A failed workbook write returns the
 * error and leaves both the workbook and the DB untouched.
 */
async function crsMutate(res: import('node:http').ServerResponse, write: () => Promise<CrsWriteResult>) {
  let result: CrsWriteResult;
  try { result = await write(); }
  catch (e: unknown) { return send(res, 500, { error: e instanceof Error ? e.message : String(e), code: 'write_failed' }); }
  if (!result.ok) return send(res, result.status, { error: result.message, code: result.code });

  // Workbook write succeeded → reconcile into PostgreSQL via the existing sync engine.
  let sync: SyncResult | null = null;
  try { sync = await syncCrsOnce(pool, CRS_FILE, { sourceId: CRS_SOURCE }); }
  catch (e: unknown) {
    // The workbook (source of truth) is updated; the DB will catch up via the watcher/poll. Report
    // honestly rather than claiming the DB is in sync.
    return send(res, 200, { ok: true, version: result.version, action: result.action, sourceKey: result.sourceKey,
      sync: { status: 'pending', message: e instanceof Error ? e.message : String(e) } });
  }
  return send(res, 200, { ok: true, version: result.version, action: result.action, sourceKey: result.sourceKey,
    sync: { status: sync.status, inserted: sync.inserted, updated: sync.updated, deleted: sync.deleted, unchanged: sync.unchanged, message: sync.message } });
}

/**
 * Run a Speech-workbook mutation, then reconcile it into PostgreSQL with the EXISTING generic sync
 * (`syncOnce` for the crs-speech source) — the same engine the watcher uses, isolated by source_id.
 * Excel is written first (source of truth); the DB catches up here so the client gets an immediately
 * authoritative version. A failed write returns the error and leaves the workbook and DB untouched.
 */
async function speechMutate(res: import('node:http').ServerResponse, write: () => Promise<SpeechWriteResult>) {
  let result: SpeechWriteResult;
  try { result = await write(); }
  catch (e: unknown) { return send(res, 500, { error: e instanceof Error ? e.message : String(e), code: 'write_failed' }); }
  if (!result.ok) return send(res, result.status, { error: result.message, code: result.code });

  let sync: SyncResult | null = null;
  try { sync = await syncOnce(pool, { kind: 'crs-speech', file: SPEECH_FILE }, { sourceId: SPEECH_SOURCE_ID }); }
  catch (e: unknown) {
    return send(res, 200, { ok: true, version: result.version, action: result.action,
      sync: { status: 'pending', message: e instanceof Error ? e.message : String(e) } });
  }
  return send(res, 200, { ok: true, version: result.version, action: result.action,
    sync: { status: sync.status, inserted: sync.inserted, updated: sync.updated, deleted: sync.deleted, unchanged: sync.unchanged, message: sync.message } });
}

const server = createServer(async (req, res) => {
  try {
    // CORS preflight for PATCH/DELETE/POST with a JSON body (harmless same-origin via the Vite proxy).
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // e.g. ['api','datasets','district','490']

    if (parts[0] !== 'api') return send(res, 404, { error: 'not found' });

    if (parts[1] === 'health') {
      const { rows } = await pool.query(`SELECT
        (SELECT count(*) FROM dataset_records) AS records,
        (SELECT count(DISTINCT district_id) FROM dataset_records) AS districts,
        (SELECT count(DISTINCT dataset_type) FROM dataset_records) AS types`);
      return send(res, 200, { ok: true, ...rows[0] });
    }

    if (parts[1] === 'datasets') {
      const source = url.searchParams.get('source');
      if (parts.length === 2) return send(res, 200, await allRecords(source));
      // Lightweight version/fingerprint so the frontend can cheaply detect a data change without
      // refetching the whole dataset. `version` changes iff the served data changed.
      if (parts[2] === 'version' && parts.length === 3) {
        const { rows } = await pool.query(`
          SELECT
            coalesce(md5(string_agg(coalesce(version, ''), ',' ORDER BY source_id)), '0') AS version,
            max(data_updated_at)                                            AS "lastUpdated",
            (array_agg(last_sync_status ORDER BY last_synced_at DESC NULLS LAST))[1] AS status,
            max(last_synced_at)                                             AS "lastSyncedAt"
          FROM dataset_source_state`);
        return send(res, 200, rows[0] ?? { version: '0', lastUpdated: null, status: null, lastSyncedAt: null });
      }
      if (parts[2] === 'district' && parts[3]) return send(res, 200, await districtRecords(decodeURIComponent(parts[3]), source));
      if (parts[2] === 'state' && parts[3]) return send(res, 200, await stateRecords(decodeURIComponent(parts[3]), source));
    }

    if (parts[1] === 'crs') {
      // Raw per-station CRS records for the CRS DATA UI. The current workbook version travels in the
      // X-CRS-Version header so the client can send it back as the optimistic-concurrency baseVersion.
      if (parts[2] === 'district' && parts[3] && (req.method ?? 'GET') === 'GET') {
        const records = await crsForDistrict(decodeURIComponent(parts[3]));
        const version = (await crsWorkbookVersion(CRS_FILE)) ?? '';
        return send(res, 200, records, { 'X-CRS-Version': version });
      }
      // Current workbook version token (conflict/concurrency): GET /api/crs/version
      if (parts[2] === 'version' && parts.length === 3 && (req.method ?? 'GET') === 'GET') {
        return send(res, 200, { version: (await crsWorkbookVersion(CRS_FILE)) ?? '' });
      }
      // CREATE: POST /api/crs   { districtId, crsName, organization?, location?, language?, hours?, baseVersion? }
      if (req.method === 'POST' && parts.length === 2) {
        const b = await readJsonBody(req);
        return crsMutate(res, () => addCrs(CRS_FILE, {
          districtId: String(b.districtId ?? ''), crsName: String(b.crsName ?? ''),
          organization: (b.organization ?? null) as string | null, location: (b.location ?? null) as string | null,
          language: (b.language ?? null) as string | null, hours: (b.hours ?? null) as number | null,
        }, typeof b.baseVersion === 'string' ? b.baseVersion : undefined));
      }
      // UPDATE: PATCH /api/crs/:sourceKey   { crsName?, organization?, location?, language?, hours?, baseVersion? }
      if (req.method === 'PATCH' && parts[2] && parts.length === 3) {
        const sourceKey = decodeURIComponent(parts[2]);
        const b = await readJsonBody(req);
        const fields: Record<string, unknown> = {};
        for (const k of ['crsName', 'organization', 'location', 'language', 'hours'] as const) {
          if (k in b) fields[k] = b[k];
        }
        return crsMutate(res, () => updateCrs(CRS_FILE, sourceKey, fields as CrsEditableFields, typeof b.baseVersion === 'string' ? b.baseVersion : undefined));
      }
      // DELETE: DELETE /api/crs/:sourceKey   { baseVersion? }
      if (req.method === 'DELETE' && parts[2] && parts.length === 3) {
        const sourceKey = decodeURIComponent(parts[2]);
        const b = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
        return crsMutate(res, () => deleteCrs(CRS_FILE, sourceKey, typeof b.baseVersion === 'string' ? b.baseVersion : undefined));
      }
    }

    if (parts[1] === 'crs-speech') {
      // Current Speech-workbook version token (optimistic concurrency): GET /api/crs-speech/version
      if (parts[2] === 'version' && parts.length === 3 && (req.method ?? 'GET') === 'GET') {
        return send(res, 200, { version: (await speechWorkbookVersionOf(SPEECH_FILE)) ?? '' });
      }
      // UPDATE the Speech row that owns Location / Language/s / Speech Data (Hrs) for one CRS.
      // PATCH /api/crs-speech  { districtId, crsName, organization?, location?, language?, hours?, baseVersion? }
      if (req.method === 'PATCH' && parts.length === 2) {
        const b = await readJsonBody(req);
        const fields: SpeechEditFields = {};
        if ('location' in b) fields.location = (b.location ?? null) as string | null;
        if ('language' in b) fields.language = (b.language ?? null) as string | null;
        if ('hours' in b) fields.hours = (b.hours ?? null) as number | null;
        return speechMutate(res, () => updateSpeechRow(
          SPEECH_FILE,
          { districtId: String(b.districtId ?? ''), crsName: String(b.crsName ?? ''), organization: (b.organization ?? null) as string | null },
          fields,
          typeof b.baseVersion === 'string' ? b.baseVersion : undefined,
        ));
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e: unknown) {
    // Never leak connection strings; report a generic message.
    console.error('[api] error:', e instanceof Error ? e.message : e);
    return send(res, 500, { error: 'internal error' });
  }
});

const port = apiPort();
server.listen(port, () => console.log(`Dataset API listening on http://localhost:${port}/api`));
