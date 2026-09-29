import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Apply db/migrations/*.sql in filename order, once each, tracked in schema_migrations. Shared by
 * the migrate CLI and the sync service (which verifies migrations on start). Returns how many ran.
 */
export async function applyMigrations(pool: Pool, log: (msg: string) => void = () => {}): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      );`);
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
    );
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    let ran = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        log(`= already applied: ${version}`);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      log(`+ applying: ${version}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        ran++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    return ran;
  } finally {
    client.release();
  }
}
