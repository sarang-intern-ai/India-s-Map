/**
 * Stage 05 — topology-preserving simplification, publication, and validation.
 *
 * Writes the ONLY four files the frontend consumes, into public/data/<vintage>/, then runs
 * every critical invariant. The build fails rather than publishing a dataset that violates
 * one. Never loosen an invariant to make this pass — fix the data or the declarative
 * exception list.
 *
 * `mapshaper -clean` is deliberately NOT used: it silently deletes Sanchor.
 */
import fs from 'node:fs';
import path from 'node:path';
import topojsonClient from 'topojson-client';
import { PATHS, VINTAGE, OUTPUT_FILES, ensureDirs, readJson, writeJson } from './lib/config.ts';
import { stage, info, ok, warn, bad, die, table, failureCount } from './lib/log.ts';
import {
  runMapshaper, sha256File, EQUAL_AREA_PROJ, polygonsOf, bboxOfPolys, mergeBbox,
  representativePoint, findOverlaps, type OverlapShape, type GeoFeature,
} from './lib/geo.ts';
import { Hierarchy, Manifest, type HierarchyT } from './lib/schema.ts';

const SIMPLIFY = '4%';
const MAX_DISTRICTS_BYTES = 4_000_000; // order-of-magnitude guard, not a target
const OFFICIAL_INDIA_AREA_KM2 = 3_287_263;
const UNION_TOLERANCE_PCT = 2;

type Fixes = {
  exclude: { districtId: string; reason: string }[];
  knownOverlaps: { id: string; parentDistrictId: string; childDistrictId: string; reason: string }[];
  expectations: { sourceFeatureCount: number; publishedFeatureCount: number; maxOverlapKm2: number };
};

type GeomStats = {
  featureCount: number; excluded: string[]; uniqueDistrictIds: number; stateCount: number;
  stateFeatureCount: number; sumOfPartsKm2: number; dissolvedUnionKm2: number; overlapKm2: number;
};

type Deltas = {
  dissolvedButPresentInGeometry: { districts: { districtId: string; gazetteName: string }[]; source: string; effectiveDate: string };
  createdButAbsentFromGeometry: { districts: { name: string }[]; source: string; notifiedDate: string; state: string };
};

