// Automatic sync service — the long-running process that keeps PostgreSQL in step with the source
// spreadsheet. Run: npm run db:sync:watch
//
// Mechanism (precise, no false real-time claims):
//   • Excel  → file-change detection (fs.watch on the workbook's folder) + a periodic safety poll.
//              An edit to the workbook triggers a sync within ~1s.
//   • Google → polling the published CSV every DATASET_SYNC_INTERVAL_MS (default 5 min). A change is
//              picked up within at most that interval.
// Either way, syncOnce only writes when the source FINGERPRINT actually changed, so redundant
// triggers are cheap no-ops. Non-fatal errors are logged and monitoring continues.
import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { makePool } from './pool.ts';
import { applyMigrations } from './migrateLib.ts';
import { syncOnce, resolveSyncSource } from './sync.ts';
import { loadEnv } from './env.ts';

loadEnv();
const INTERVAL = Number(process.env.DATASET_SYNC_INTERVAL_MS ?? 5 * 60 * 1000);
const config = resolveSyncSource();
const pool = makePool();

function stamp() { return new Date().toLocaleTimeString(); }
function log(msg: string) { console.log(`[sync ${stamp()}] ${msg}`); }

let running = false;
let queued = false;
async function runSync(reason: string) {
  if (running) { queued = true; return; }
  running = true;
  try {
    const r = await syncOnce(pool, config);
    const line = `${reason} → ${r.status} (+${r.inserted} ~${r.updated} -${r.deleted} =${r.unchanged}` +
      `${r.warnings ? ` warn=${r.warnings}` : ''})`;
    if (r.status === 'failed') log(`${line} :: ${r.message}`);
    else log(line);
  } catch (e: unknown) {
    log(`ERROR (non-fatal, still watching): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
    if (queued) { queued = false; void runSync('coalesced'); }
  }
}

async function main() {
  // 1–2. connect + verify migrations.
  const ran = await applyMigrations(pool, (m) => log(m));
  if (ran) log(`applied ${ran} migration(s)`);

  const isFile =
    config.kind === 'excel' || config.kind === 'word' || config.kind === 'crs' || config.kind === 'crs-speech';
  const label =
    config.kind === 'excel' ? `Excel file ${config.file} [${config.sheetName}]`
    : config.kind === 'word' ? `Word file ${config.file}`
    : config.kind === 'crs' ? `CRS Excel file ${config.file}`
    : config.kind === 'crs-speech' ? `CRS Speech Excel file ${config.file}`
    : `Google Sheets ${config.url}`;
  log(`watching ${label}`);
  log(isFile ? 'mode: file-change detection + safety poll' : `mode: polling every ${INTERVAL} ms (~${Math.round(INTERVAL / 60000)} min)`);

  // 3–4. initial sync.
  await runSync('initial');

  // 5. monitor.
  if (isFile) {
    const file = resolve(config.file);
    const dir = dirname(file);
    const base = basename(file);
    let debounce: NodeJS.Timeout | null = null;
    try {
      watch(dir, (_event, changed) => {
        if (changed && basename(changed) !== base) return; // ignore other files in the folder
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void runSync('file changed'), 400); // debounce editor multi-writes
      });
    } catch (e: unknown) {
      log(`fs.watch unavailable (${e instanceof Error ? e.message : e}); relying on the safety poll`);
    }
    // Safety net in case a file event is missed.
    setInterval(() => void runSync('safety poll'), INTERVAL);
  } else {
    setInterval(() => void runSync('poll'), INTERVAL);
  }
}

process.on('SIGINT', () => { log('shutting down'); void pool.end().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void pool.end().then(() => process.exit(0)); });

main().catch((e: unknown) => {
  console.error('Sync service failed to start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
