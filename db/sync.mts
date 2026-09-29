// Manual one-shot sync (admin/debug). Run:
//   npm run db:sync              — apply changes
//   npm run db:sync -- --dry-run — show what WOULD change, without modifying the DB
import { makePool } from './pool.ts';
import { syncOnce, resolveSyncSource } from './sync.ts';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = resolveSyncSource();
  const pool = makePool();
  try {
    const label =
      config.kind === 'excel' ? `Excel: ${config.file} [${config.sheetName}]`
      : config.kind === 'word' ? `Word: ${config.file}`
      : config.kind === 'crs' ? `CRS Excel: ${config.file}`
      : config.kind === 'crs-speech' ? `CRS Speech Excel: ${config.file}`
      : `Google Sheets: ${config.url}`;
    console.log(`Source: ${label}${dryRun ? ' (dry-run)' : ''}`);
    const r = await syncOnce(pool, config, { dryRun });
    console.log(`Status: ${r.status.toUpperCase()}`);
    console.log(`  rows_read=${r.rowsRead} inserted=${r.inserted} updated=${r.updated} deleted=${r.deleted} unchanged=${r.unchanged} warnings=${r.warnings} errors=${r.errors}`);
    console.log(`  ${r.message}`);
    if (r.status === 'failed') process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error('Sync failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
