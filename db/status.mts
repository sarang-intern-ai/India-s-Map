// Database diagnostics — connection, schema version, and dataset counts. No credentials printed.
// Run: npm run db:status
import { makePool } from './pool.ts';

async function main() {
  const pool = makePool();
  const client = await pool.connect();
  try {
    const { rows: [ver] } = await client.query<{ v: string }>('SELECT version() AS v');
    console.log('Connection:      OK');
    console.log('Server:         ', (ver?.v ?? '').split(',')[0]);

    const schema = await client.query<{ version: string }>(
      `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`,
    ).catch(() => ({ rows: [] as { version: string }[] }));
    console.log('Schema version: ', schema.rows[0]?.version ?? '(no migrations table — run db:migrate)');

    const has = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.dataset_records') IS NOT NULL AS exists`,
    );
    if (!has.rows[0]?.exists) {
      console.log('dataset_records: (missing — run db:migrate)');
      return;
    }

    const counts = await client.query<{ records: string; districts: string; types: string }>(`
      SELECT
        (SELECT count(*)                    FROM dataset_records)                AS records,
        (SELECT count(DISTINCT district_id) FROM dataset_records)                AS districts,
        (SELECT count(DISTINCT dataset_type) FROM dataset_records)               AS types
    `);
    const ref = await client.query<{ n: string }>(`SELECT count(*) AS n FROM districts_reference`);
    const c = counts.rows[0]!;
    console.log('Dataset records:', c.records);
    console.log('Distinct districts:', c.districts);
    console.log('Distinct dataset types:', c.types);
    console.log('districts_reference rows:', ref.rows[0]?.n ?? '0');

    const byType = await client.query<{ dataset_type: string; n: string }>(
      `SELECT dataset_type, count(*) AS n FROM dataset_records GROUP BY dataset_type ORDER BY dataset_type`,
    );
    if (byType.rows.length) {
      console.log('By type:        ', byType.rows.map((r) => `${r.dataset_type}=${r.n}`).join(', '));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error('Status check failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
