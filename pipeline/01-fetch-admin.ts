/**
 * Stage 01 — fetch the LGD district roster from the OGD (data.gov.in) API.
 *
 * This is the ONLY stage that talks to an authenticated API, and the only consumer of the
 * project's single secret. It never scrapes lgdirectory.gov.in and never touches a CAPTCHA:
 * the citizen view there requires OWASP_CSRFTOKEN + captchaAnswer, so the official API is
 * the supported route to the same data.
 *
 * Without an API key this stage FAILS LOUDLY. It does not fall back to hand-written data,
 * and it does not let later stages pretend a roster exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDirs, loadEnv, readJson, writeJson } from './lib/config.ts';
import { stage, info, ok, warn, die, table } from './lib/log.ts';
import { sha256String } from './lib/geo.ts';
import { STATE_DISPLAY_NAMES } from './lib/state-names.ts';
import { AdminRoster, type AdminDistrictRecordT } from './lib/schema.ts';

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

type SourcesFile = {
  sources: {
    id: string;
    role: string;
    url: string;
    resourceId?: string;
    licence?: string;
    auth?: { required: boolean; envVar: string; register: string };
    request?: Record<string, string | number>;
  }[];
};

/**
 * The exact field names of this resource are unverified — the schema could not be
 * inspected without a key. Rather than guess a single name and mis-map silently, we accept
 * a set of documented candidates and fail with the real field list if none match.
 */
const FIELD_CANDIDATES = {
  districtCode: ['district_code', 'districtCode', 'dist_code', 'district_lgd_code', 'districtcode'],
  districtName: ['district_name', 'districtName', 'dist_name', 'districtname'],
  stateCode: ['state_code', 'stateCode', 'state_lgd_code', 'statecode'],
  stateName: ['state_name', 'stateName', 'statename'],
};

function pick(row: Record<string, unknown>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== '') {
      return String(row[c]).trim();
    }
  }
  return null;
}

