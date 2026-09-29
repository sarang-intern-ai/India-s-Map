import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { readCrsDataset, type CrsRecord } from './crsDataset.ts';
import { buildReconciler, type Reconciler } from './districtReconcile.ts';
import type { SyncResult } from './sync.ts';

/**
 * Synchronize the detailed CRS Excel workbook → `crs_records`, atomically, with the SAME contract
 * as the generic sync (fingerprint change-detection, validation gate, insert/update/delete,
 * source-scoped, last-good on failure, sync-run history, version bump). Reconciles only its own
 * `source_id`, so it can never touch main-dataset / Word / any other source.
 */

let cached: Reconciler | null = null;
const reconciler = () => (cached ??= buildReconciler());

const MUTABLE = ['district_id', 's_no', 'crs_name', 'organization', 'location', 'language', 'hours'] as const;

function fingerprintOf(records: CrsRecord[]): string {
  const canon = records
    .map((r) => [r.sourceKey, r.districtId, r.sNo, r.crsName, r.organization, r.location, r.language, r.hours])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

async function recordRun(pool: Pool, sourceId: string, r: SyncResult, startedAt: string) {
  await pool.query(
    `INSERT INTO dataset_sync_runs
       (source_id, started_at, completed_at, status, rows_read, inserted_count, updated_count,
        deleted_count, unchanged_count, warning_count, error_count, source_fingerprint, message)
     VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [sourceId, startedAt, r.status, r.rowsRead, r.inserted, r.updated, r.deleted, r.unchanged,
     r.warnings, r.errors, r.fingerprint, r.message],
  );
}

function differs(d: CrsRecord, row: Record<string, unknown>): boolean {
  return (d.districtId !== row.district_id) || ((d.sNo ?? null) !== (row.s_no ?? null)) ||
    (d.crsName !== row.crs_name) || ((d.organization || null) !== (row.organization ?? null)) ||
    ((d.location || null) !== (row.location ?? null)) || ((d.language ?? null) !== (row.language ?? null)) ||
    ((d.hours ?? null) !== (row.hours ?? null));
}

export async function syncCrsOnce(
  pool: Pool,
  file: string,
  opts: { sourceId?: string; dryRun?: boolean } = {},
): Promise<SyncResult> {
  const sourceId = opts.sourceId ?? process.env.DATASET_SOURCE_ID ?? 'community-radio-crs';
  const dryRun = !!opts.dryRun;
  const startedAt = new Date().toISOString();

  // ── Validation gate ────────────────────────────────────────────────────────────────────────
  let read;
  try {
    read = await readCrsDataset(new Uint8Array(readFileSync(file)), reconciler());
  } catch (e: unknown) {
    read = { ok: false as const, code: 'source_unavailable', diagnostics: [],
      message: `Could not read CRS workbook ${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!read.ok) {
    const result: SyncResult = {
      status: 'failed', rowsRead: 0, inserted: 0, updated: 0, deleted: 0, unchanged: 0,
      warnings: 0, errors: 1, fingerprint: null,
      message: `SYNC FAILED — previous database state retained. ${read.code}: ${read.message}`,
    };
    if (!dryRun) {
      await recordRun(pool, sourceId, result, startedAt).catch(() => {});
      await pool.query(
        `INSERT INTO dataset_source_state (source_id, last_sync_status, last_synced_at)
         VALUES ($1,'failed',now()) ON CONFLICT (source_id) DO UPDATE SET last_sync_status='failed', last_synced_at=now()`,
        [sourceId]).catch(() => {});
    }
    return result;
  }

  const warnings = read.diagnostics.length;
  const desired = read.records;
  const fingerprint = fingerprintOf(desired);

  const stateRes = await pool.query<{ fingerprint: string | null }>(
    `SELECT fingerprint FROM dataset_source_state WHERE source_id = $1`, [sourceId]);
  if (fingerprint === (stateRes.rows[0]?.fingerprint ?? null)) {
    const result: SyncResult = { status: 'no_changes', rowsRead: desired.length, inserted: 0, updated: 0,
      deleted: 0, unchanged: desired.length, warnings, errors: 0, fingerprint, message: 'No changes detected.' };
    if (!dryRun) {
      await recordRun(pool, sourceId, result, startedAt);
      await pool.query(`UPDATE dataset_source_state SET last_sync_status='no_changes', last_synced_at=now() WHERE source_id=$1`, [sourceId]);
    }
    return result;
  }

  // ── Apply atomically ───────────────────────────────────────────────────────────────────────
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query<Record<string, unknown>>(
      `SELECT id, source_key, district_id, s_no, crs_name, organization, location, language, hours
         FROM crs_records WHERE source_id=$1 FOR UPDATE`, [sourceId]);
    const existing = new Map<string, Record<string, unknown>>();
    for (const row of existingRes.rows) existing.set(String(row.source_key), row);

    let inserted = 0, updated = 0, unchanged = 0, deleted = 0;
    const seen = new Set<string>();
    for (const d of desired) {
      seen.add(d.sourceKey);
      const cur = existing.get(d.sourceKey);
      if (!cur) {
        await client.query(
          `INSERT INTO crs_records (source_id, source_key, district_id, s_no, crs_name, organization, location, language, hours)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [sourceId, d.sourceKey, d.districtId, d.sNo, d.crsName, d.organization || null, d.location || null, d.language, d.hours]);
        inserted++;
      } else if (differs(d, cur)) {
        await client.query(
          `UPDATE crs_records SET district_id=$2, s_no=$3, crs_name=$4, organization=$5, location=$6,
             language=$7, hours=$8, updated_at=now() WHERE id=$1`,
          [cur.id, d.districtId, d.sNo, d.crsName, d.organization || null, d.location || null, d.language, d.hours]);
        updated++;
      } else unchanged++;
    }
    for (const [key, row] of existing) if (!seen.has(key)) { await client.query(`DELETE FROM crs_records WHERE id=$1`, [row.id]); deleted++; }

    const result: SyncResult = { status: 'success', rowsRead: desired.length, inserted, updated, deleted,
      unchanged, warnings, errors: 0, fingerprint, message: `Synced: +${inserted} ~${updated} -${deleted} =${unchanged}.` };

    if (dryRun) { await client.query('ROLLBACK'); result.message = `DRY RUN — would apply: +${inserted} ~${updated} -${deleted} =${unchanged}.`; return result; }

    await client.query(
      `INSERT INTO dataset_source_state (source_id, fingerprint, version, data_updated_at, last_sync_status, last_synced_at)
       VALUES ($1,$2,$3,now(),'success',now())
       ON CONFLICT (source_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint, version=EXCLUDED.version,
         data_updated_at=now(), last_sync_status='success', last_synced_at=now()`,
      [sourceId, fingerprint, fingerprint.slice(0, 12)]);
    await recordRun(pool, sourceId, result, startedAt);
    await client.query('COMMIT');
    return result;
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const result: SyncResult = { status: 'failed', rowsRead: desired.length, inserted: 0, updated: 0, deleted: 0,
      unchanged: 0, warnings, errors: 1, fingerprint,
      message: `SYNC FAILED — previous database state retained. ${e instanceof Error ? e.message : String(e)}` };
    await recordRun(pool, sourceId, result, startedAt).catch(() => {});
    return result;
  } finally {
    client.release();
  }
}
