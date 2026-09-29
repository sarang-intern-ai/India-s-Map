// Lightweight SQL migration runner (no ORM). Applies db/migrations/*.sql in filename order,
// once each, tracked in a schema_migrations table. Run: npm run db:migrate
import { makePool } from './pool.ts';
import { applyMigrations } from './migrateLib.ts';

async function main() {
  const pool = makePool();
  try {
    const ran = await applyMigrations(pool, (m) => console.log(m));
    console.log(ran === 0 ? 'Up to date — nothing to apply.' : `Applied ${ran} migration(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error('Migration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