async function main(): Promise<void> {
  stage('01', 'fetch administrative roster (OGD / data.gov.in)');
  ensureDirs();
  loadEnv();

  const sources = readJson<SourcesFile>(PATHS.sources);
  const entry = sources.sources.find((s) => s.role === 'administrative-roster');
  if (!entry) die('No source with role "administrative-roster" in sources.json.');

  const envVar = entry.auth?.envVar ?? 'DATA_GOV_IN_API_KEY';
  const apiKey = process.env[envVar];

  if (!apiKey) {
    die(
      `${envVar} is not set — cannot fetch the LGD administrative roster.`,
      [
        'The administrative roster requires a free data.gov.in API key.',
        '',
        'To configure it:',
        '  1. Register at https://www.data.gov.in/ and copy your API key from your profile.',
        `  2. cp pipeline/.env.example pipeline/.env`,
        `  3. Set ${envVar}=<your key> in pipeline/.env  (the file is gitignored)`,
        '  4. Re-run:  npm run fetch:admin',
        '',
        `Resource: ${entry.resourceId}`,
        `Endpoint: ${entry.url}`,
        '',
        'The pipeline will NOT invent administrative data. Stages 02-05 can still run',
        'without this (npm run all:geometry-only); they will produce a dataset marked',
        'mode="partial" with every district status="unreconciled".',
      ].join('\n'),
    );
  }

  info(`resource ${entry.resourceId}`);
  info(`endpoint ${entry.url}`);
  info(`key      from $${envVar} (${apiKey.length} chars, not logged)`);

  const records: Record<string, unknown>[] = [];
  let total = 0;
  let fields: unknown = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(entry.url);
    url.searchParams.set('api-key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(page * PAGE_SIZE));

    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      die(
        `OGD API returned HTTP ${res.status} ${res.statusText}.`,
        res.status === 401 || res.status === 403
          ? `The API key in $${envVar} was rejected. Check it at https://www.data.gov.in/.`
          : res.status === 429
            ? 'Rate limited. Wait and retry — do not switch to a shared/demo key.'
            : 'Retry later. If this persists the resource id may have changed.',
      );
    }

    const body = (await res.json()) as Record<string, unknown>;
    if (body.error) die(`OGD API error: ${JSON.stringify(body.error)}`);

    const batch = (body.records as Record<string, unknown>[]) ?? [];
    if (page === 0) {
      total = Number(body.total ?? 0);
      fields = body.field ?? null;
      info(`API reports total = ${total}`);
    }
    records.push(...batch);
    info(`page ${page + 1}: +${batch.length} (${records.length}/${total || '?'})`);
    if (batch.length < PAGE_SIZE || (total && records.length >= total)) break;
  }

  if (records.length === 0) {
    die('OGD API returned zero records — refusing to write an empty roster.');
  }

  // Map to canonical shape. Fail loudly if the schema is not what we expect.
  const sample = records[0];
  const resolved = {
    districtCode: FIELD_CANDIDATES.districtCode.find((c) => c in sample),
    districtName: FIELD_CANDIDATES.districtName.find((c) => c in sample),
    stateCode: FIELD_CANDIDATES.stateCode.find((c) => c in sample),
    stateName: FIELD_CANDIDATES.stateName.find((c) => c in sample),
  };

  if (!resolved.districtCode || !resolved.stateCode) {
    die(
      'Could not locate LGD code fields in the OGD response.',
      [
        'Names are never used as join keys, so a district code and a state code are required.',
        '',
        `Fields actually returned: ${Object.keys(sample).join(', ')}`,
        `API field metadata: ${JSON.stringify(fields)}`,
        '',
        'Add the correct field names to FIELD_CANDIDATES in pipeline/01-fetch-admin.ts.',
      ].join('\n'),
    );
  }

  info(`field mapping: district=${resolved.districtCode}, state=${resolved.stateCode}`);

  const normalised: AdminDistrictRecordT[] = [];
  const skipped: string[] = [];
  for (const row of records) {
    const districtId = pick(row, [resolved.districtCode]);
    const stateId = pick(row, [resolved.stateCode]);
    if (!districtId || !stateId) {
      skipped.push(JSON.stringify(row).slice(0, 120));
      continue;
    }
    const districtName = resolved.districtName ? pick(row, [resolved.districtName]) : null;
    const sourceStateName = resolved.stateName ? pick(row, [resolved.stateName]) : null;
    normalised.push({
      districtId: String(Number(districtId) || districtId),
      districtName: districtName ?? `LGD ${districtId}`,
      stateId: String(Number(stateId) || stateId),
      stateName: STATE_DISPLAY_NAMES[String(Number(stateId))] ?? sourceStateName ?? `LGD ${stateId}`,
    });
  }

  if (skipped.length) {
    warn(`${skipped.length} rows lacked usable LGD codes and were skipped (not invented)`);
  }

  const roster = {
    fetchedAt: new Date().toISOString(),
    resourceId: entry.resourceId!,
    endpoint: entry.url,
    licence: entry.licence ?? 'GODL-India',
    total: normalised.length,
    records: normalised,
  };
  AdminRoster.parse(roster);

  const outFile = path.join(PATHS.raw, 'ogd-lgd-districts.json');
  writeJson(outFile, roster);

  const byState = new Map<string, number>();
  for (const r of normalised) byState.set(r.stateId, (byState.get(r.stateId) ?? 0) + 1);

  ok(`${normalised.length} districts across ${byState.size} states/UTs`);
  ok(`wrote ${path.relative(PATHS.raw, outFile)} (sha256 ${sha256String(JSON.stringify(roster)).slice(0, 12)}…)`);
  table([
    ['stateId', 'state', 'districts'],
    ...[...byState.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, n]) => [id, STATE_DISPLAY_NAMES[id] ?? '?', String(n)]),
  ]);

  fs.writeFileSync(
    path.join(PATHS.build, 'admin-roster.flag'),
    `fetched ${roster.fetchedAt}\n`,
    'utf8',
  );
}

main().catch((err) => die(String(err?.stack ?? err)));
