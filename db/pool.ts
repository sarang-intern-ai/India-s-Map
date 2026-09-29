import pg from 'pg';
import { databaseUrl } from './env.ts';

/**
 * A shared pg connection pool built from DATABASE_URL. Server-side only. `ssl` is enabled with
 * relaxed verification when the URL asks for it (managed Postgres), off for local.
 */
export function makePool(): pg.Pool {
  const connectionString = databaseUrl();
  const wantSsl = /[?&]sslmode=require/.test(connectionString) || process.env.PGSSL === 'require';
  const pool = new pg.Pool({
    connectionString,
    ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
    // Keep it small — this is a single-user dev/parity tool, not a production service.
    max: 4,
  });
  // Without this, an idle client dropped by the server (e.g. PostgreSQL restart) emits an
  // unhandled 'error' event and crashes the whole process. Long-running services (API, sync
  // watcher) must survive DB restarts — the pool discards the bad client and reconnects on the
  // next query, so we log and continue.
  pool.on('error', (err) => {
    console.error(`[pg pool] idle client error (recovering): ${err instanceof Error ? err.message : err}`);
  });
  return pool;
}
