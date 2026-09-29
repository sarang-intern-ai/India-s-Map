import { readFileSync } from 'node:fs';

/**
 * Minimal .env loader for the Node-side DB tooling (no dotenv dependency). Reads `.env.local`
 * then `.env` from the project root and fills any keys NOT already in `process.env` (real env
 * always wins). This is server-side only — the browser never sees DATABASE_URL. `.env.local` is
 * gitignored, so credentials never get committed.
 */
function parseEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  // .env is the lower-priority default; .env.local overrides it; real process.env wins over both.
  const merged = { ...parseEnvFile('.env'), ...parseEnvFile('.env.local') };
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

/** The database connection string. Throws a clear, credential-free error if it is missing. */
export function databaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env.local (gitignored), e.g.\n' +
        '  DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/indias_map\n' +
        'See .env.example and docs/DATABASE.md.',
    );
  }
  return url;
}

/** Backend API port (used by the server and the Vite proxy). Defaults to 8787. */
export function apiPort(): number {
  loadEnv();
  const p = process.env.API_PORT;
  return p ? Number(p) : 8787;
}
