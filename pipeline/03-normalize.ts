/**
 * Stage 03 — normalise geometry and administrative data around LGD codes.
 *
 * Produces canonical district records: { districtId, districtName, stateId, stateName,
 * geometry, sourceVintage, ... }. Geometry stays on disk the whole way: properties are
 * streamed in JS (cheap), the canonical attribute table is written out, and mapshaper joins
 * it back onto the shapes. That keeps 93 MB of coordinates out of the JS heap and keeps the
 * identifier logic in exactly one place (lib/ids.ts).
 *
 * SHAPE_Area and SHAPE_Length are discarded here — they are 20.8% inflated projected
 * artifacts (docs/DECISIONS.md D-010). Areas are recomputed in an equal-area projection.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDirs, readJson, writeJson } from './lib/config.ts';
import { stage, info, ok, warn, bad, die, table, failureCount } from './lib/log.ts';
import {
  streamFeatures, runMapshaper, computeAreasKm2, computeUnionAreaKm2, EQUAL_AREA_PROJ, prop,
} from './lib/geo.ts';
import { toDistrictId, toStateId, isUnadministered } from './lib/ids.ts';
import { STATE_DISPLAY_NAMES, UNION_TERRITORY_IDS, districtDisplayName } from './lib/state-names.ts';

const RAW_DISTRICTS = path.join(PATHS.raw, 'lgd_districts.geojson');
const RAW_STATES = path.join(PATHS.raw, 'lgd_states.geojson');

type FixesFile = {
  exclude?: { districtId: string; name: string; reason: string; source: string }[];
  knownOverlaps?: { parentDistrictId: string; childDistrictId: string }[];
};

type Attr = {
  OBJECTID: number;
  districtId: string;
  districtName: string;
  stateId: string;
  stateName: string;
  sourceVintage: string | null;
  sourceDistrictName: string;
  sourceStateName: string;
  censusDistrictCode: string | null;
  censusStateCode: string | null;
  administered: boolean;
};

function nullIfBlank(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

async function main(): Promise<void> {
  stage('03', 'normalise around LGD codes');
  ensureDirs();

  if (!fs.existsSync(RAW_DISTRICTS)) {
    die(`Missing ${RAW_DISTRICTS}.`, 'Run stage 02 first:  npm run fetch:geometry');
  }

  const fixes = fs.existsSync(PATHS.fixes) ? readJson<FixesFile>(PATHS.fixes) : {};
  const excluded = new Map((fixes.exclude ?? []).map((e) => [e.districtId, e]));
  if (excluded.size === 0) {
    info('geometry-fixes.json declares no exclusions — all source features are preserved');
  }

  // ---- pass 1: stream properties only -------------------------------------------------
  const attrs: Attr[] = [];
  const objectIds = new Set<number>();
  let featureCount = 0;
  let nullGeometry = 0;

  for await (const f of streamFeatures(RAW_DISTRICTS)) {
    featureCount += 1;
    const p = f.properties;
    if (!f.geometry) nullGeometry += 1;

    const objectId = Number(prop(p, 'OBJECTID'));
    if (objectIds.has(objectId)) {
      die(`OBJECTID ${objectId} is not unique — cannot use it as a join handle.`);
    }
    objectIds.add(objectId);

    const censusDistrictCode = nullIfBlank(prop(p, 'dtcode11'));
    const districtId = toDistrictId(Number(prop(p, 'dist_lgd')), censusDistrictCode ?? '');
    const stateId = toStateId(Number(prop(p, 'state_lgd')));
    const sourceStateName = String(prop(p, 'stname') ?? '').trim();

    const stateName = STATE_DISPLAY_NAMES[stateId];
    if (!stateName) {
      die(
        `No display name mapped for stateId ${stateId} ("${sourceStateName}").`,
        'Add it to pipeline/lib/state-names.ts. The table must cover every code in the data.',
      );
    }

    attrs.push({
      OBJECTID: objectId,
      districtId,
      districtName: districtDisplayName(String(p.dtname ?? '')),
      stateId,
      stateName,
      sourceVintage: nullIfBlank(prop(p, 'year_stat')),
      sourceDistrictName: String(prop(p, 'dtname') ?? ''),
      sourceStateName,
      censusDistrictCode,
      censusStateCode: nullIfBlank(prop(p, 'stcode11')),
      administered: !isUnadministered(districtId),
    });
  }

  if (featureCount === 0) {
    die(
      'Read 0 features from the district layer.',
      'The upstream file layout may have changed (it is expected to be one Feature per line).',
    );
  }
  ok(`streamed ${featureCount} features`);
  if (nullGeometry) bad(`${nullGeometry} features have null geometry`);

  // ---- identifier integrity -----------------------------------------------------------
  const byId = new Map<string, Attr[]>();
  for (const a of attrs) {
    const list = byId.get(a.districtId) ?? [];
    list.push(a);
    byId.set(a.districtId, list);
  }
  const duplicates = [...byId.entries()].filter(([, v]) => v.length > 1);
  if (duplicates.length) {
    for (const [id, list] of duplicates) {
      bad(`duplicate districtId ${id}: ${list.map((a) => a.districtName).join(', ')}`);
    }
    die(`${duplicates.length} duplicate district identifiers. Names are never a fallback key.`);
  }
  ok(`${byId.size} unique districtIds, no duplicates`);

  const unadministered = attrs.filter((a) => !a.administered);
  info(
    `${unadministered.length} unadministered districts preserved with fallback ids: ` +
      unadministered.map((a) => `${a.districtName}=${a.districtId}`).join(', '),
  );

  const stateIds = new Set(attrs.map((a) => a.stateId));
  ok(`${stateIds.size} distinct stateIds`);

  const unmapped = [...stateIds].filter((s) => !(s in STATE_DISPLAY_NAMES));
  if (unmapped.length) die(`Unmapped stateIds: ${unmapped.join(', ')}`);

  // ---- write the attribute table, then join it onto the shapes ------------------------
  const attrFile = path.join(PATHS.build, 'district-attributes.json');
  writeJson(attrFile, attrs, false);

  const keepFields = [
    'districtId', 'districtName', 'stateId', 'stateName', 'sourceVintage',
    'sourceDistrictName', 'sourceStateName', 'censusDistrictCode', 'censusStateCode',
    'administered',
  ].join(',');

  const normalisedGeo = path.join(PATHS.build, 'districts.normalized.geojson');
  const excludeIds = [...excluded.keys()];
  const excludeExpr = excludeIds.length
    ? ` -filter '![${excludeIds.map((id) => `"${id}"`).join(',')}].includes(districtId)'`
    : '';

  await runMapshaper(
    `-i "${RAW_DISTRICTS}" -join "${attrFile}" keys=OBJECTID,OBJECTID ` +
      `-filter-fields ${keepFields}${excludeExpr} ` +
      `-o "${normalisedGeo}" format=geojson`,
  );
  ok(`joined canonical attributes onto geometry → ${path.basename(normalisedGeo)}`);
  if (excludeIds.length) {
    warn(`excluded ${excludeIds.length} feature(s) per geometry-fixes.json: ${excludeIds.join(', ')}`);
  }

  // ---- areas, computed (never SHAPE_Area) ---------------------------------------------
  const areas = await computeAreasKm2(
    normalisedGeo, 'districtId', path.join(PATHS.build, 'district-areas.json'),
  );
  const sumOfParts = [...areas.values()].reduce((a, b) => a + b, 0);
  const union = await computeUnionAreaKm2(
    normalisedGeo, path.join(PATHS.build, 'district-union-area.json'),
  );
  const overlapKm2 = sumOfParts - union;

  ok(`sum of parts   ${Math.round(sumOfParts).toLocaleString('en-IN')} km²`);
  ok(`dissolved union ${Math.round(union).toLocaleString('en-IN')} km²`);
  const overlapPct = (overlapKm2 / sumOfParts) * 100;
  (overlapKm2 > 1 ? warn : ok)(
    `overlap ${Math.round(overlapKm2).toLocaleString('en-IN')} km² (${overlapPct.toFixed(2)}%)`,
  );

  // ---- states layer --------------------------------------------------------------------
  let stateFeatureCount = 0;
  const stateAttrs: { OBJECTID: number; stateId: string; stateName: string; sourceStateName: string }[] = [];
  if (fs.existsSync(RAW_STATES)) {
    // The states layer capitalises differently to the district layer (State_LGD, STNAME).
    for await (const f of streamFeatures(RAW_STATES)) {
      stateFeatureCount += 1;
      const p = f.properties;
      const stateLgd = Number(prop(p, 'state_lgd', 'stcode11'));
      const stateId = toStateId(stateLgd);
      const sourceStateName = String(prop(p, 'stname') ?? '').trim();
      if (!STATE_DISPLAY_NAMES[stateId]) {
        die(
          `States layer: no display name mapped for stateId ${stateId} ("${sourceStateName}").`,
          'Add it to pipeline/lib/state-names.ts.',
        );
      }
      stateAttrs.push({
        OBJECTID: Number(prop(p, 'OBJECTID') ?? stateFeatureCount),
        stateId,
        stateName: STATE_DISPLAY_NAMES[stateId],
        sourceStateName,
      });
    }
    const stateAttrFile = path.join(PATHS.build, 'state-attributes.json');
    writeJson(stateAttrFile, stateAttrs, false);
    await runMapshaper(
      `-i "${RAW_STATES}" -join "${stateAttrFile}" keys=OBJECTID,OBJECTID ` +
        `-filter-fields stateId,stateName,sourceStateName ` +
        `-o "${path.join(PATHS.build, 'states.normalized.geojson')}" format=geojson`,
    );
    ok(`states layer normalised: ${stateFeatureCount} features`);
  } else {
    warn('states layer not present — stage 05 will derive states by dissolving districts');
  }

  // ---- per-state summary ---------------------------------------------------------------
  const perState = new Map<string, number>();
  for (const a of attrs) perState.set(a.stateId, (perState.get(a.stateId) ?? 0) + 1);
  table([
    ['id', 'state', 'type', 'districts'],
    ...[...perState.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, n]) => [
        id, STATE_DISPLAY_NAMES[id], UNION_TERRITORY_IDS.has(id) ? 'UT' : 'State', String(n),
      ]),
  ]);

  writeJson(path.join(PATHS.build, 'geometry-stats.json'), {
    featureCount,
    excluded: excludeIds,
    uniqueDistrictIds: byId.size,
    unadministered: unadministered.map((a) => ({ districtId: a.districtId, name: a.districtName })),
    stateCount: stateIds.size,
    stateFeatureCount,
    equalAreaProjection: EQUAL_AREA_PROJ,
    sumOfPartsKm2: sumOfParts,
    dissolvedUnionKm2: union,
    overlapKm2,
    areas: Object.fromEntries(areas),
  });

  if (failureCount() > 0) die(`${failureCount()} integrity problem(s) in stage 03.`);
  ok('stage 03 complete');
}

main().catch((err) => die(String(err?.stack ?? err)));
