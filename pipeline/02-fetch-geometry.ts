/**
 * Stage 02 — download the verified geometry layers and pin them by checksum.
 *
 * A recorded SHA-256 that no longer matches is a HARD FAILURE, not a warning: it means the
 * bytes behind a pinned URL changed, and every downstream verified fact (feature counts,
 * areas, known gaps) would need re-checking. On first fetch of a source whose checksum is
 * not yet recorded, the digest is written back into sources.json so the pin exists from
 * then on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDirs, readJson, writeJson } from './lib/config.ts';
import { stage, info, ok, warn, die } from './lib/log.ts';
import { downloadTo, sha256File } from './lib/geo.ts';

type GeomSource = {
  id: string;
  role: string;
  title: string;
  url: string;
  fallbackUrl?: string;
  bytes?: number;
  sha256: string | null;
  format: string;
  licence: string;
};

type SourcesFile = { sources: GeomSource[] };

const WANTED_ROLES = new Set(['geometry-primary', 'boundary-verification']);

function localName(src: GeomSource): string {
  return `${src.id}.${src.format === 'geojson' ? 'geojson' : src.format}`;
}

function human(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(0)} kB`;
}

async function fetchOne(src: GeomSource, sources: SourcesFile): Promise<void> {
  const dest = path.join(PATHS.raw, localName(src));

  if (fs.existsSync(dest)) {
    const digest = sha256File(dest);
    if (src.sha256 && digest === src.sha256) {
      ok(`${src.id}: cached, checksum matches (${human(fs.statSync(dest).size)})`);
      return;
    }
    if (src.sha256) {
      warn(`${src.id}: cached copy does not match the pin — re-downloading`);
      fs.rmSync(dest);
    } else {
      info(`${src.id}: cached, no pin recorded yet`);
      recordChecksum(src, sources, digest);
      return;
    }
  }

  info(`${src.id}: downloading ${src.url}`);
  try {
    await downloadTo(src.url, dest);
  } catch (err) {
    if (!src.fallbackUrl) {
      die(`${src.id}: download failed and no fallbackUrl is configured.\n${String(err)}`);
    }
    warn(`${src.id}: primary URL failed (${String(err)}) — trying fallback`);
    await downloadTo(src.fallbackUrl!, dest);
  }

  const size = fs.statSync(dest).size;
  const digest = sha256File(dest);

  if (src.sha256) {
    if (digest !== src.sha256) {
      die(
        `${src.id}: SHA-256 mismatch — the pinned source changed upstream.`,
        [
          `  expected ${src.sha256}`,
          `  actual   ${digest}`,
          '',
          'This invalidates the verified facts in docs/DATA.md (feature counts, known gaps,',
          'areas). Re-run the verification, update docs/DATA.md and sources.json together,',
          'and only then update the pin. Do not simply overwrite the checksum.',
        ].join('\n'),
      );
    }
    ok(`${src.id}: ${human(size)}, checksum verified`);
  } else {
    recordChecksum(src, sources, digest);
    ok(`${src.id}: ${human(size)}, checksum recorded (${digest.slice(0, 16)}…)`);
  }

  if (src.bytes && Math.abs(size - src.bytes) > src.bytes * 0.02) {
    warn(`${src.id}: size ${size} differs from catalogued ${src.bytes} by more than 2%`);
  }
}

function recordChecksum(src: GeomSource, sources: SourcesFile, digest: string): void {
  const entry = sources.sources.find((s) => s.id === src.id);
  if (!entry) return;
  entry.sha256 = digest;
  writeJson(PATHS.sources, sources);
  info(`${src.id}: pinned sha256 in sources.json`);
}

async function main(): Promise<void> {
  stage('02', 'fetch geometry (pinned + checksum-verified)');
  ensureDirs();

  const sources = readJson<SourcesFile>(PATHS.sources);
  const targets = sources.sources.filter((s) => WANTED_ROLES.has(s.role));
  if (targets.length === 0) die('No geometry sources found in sources.json.');

  for (const src of targets) {
    await fetchOne(src, sources);
  }

  ok(`${targets.length} geometry sources present in ${path.relative(process.cwd(), PATHS.raw)}`);
}

main().catch((err) => die(String(err?.stack ?? err)));
