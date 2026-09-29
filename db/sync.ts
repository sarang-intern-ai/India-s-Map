import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { recordToInsert, type DatasetInsert } from './mapping.ts';
import { assignSourceKeys } from './identity.ts';
import { readSyncSource, resolveSyncSource, type SyncSourceConfig } from './syncSource.ts';
import { syncCrsOnce } from './crsSync.ts';

/**
 * The synchronization engine: source spreadsheet → PostgreSQL, atomically. Reuses the frontend
 * normalization (via readSyncSource) and never touches the DB unless the source is valid AND its
 * fingerprint changed. A malformed source can never destroy the working data.
 */

export type SyncResult = {
  status: 'success' | 'no_changes' | 'failed';
  rowsRead: number;
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
  warnings: number;
  errors: number;
  fingerprint: string | null;
  message: string;
};

export type SyncOptions = { sourceId?: string; dryRun?: boolean };

const MUTABLE = ['value_type', 'value_number', 'value_text', 'value_boolean', 'unit', 'source', 'last_updated', 'notes', 'record_id'] as const;

/** Fingerprint of the desired dataset — order-independent (sorted by identity), so a pure reorder
 *  of distinct rows is a no-op, while any value/insert/delete changes it. */
function fingerprintOf(desired: DatasetInsert[]): string {
  const canonical = desired
    .map((d) => [d.source_key, d.district_id, d.dataset_type, d.sub_type, d.value_type,
      d.value_number, d.value_text, d.value_boolean, d.unit, d.source, d.last_updated, d.notes, d.record_id])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

type ExistingRow = { id: string } & Record<(typeof MUTABLE)[number], unknown> &
  { district_id: string; dataset_type: string; sub_type: string; source_key: string };

function differs(desired: DatasetInsert, existing: ExistingRow): boolean {
  for (const f of MUTABLE) {
    // pg returns double precision as number, boolean as boolean, text/null as-is.
    if ((desired as Record<string, unknown>)[f] !== existing[f]) {
      // treat null and undefined the same
      const dv = (desired as Record<string, unknown>)[f] ?? null;
      const ev = existing[f] ?? null;
      if (dv !== ev) return true;
    }
  }
  return false;
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

/** Run one synchronization. Atomic: on any fatal problem the DB is left exactly as it was. */
export async function syncOnce(pool: Pool, config: SyncSourceConfig, opts: SyncOptions = {}): Promise<SyncResult> {
  // The detailed CRS Excel source reconciles into crs_records via its own engine.
  if (config.kind === 'crs') return syncCrsOnce(pool, config.file, opts);
  const sourceId = opts.sourceId ?? process.env.DATASET_SOURCE_ID ?? 'main-dataset';
  const dryRun = !!opts.dryRun;
  const startedAt = new Date().toISOString();
  const sourceName =
    config.kind === 'google' ? config.url : config.file.split(/[\\/]/).pop() ?? config.file;

  // ── Validation gate: parse + normalize + validate the ENTIRE source first ──────────────────
  const read = await readSyncSource(config);
  if (!read.ok) {
    const result: SyncResult = {
      status: 'failed', rowsRead: 0, inserted: 0, updated: 0, deleted: 0, unchanged: 0,
      warnings: 0, errors: 1, fingerprint: null,
      message: `SYNC FAILED — previous database state retained. ${read.code}: ${read.message}`,
    };
    if (!dryRun) {
      await recordRun(pool, sourceId, result, startedAt);
      await pool.query(
        `INSERT INTO dataset_source_state (source_id, last_sync_status, last_synced_at)
         VALUES ($1,'failed',now())
         ON CONFLICT (source_id) DO UPDATE SET last_sync_status='failed', last_synced_at=now()`,
        [sourceId],
      );
    }
    return result;
  }

  const warnings = read.diagnostics.filter((d) => d.level === 'warning').length +
    read.diagnostics.filter((d) => d.level === 'error').length; // row-level errors are non-fatal warnings here
  const keys = assignSourceKeys(read.records, read.recordIds);
  const desired = read.records.map((rec, i) =>
    recordToInsert(rec, { sourceId, sourceKey: keys[i]!, recordId: read.recordIds[i] ?? null, sourceName }));
  const fingerprint = fingerprintOf(desired);

  // ── Change detection ────────────────────────────────────────────────────────────────────────
  const stateRes = await pool.query<{ fingerprint: string | null }>(
    `SELECT fingerprint FROM dataset_source_state WHERE source_id = $1`, [sourceId]);
  const storedFingerprint = stateRes.rows[0]?.fingerprint ?? null;

  if (fingerprint === storedFingerprint) {
    const result: SyncResult = {
      status: 'no_changes', rowsRead: desired.length, inserted: 0, updated: 0, deleted: 0,
      unchanged: desired.length, warnings, errors: 0, fingerprint,
      message: 'No changes detected.',
    };
    if (!dryRun) {
      await recordRun(pool, sourceId, result, startedAt);
      await pool.query(
        `UPDATE dataset_source_state SET last_sync_status='no_changes', last_synced_at=now() WHERE source_id=$1`,
        [sourceId]);
    }
    return result;
  }

  // ── Apply changes atomically ──────────────────────────────────────────────────────────────────
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query<ExistingRow>(
      `SELECT id, source_key, district_id, dataset_type, sub_type, ${MUTABLE.join(', ')}
         FROM dataset_records WHERE source_id = $1 FOR UPDATE`, [sourceId]);
    const existing = new Map<string, ExistingRow>();
    for (const row of existingRes.rows) existing.set(row.source_key, row);

    let inserted = 0, updated = 0, unchanged = 0, deleted = 0;
    const seen = new Set<string>();

    for (const d of desired) {
      seen.add(d.source_key);
      const cur = existing.get(d.source_key);
      if (!cur) {
        await client.query(
          `INSERT INTO dataset_records
             (district_id, dataset_type, sub_type, value_type, value_number, value_text, value_boolean,
              unit, source, last_updated, notes, source_id, source_key, record_id, source_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [d.district_id, d.dataset_type, d.sub_type, d.value_type, d.value_number, d.value_text,
           d.value_boolean, d.unit, d.source, d.last_updated, d.notes, d.source_id, d.source_key,
           d.record_id, d.source_name],
        );
        inserted++;
      } else if (differs(d, cur)) {
        await client.query(
          `UPDATE dataset_records SET
             district_id=$2, dataset_type=$3, sub_type=$4, value_type=$5, value_number=$6, value_text=$7,
             value_boolean=$8, unit=$9, source=$10, last_updated=$11, notes=$12, record_id=$13,
             source_name=$14, updated_at=now()
           WHERE id=$1`,
          [cur.id, d.district_id, d.dataset_type, d.sub_type, d.value_type, d.value_number, d.value_text,
           d.value_boolean, d.unit, d.source, d.last_updated, d.notes, d.record_id, d.source_name],
        );
        updated++;
      } else {
        unchanged++;
      }
    }
    // Deletions: existing keys of THIS source not present in the desired set.
    for (const [key, row] of existing) {
      if (!seen.has(key)) {
        await client.query(`DELETE FROM dataset_records WHERE id=$1`, [row.id]);
        deleted++;
      }
    }

    const result: SyncResult = {
      status: 'success', rowsRead: desired.length, inserted, updated, deleted, unchanged,
      warnings, errors: 0, fingerprint,
      message: `Synced: +${inserted} ~${updated} -${deleted} =${unchanged}.`,
    };

    if (dryRun) {
      await client.query('ROLLBACK');
      result.message = `DRY RUN — would apply: +${inserted} ~${updated} -${deleted} =${unchanged}.`;
      return result;
    }

    const version = fingerprint.slice(0, 12);
    await client.query(
      `INSERT INTO dataset_source_state (source_id, fingerprint, version, data_updated_at, last_sync_status, last_synced_at)
       VALUES ($1,$2,$3,now(),'success',now())
       ON CONFLICT (source_id) DO UPDATE SET
         fingerprint=EXCLUDED.fingerprint, version=EXCLUDED.version, data_updated_at=now(),
         last_sync_status='success', last_synced_at=now()`,
      [sourceId, fingerprint, version],
    );
    await client.query(
      `INSERT INTO dataset_sync_runs
         (source_id, started_at, completed_at, status, rows_read, inserted_count, updated_count,
          deleted_count, unchanged_count, warning_count, error_count, source_fingerprint, message)
       VALUES ($1,$2,now(),'success',$3,$4,$5,$6,$7,$8,0,$9,$10)`,
      [sourceId, startedAt, result.rowsRead, inserted, updated, deleted, unchanged, warnings, fingerprint, result.message],
    );
    await client.query('COMMIT');
    return result;
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const result: SyncResult = {
      status: 'failed', rowsRead: desired.length, inserted: 0, updated: 0, deleted: 0, unchanged: 0,
      warnings, errors: 1, fingerprint,
      message: `SYNC FAILED — previous database state retained. ${e instanceof Error ? e.message : String(e)}`,
    };
    await recordRun(pool, sourceId, result, startedAt).catch(() => {});
    return result;
  } finally {
    client.release();
  }
}

export { resolveSyncSource };