async function main(): Promise<void> {
  stage('05', 'simplify → TopoJSON, publish, validate');
  ensureDirs();

  const normalisedGeo = path.join(PATHS.build, 'districts.normalized.geojson');
  const statsFile = path.join(PATHS.build, 'geometry-stats.json');
  const hierarchyBuild = path.join(PATHS.build, 'hierarchy.json');
  for (const f of [normalisedGeo, statsFile, hierarchyBuild]) {
    if (!fs.existsSync(f)) die(`Missing ${path.basename(f)}.`, 'Run:  npm run normalize && npm run join');
  }

  const stats = readJson<GeomStats>(statsFile);
  const fixes = readJson<Fixes>(PATHS.fixes);
  const deltas = fs.existsSync(PATHS.deltas) ? readJson<Deltas>(PATHS.deltas) : null;
  const hierarchy = Hierarchy.parse(readJson<HierarchyT>(hierarchyBuild));
  const sources = readJson<{ sources: Record<string, unknown>[] }>(PATHS.sources);

  // ---- districts → TopoJSON --------------------------------------------------------------
  const districtsOut = path.join(PATHS.out, 'districts.topo.json');
  // -rename-layers keeps the published object name stable ("districts"), so the frontend
  // contract never depends on an internal build filename.
  await runMapshaper(
    `-i "${normalisedGeo}" -simplify ${SIMPLIFY} keep-shapes -rename-layers districts ` +
      `-o "${districtsOut}" format=topojson id-field=districtId`,
  );
  const dBytes = fs.statSync(districtsOut).size;
  ok(`districts.topo.json  ${(dBytes / 1e6).toFixed(2)} MB  (simplify ${SIMPLIFY}, keep-shapes)`);

  // ---- states → TopoJSON -------------------------------------------------------------------
  const statesOut = path.join(PATHS.out, 'states.topo.json');
  const statesNormalised = path.join(PATHS.build, 'states.normalized.geojson');
  if (fs.existsSync(statesNormalised)) {
    await runMapshaper(
      `-i "${statesNormalised}" -simplify ${SIMPLIFY} keep-shapes -rename-layers states ` +
        `-o "${statesOut}" format=topojson id-field=stateId`,
    );
    info('states built from the LGD states layer');
  } else {
    // Dissolving districts keeps the national outline identical to the district mosaic,
    // which is what makes it India-correct by construction (docs/DECISIONS.md D-004).
    await runMapshaper(
      `-i "${normalisedGeo}" -dissolve stateId copy-fields=stateName,sourceStateName ` +
        `-simplify ${SIMPLIFY} keep-shapes -rename-layers states ` +
        `-o "${statesOut}" format=topojson id-field=stateId`,
    );
    info('states derived by dissolving districts on stateId');
  }
  ok(`states.topo.json     ${(fs.statSync(statesOut).size / 1e3).toFixed(0)} kB`);

  // ---- hierarchy ----------------------------------------------------------------------------
  writeJson(path.join(PATHS.out, 'hierarchy.json'), hierarchy);
  ok(`hierarchy.json       ${(fs.statSync(path.join(PATHS.out, 'hierarchy.json')).size / 1e3).toFixed(0)} kB`);

  // ================= VALIDATION =================
  console.log('');
  info('validating…');

  // 1 · TopoJSON round-trips
  const districtTopo = readJson<Record<string, unknown>>(districtsOut);
  let districtFeatures: GeoFeature[] = [];
  try {
    const objectNames = Object.keys(districtTopo.objects as object);
    if (objectNames.length !== 1 || objectNames[0] !== 'districts') {
      bad(`[7] districts TopoJSON object must be exactly ["districts"], got ${JSON.stringify(objectNames)}`);
    }
    const fc = topojsonClient.feature(districtTopo as never, (districtTopo.objects as never).districts);
    districtFeatures = (fc as unknown as { features: GeoFeature[] }).features;
    ok(`[7] districts TopoJSON decodes: ${districtFeatures.length} features via topojson-client`);
  } catch (err) {
    die(`[7] districts TopoJSON failed to decode: ${String(err)}`);
  }

  const statesTopo = readJson<Record<string, unknown>>(statesOut);
  try {
    const objectNames = Object.keys(statesTopo.objects as object);
    if (objectNames.length !== 1 || objectNames[0] !== 'states') {
      bad(`[7] states TopoJSON object must be exactly ["states"], got ${JSON.stringify(objectNames)}`);
    }
    const fc = topojsonClient.feature(statesTopo as never, (statesTopo.objects as never).states);
    ok(`[7] states TopoJSON decodes: ${(fc as unknown as { features: unknown[] }).features.length} features`);
  } catch (err) {
    bad(`[7] states TopoJSON failed to decode: ${String(err)}`);
  }

  // 3 · nothing silently dropped
  const expected = fixes.expectations.publishedFeatureCount - fixes.exclude.length;
  if (districtFeatures.length !== expected) {
    bad(`[3] feature count ${districtFeatures.length}, expected ${expected} — features were dropped silently`);
  } else {
    ok(`[3] feature count preserved: ${districtFeatures.length} (source ${stats.featureCount}, excluded ${fixes.exclude.length})`);
  }

  // 8 · exclusions are documented
  if (stats.excluded.length !== fixes.exclude.length) {
    bad(`[8] ${stats.excluded.length} features excluded but ${fixes.exclude.length} documented in geometry-fixes.json`);
  } else if (fixes.exclude.length === 0) {
    ok('[8] no feature exclusions — all source geometry preserved');
  } else {
    ok(`[8] ${fixes.exclude.length} exclusion(s), each documented`);
  }

  // 2 · every geometry has an identifier
  const missingId = districtFeatures.filter(
    (f) => !f.properties?.districtId || String(f.properties.districtId).trim() === '',
  );
  if (missingId.length) bad(`[2] ${missingId.length} features have no districtId`);
  else ok(`[2] every feature carries a districtId`);

  // 1 · identifiers unique
  const ids = districtFeatures.map((f) => String(f.properties.districtId));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) bad(`[1] duplicate districtIds in output: ${[...new Set(dupes)].join(', ')}`);
  else ok(`[1] ${new Set(ids).size} districtIds, all unique`);

  // 5 · state consistency between hierarchy and geometry
  const hierById = new Map<string, string>();
  for (const s of hierarchy.states) for (const d of s.districts) hierById.set(d.districtId, d.stateId);
  const stateInconsistent = districtFeatures.filter((f) => {
    const id = String(f.properties.districtId);
    return hierById.has(id) && hierById.get(id) !== String(f.properties.stateId);
  });
  if (stateInconsistent.length) bad(`[5] ${stateInconsistent.length} features disagree with hierarchy.json on stateId`);
  else ok('[5] state assignment consistent between geometry and hierarchy');

  const geomStateIds = new Set(districtFeatures.map((f) => String(f.properties.stateId)));
  if (geomStateIds.size !== 36) bad(`[5] expected 36 states/UTs, found ${geomStateIds.size}`);
  else ok('[5] 36 distinct states/UTs');

  // 4 · no fabricated geometry — every published shape traces to a source feature
  const sourceIds = new Set(
    readJson<{ districtId: string }[]>(path.join(PATHS.build, 'district-attributes.json'))
      .map((a) => a.districtId),
  );
  const fabricated = ids.filter((id) => !sourceIds.has(id));
  if (fabricated.length) bad(`[4] ${fabricated.length} published geometries have no source feature: ${fabricated.slice(0, 5).join(', ')}`);
  else ok('[4] no fabricated geometry — every shape traces to a source feature');

  const noBoundary = hierarchy.states.flatMap((s) => s.districts).filter((d) => !d.hasGeometry);
  if (noBoundary.length) {
    ok(`[4] ${noBoundary.length} district(s) carry status="no_boundary_published" with no invented shape`);
  }

  // bbox — India-correct extent (docs/DATA.md §3)
  let bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const shapes: OverlapShape[] = [];
  for (const f of districtFeatures) {
    const polys = polygonsOf(f.geometry);
    if (polys.length === 0) continue;
    const bb = bboxOfPolys(polys);
    bbox = mergeBbox(bbox, bb);
    shapes.push({
      id: String(f.properties.districtId),
      name: String(f.properties.districtName ?? ''),
      stateId: String(f.properties.stateId),
      polys, bbox: bb, point: representativePoint(polys),
    });
  }
  const north = bbox[3], east = bbox[2];
  if (north < 36.5) bad(`[6] northern extent ${north.toFixed(3)}°N — below the full J&K claim (expect ≈37.08)`);
  else ok(`[6] northern extent ${north.toFixed(3)}°N — full J&K claim present`);
  if (east < 97.0) bad(`[6] eastern extent ${east.toFixed(3)}°E — below full Arunachal (expect ≈97.41)`);
  else ok(`[6] eastern extent ${east.toFixed(3)}°E — full Arunachal Pradesh present`);
  info(`bbox lon ${bbox[0].toFixed(3)}..${bbox[2].toFixed(3)}  lat ${bbox[1].toFixed(3)}..${bbox[3].toFixed(3)}`);

  // overlaps — only the documented pairs are tolerated
  const documented = new Set(
    fixes.knownOverlaps.flatMap((o) => [
      `${o.parentDistrictId}|${o.childDistrictId}`, `${o.childDistrictId}|${o.parentDistrictId}`,
    ]),
  );
  const overlaps = findOverlaps(shapes);
  const undocumented = overlaps.filter((p) => !documented.has(`${p.a.id}|${p.b.id}`));
  if (undocumented.length) {
    for (const p of undocumented.slice(0, 10)) {
      bad(`[8] undocumented overlap: ${p.a.name} (${p.a.id}) inside ${p.b.name} (${p.b.id})`);
    }
    bad(`[8] ${undocumented.length} undocumented overlapping pair(s) — add to geometry-fixes.json or fix the data`);
  } else {
    ok(`[8] ${overlaps.length} overlapping pair(s), all documented in geometry-fixes.json`);
  }

  if (stats.overlapKm2 > fixes.expectations.maxOverlapKm2) {
    bad(`[8] overlap ${Math.round(stats.overlapKm2)} km² exceeds ceiling ${fixes.expectations.maxOverlapKm2} km²`);
  } else {
    ok(`[8] overlap ${Math.round(stats.overlapKm2).toLocaleString('en-IN')} km² within ceiling`);
  }

  // union area sanity
  const deltaPct = ((stats.dissolvedUnionKm2 - OFFICIAL_INDIA_AREA_KM2) / OFFICIAL_INDIA_AREA_KM2) * 100;
  if (Math.abs(deltaPct) > UNION_TOLERANCE_PCT) {
    bad(`[6] union area ${deltaPct.toFixed(2)}% from official — outside ±${UNION_TOLERANCE_PCT}%`);
  } else {
    ok(`[6] union area within ${deltaPct.toFixed(2)}% of official 3,287,263 km²`);
  }

  // size guard
  if (dBytes > MAX_DISTRICTS_BYTES) {
    bad(`[6] districts.topo.json is ${(dBytes / 1e6).toFixed(1)} MB — above the ${MAX_DISTRICTS_BYTES / 1e6} MB guard`);
  } else {
    ok(`[6] districts.topo.json ${(dBytes / 1e6).toFixed(2)} MB — within order of magnitude`);
  }

  // ---- manifest ------------------------------------------------------------------------------
  const outputs: Record<string, { bytes: number; sha256: string }> = {};
  for (const f of OUTPUT_FILES.filter((x) => x !== 'manifest.json')) {
    const p = path.join(PATHS.out, f);
    outputs[f] = { bytes: fs.statSync(p).size, sha256: sha256File(p) };
  }

  const manifest = {
    vintage: VINTAGE,
    generatedAt: new Date().toISOString(),
    generator: 'pipeline/05-simplify.ts',
    reconciliation: hierarchy.reconciliation,
    counts: {
      districtFeatures: districtFeatures.length,
      // Derived from the data, never hardcoded — a reorganisation must move these numbers.
      states: hierarchy.states.filter((s) => !s.isUnionTerritory).length,
      unionTerritories: hierarchy.states.filter((s) => s.isUnionTerritory).length,
      unadministeredDistricts: districtFeatures.filter((f) => f.properties.administered === false).length,
      districtsWithoutGeometry: noBoundary.length,
    },
    geometry: {
      crs: 'EPSG:4326' as const,
      equalAreaProjection: EQUAL_AREA_PROJ,
      sumOfPartsKm2: Math.round(stats.sumOfPartsKm2),
      dissolvedUnionKm2: Math.round(stats.dissolvedUnionKm2),
      overlapKm2: Math.round(stats.overlapKm2),
      officialIndiaAreaKm2: OFFICIAL_INDIA_AREA_KM2,
      unionDeltaPct: Number(deltaPct.toFixed(3)),
      bbox: bbox.map((v) => Number(v.toFixed(4))),
    },
    sources: sources.sources
      .filter((s) => s.role !== undefined)
      .map((s) => ({
        id: String(s.id),
        title: String(s.title ?? s.id),
        url: String(s.url),
        licence: String(s.licence ?? 'unspecified'),
        sha256: (s.sha256 as string | null) ?? null,
        bytes: (s.bytes as number | undefined) ?? null,
        attribution: (s.attribution as Record<string, unknown>) ?? undefined,
      })),
    licences: [...new Set(sources.sources.map((s) => String(s.licence ?? '')).filter(Boolean))],
    knownGaps: deltas
      ? [
          {
            id: 'rajasthan-dissolved-9',
            summary: `${deltas.dissolvedButPresentInGeometry.districts.length} dissolved Rajasthan districts still present in geometry`,
            detail: `Dissolved ${deltas.dissolvedButPresentInGeometry.effectiveDate}; state reduced to 41 districts. Present here because the geometry vintage predates the change.`,
            source: deltas.dissolvedButPresentInGeometry.source,
          },
          {
            id: 'ladakh-missing-5',
            summary: `${deltas.createdButAbsentFromGeometry.districts.length} Ladakh districts have no published boundary`,
            detail: `${deltas.createdButAbsentFromGeometry.districts.map((d) => d.name).join(', ')}. Notified ${deltas.createdButAbsentFromGeometry.notifiedDate}. No open dataset carries these polygons; none is fabricated.`,
            source: deltas.createdButAbsentFromGeometry.source,
          },
          ...(hierarchy.reconciliation.rosterAvailable
            ? []
            : [{
                id: 'roster-not-fetched',
                summary: 'Administrative roster not fetched — every district status is "unreconciled"',
                detail: 'DATA_GOV_IN_API_KEY is not configured, so OGD resource 37231365-78ba-44d5-ac22-3deec40b9197 was not queried. No administrative data was invented.',
                source: 'https://www.data.gov.in/',
              }]),
        ]
      : [],
    knownGeometryIssues: [
      ...fixes.knownOverlaps.map((o) => ({
        id: o.id,
        summary: `${o.childDistrictId} overlaps ${o.parentDistrictId}`,
        detail: o.reason,
      })),
      {
        id: 'heterogeneous-vintage',
        summary: '79% of district geometry is Census 2011 delineation',
        detail: 'The layer is a Census 2011 base incrementally updated to roughly a 2023-24 LGD snapshot. It is not a single clean vintage.',
      },
      {
        id: 'shape-area-unusable',
        summary: 'Source SHAPE_Area is 20.8% inflated and was discarded',
        detail: 'Areas are recomputed in an Albers equal-area projection. See docs/DECISIONS.md D-010.',
      },
    ],
    outputs,
  };
  Manifest.parse(manifest);
  writeJson(path.join(PATHS.out, 'manifest.json'), manifest);
  ok(`[10] manifest.json written with source checksums and output digests`);

  // 9 · output directory contains exactly the intended files
  const actual = fs.readdirSync(PATHS.out).sort();
  const wanted = [...OUTPUT_FILES].sort();
  const stray = actual.filter((f) => !wanted.includes(f));
  const absent = wanted.filter((f) => !actual.includes(f));
  if (stray.length) bad(`[9] stray files in public/data/${VINTAGE}: ${stray.join(', ')}`);
  if (absent.length) bad(`[9] missing output files: ${absent.join(', ')}`);
  if (!stray.length && !absent.length) ok(`[9] output directory contains exactly ${wanted.length} intended files`);

  console.log('');
  table([
    ['file', 'size'],
    ...actual.map((f) => [f, `${(fs.statSync(path.join(PATHS.out, f)).size / 1e3).toFixed(1)} kB`]),
  ]);

  if (failureCount() > 0) {
    die(
      `${failureCount()} validation failure(s).`,
      'Fix the data or the declarative exception list in pipeline/fixes/. Never loosen an invariant.',
    );
  }
  console.log('');
  ok(`stage 05 complete — public/data/${VINTAGE}/ published and validated`);
  if (!hierarchy.reconciliation.rosterAvailable) {
    warn('dataset is mode="partial": all district statuses are "unreconciled" pending the OGD roster');
  }
}

main().catch((err) => die(String(err?.stack ?? err)));
