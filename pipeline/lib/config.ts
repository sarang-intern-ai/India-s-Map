import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const VINTAGE = 'lgd-2024';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PIPELINE_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(PIPELINE_DIR, '..');

export const PATHS = {
  sources: path.join(PIPELINE_DIR, 'sources.json'),
  fixes: path.join(PIPELINE_DIR, 'fixes', 'geometry-fixes.json'),
  deltas: path.join(PIPELINE_DIR, 'fixes', 'known-admin-deltas.json'),
  raw: path.join(PIPELINE_DIR, 'raw'),
  build: path.join(PIPELINE_DIR, 'build'),
  reports: path.join(PIPELINE_DIR, 'reports'),
  out: path.join(REPO_ROOT, 'public', 'data', VINTAGE),
};

/**
 * The only four files the frontend is allowed to consume. Stage 05 asserts that the
 * output directory contains exactly this set — nothing stray, nothing missing.
 */
export const OUTPUT_FILES = [
  'manifest.json',
  'states.topo.json',
  'districts.topo.json',
  'hierarchy.json',
];

export function ensureDirs(): void {
  for (const dir of [PATHS.raw, PATHS.build, PATHS.reports, PATHS.out]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown, pretty = true): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 2 : 0) + '\n', 'utf8');
}

/**
 * Loads pipeline/.env if present. Absence is not an error here — stage 01 is responsible
 * for reporting a missing key with actionable instructions.
 */
export function loadEnv(): void {
  const envFile = path.join(PIPELINE_DIR, '.env');
  if (!fs.existsSync(envFile)) return;
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Older Node, or a malformed file. Stage 01 surfaces the consequence.
  }
}
