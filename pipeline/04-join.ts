/**
 * Stage 04 — join administrative data to geometry, ON LGD CODE ONLY.
 *
 * Names are never compared, matched or fuzzy-matched. The reconciliation is a pure set
 * operation over districtId. Output is an explicit coverage report naming every bucket.
 *
 * If the roster is absent (no API key), the run is PARTIAL: every district gets
 * status="unreconciled". We do not guess "active", because without the roster we genuinely
 * do not know which districts still exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, VINTAGE, ensureDirs, readJson, writeJson } from './lib/config.ts';
import { stage, info, ok, warn, bad, die, table, failureCount } from './lib/log.ts';
import { STATE_DISPLAY_NAMES, UNION_TERRITORY_IDS } from './lib/state-names.ts';
import { AdminRoster, type AdminRosterT, type DistrictRecordT, type DistrictStatusT } from './lib/schema.ts';

type Attr = {
  districtId: string; districtName: string; stateId: string; stateName: string;
  sourceVintage: string | null; sourceDistrictName: string; sourceStateName: string;
  censusDistrictCode: string | null; censusStateCode: string | null; administered: boolean;
};

type GeomStats = {
  featureCount: number; uniqueDistrictIds: number; stateCount: number;
  sumOfPartsKm2: number; dissolvedUnionKm2: number; overlapKm2: number;
  areas: Record<string, number>;
};

type Deltas = {
  dissolvedButPresentInGeometry: {
    state: string; effectiveDate: string; source: string;
    districts: { districtId: string; nameInLayer: string; gazetteName: string }[];
  };
  createdButAbsentFromGeometry: {
    state: string; notifiedDate: string; source: string;
    districts: { name: string; carvedFrom: string }[];
  };
};

const ROSTER_FILE = path.join(PATHS.raw, 'ogd-lgd-districts.json');

async function main(): Promise<void> {
  stage('04', 'join administrative ↔ geometry (by LGD code)');
  ensureDirs();

  const attrFile = path.join(PATHS.build, 'district-attributes.json');
  const statsFile = path.join(PATHS.build, 'geometry-stats.json');
  if (!fs.existsSync(attrFile) || !fs.existsSync(statsFile)) {
    die('Missing stage 03 output.', 'Run:  npm run normalize');
  }

  const attrs = readJson<Attr[]>(attrFile);
  const stats = readJson<GeomStats>(statsFile);
  const deltas = fs.existsSync(PATHS.deltas) ? readJson<Deltas>(PATHS.deltas) : null;

  // ---- roster ---------------------------------------------------------------------------
  let roster: AdminRosterT | null = null;
  if (fs.existsSync(ROSTER_FILE)) {
    roster = AdminRoster.parse(readJson(ROSTER_FILE));
    ok(`roster loaded: ${roster.total} districts, fetched ${roster.fetchedAt}`);
  } else {
    warn('no administrative roster present — reconciliation will be PARTIAL');
    info('every district will be status="unreconciled" (not guessed as active)');
  }
  const rosterAvailable = roster !== null;

  // ---- buckets, all keyed on districtId ---------------------------------------------------
  const geomById = new Map(attrs.map((a) => [a.districtId, a]));
  const rosterById = new Map((roster?.records ?? []).map((r) => [r.districtId, r]));

  const matched: string[] = [];
  const adminWithoutGeometry: string[] = [];
  const geometryWithoutAdmin: string[] = [];
  const stateMismatches: { districtId: string; geomState: string; rosterState: string }[] = [];

  if (rosterAvailable) {
    for (const id of rosterById.keys()) {
      if (geomById.has(id)) matched.push(id);
      else adminWithoutGeometry.push(id);
    }
    for (const id of geomById.keys()) {
      if (!rosterById.has(id)) geometryWithoutAdmin.push(id);
    }
    for (const id of matched) {
      const g = geomById.get(id)!;
      const r = rosterById.get(id)!;
      if (g.stateId !== r.stateId) {
        stateMismatches.push({ districtId: id, geomState: g.stateId, rosterState: r.stateId });
      }
    }
  }

  // ---- identifier hygiene (re-checked here; stage 03 already blocks duplicates) ----------
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const a of attrs) {
    if (seen.has(a.districtId)) duplicateIds.push(a.districtId);
    seen.add(a.districtId);
  }
  const unadministered = attrs.filter((a) => !a.administered);

  if (duplicateIds.length) bad(`duplicate districtIds: ${duplicateIds.join(', ')}`);
  for (const m of stateMismatches) {
    bad(`state mismatch for ${m.districtId}: geometry=${m.geomState} roster=${m.rosterState}`);
  }

  // ---- assign status ----------------------------------------------------------------------
  const records: DistrictRecordT[] = attrs.map((a) => {
    let status: DistrictStatusT = 'unreconciled';
    if (rosterAvailable) status = rosterById.has(a.districtId) ? 'active' : 'dissolved';
    return {
      districtId: a.districtId,
      districtName: a.districtName,
      stateId: a.stateId,
      stateName: a.stateName,
      sourceVintage: a.sourceVintage,
      sourceDistrictName: a.sourceDistrictName,
      sourceStateName: a.sourceStateName,
      censusDistrictCode: a.censusDistrictCode,
      censusStateCode: a.censusStateCode,
      areaKm2: stats.areas[a.districtId] ?? null,
      administered: a.administered,
      hasGeometry: true,
      status,
    };
  });

  // Roster districts with no polygon: emitted from the ROSTER only, never fabricated.
  for (const id of adminWithoutGeometry) {
    const r = rosterById.get(id)!;
    records.push({
      districtId: r.districtId,
      districtName: r.districtName,
      stateId: r.stateId,
      stateName: STATE_DISPLAY_NAMES[r.stateId] ?? r.stateName,
      sourceVintage: null,
      sourceDistrictName: r.districtName,
      sourceStateName: r.stateName,
      censusDistrictCode: null,
      censusStateCode: null,
      areaKm2: null,
      administered: true,
      hasGeometry: false,
      status: 'no_boundary_published',
    });
  }

  // ---- summary ----------------------------------------------------------------------------
  table([
    ['bucket', 'count'],
    ['geometry features', String(attrs.length)],
    ['roster districts', rosterAvailable ? String(rosterById.size) : '— (not fetched)'],
    ['matched', rosterAvailable ? String(matched.length) : '—'],
    ['admin without geometry', rosterAvailable ? String(adminWithoutGeometry.length) : '—'],
    ['geometry without admin', rosterAvailable ? String(geometryWithoutAdmin.length) : '—'],
    ['duplicate ids', String(duplicateIds.length)],
    ['zero/missing ids (unadministered)', String(unadministered.length)],
    ['state mismatches', String(stateMismatches.length)],
  ]);

  // ---- hierarchy ---------------------------------------------------------------------------
  const stateIds = [...new Set(records.map((r) => r.stateId))].sort((a, b) => Number(a) - Number(b));
  const hierarchy = {
    vintage: VINTAGE,
    generatedAt: new Date().toISOString(),
    reconciliation: {
      rosterAvailable,
      mode: rosterAvailable ? ('complete' as const) : ('partial' as const),
      note: rosterAvailable
        ? 'Reconciled against the OGD LGD district roster by LGD code.'
        : 'No administrative roster available (DATA_GOV_IN_API_KEY not configured). ' +
          'Every district is status="unreconciled" — statuses were not guessed.',
    },
    counts: {
      states: stateIds.length,
      districts: records.length,
      districtsWithGeometry: records.filter((r) => r.hasGeometry).length,
      unadministered: unadministered.length,
    },
    states: stateIds.map((stateId) => {
      const ds = records
        .filter((r) => r.stateId === stateId)
        .sort((a, b) => a.districtName.localeCompare(b.districtName));
      return {
        stateId,
        stateName: STATE_DISPLAY_NAMES[stateId] ?? ds[0]?.stateName ?? stateId,
        sourceStateName: ds[0]?.sourceStateName ?? '',
        isUnionTerritory: UNION_TERRITORY_IDS.has(stateId),
        districtCount: ds.length,
        districts: ds,
      };
    }),
  };

  writeJson(path.join(PATHS.build, 'hierarchy.json'), hierarchy);
  writeJson(path.join(PATHS.build, 'reconciliation.json'), {
    rosterAvailable,
    matched, adminWithoutGeometry, geometryWithoutAdmin,
    duplicateIds,
    unadministered: unadministered.map((a) => ({ districtId: a.districtId, name: a.districtName })),
    stateMismatches,
  });

  writeReport({ rosterAvailable, roster, attrs, stats, records, deltas,
    matched, adminWithoutGeometry, geometryWithoutAdmin, duplicateIds, unadministered, stateMismatches });
  ok(`coverage report → ${path.relative(process.cwd(), path.join(PATHS.reports, `coverage-${VINTAGE}.md`))}`);

  if (failureCount() > 0) die(`${failureCount()} reconciliation problem(s) in stage 04.`);
  ok('stage 04 complete');
}

function writeReport(ctx: {
  rosterAvailable: boolean; roster: AdminRosterT | null; attrs: Attr[]; stats: GeomStats;
  records: DistrictRecordT[]; deltas: Deltas | null;
  matched: string[]; adminWithoutGeometry: string[]; geometryWithoutAdmin: string[];
  duplicateIds: string[]; unadministered: Attr[];
  stateMismatches: { districtId: string; geomState: string; rosterState: string }[];
}): void {
  const n = (v: number) => Math.round(v).toLocaleString('en-IN');
  const L: string[] = [];

  L.push(`# Coverage report — vintage \`${VINTAGE}\``);
  L.push('');
  L.push(`Generated by \`pipeline/04-join.ts\` on ${new Date().toISOString()}.`);
  L.push('');
  L.push(
    ctx.rosterAvailable
      ? '**Status: complete.** Geometry reconciled against the OGD LGD roster by LGD code.'
      : '**Status: partial.** No administrative roster — `DATA_GOV_IN_API_KEY` is not configured. ' +
        'Geometry is fully verified; every district carries `status="unreconciled"`. ' +
        'No administrative data was invented.',
  );
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Reconciliation buckets');
  L.push('');
  L.push('| Bucket | Count |');
  L.push('|---|---:|');
  L.push(`| Geometry features | ${ctx.attrs.length} |`);
  L.push(`| Roster districts | ${ctx.rosterAvailable ? ctx.roster!.total : '— not fetched'} |`);
  L.push(`| Matched (by LGD code) | ${ctx.rosterAvailable ? ctx.matched.length : '—'} |`);
  L.push(`| Administrative without geometry | ${ctx.rosterAvailable ? ctx.adminWithoutGeometry.length : '—'} |`);
  L.push(`| Geometry without administrative record | ${ctx.rosterAvailable ? ctx.geometryWithoutAdmin.length : '—'} |`);
  L.push(`| Duplicate identifiers | ${ctx.duplicateIds.length} |`);
  L.push(`| Zero/missing LGD codes (unadministered) | ${ctx.unadministered.length} |`);
  L.push(`| State mismatches | ${ctx.stateMismatches.length} |`);
  L.push('');
  L.push('Joins are performed on `districtId` only. District names are never compared.');
  L.push('');

  if (ctx.unadministered.length) {
    L.push('### Zero/missing LGD codes — expected, not a defect');
    L.push('');
    L.push('| districtId | Name | Census code |');
    L.push('|---|---|---|');
    for (const a of ctx.unadministered) {
      L.push(`| \`${a.districtId}\` | ${a.districtName} | ${a.censusDistrictCode ?? '—'} |`);
    }
    L.push('');
    L.push('LGD assigns no code to territory it does not administer. Fallback identifiers are');
    L.push('used rather than invented LGD codes. See docs/DECISIONS.md D-003.');
    L.push('');
  }

  L.push('## Geometry integrity');
  L.push('');
  L.push('| Measure | Value |');
  L.push('|---|---:|');
  L.push(`| Features | ${ctx.stats.featureCount} |`);
  L.push(`| Unique district identifiers | ${ctx.stats.uniqueDistrictIds} |`);
  L.push(`| Distinct states/UTs | ${ctx.stats.stateCount} |`);
  L.push(`| Sum of parts (equal-area) | ${n(ctx.stats.sumOfPartsKm2)} km² |`);
  L.push(`| Dissolved union | ${n(ctx.stats.dissolvedUnionKm2)} km² |`);
  L.push(`| Overlap | ${n(ctx.stats.overlapKm2)} km² |`);
  L.push(`| Union vs official ${n(3287263)} km² | ${n(ctx.stats.dissolvedUnionKm2 - 3287263)} km² (${(((ctx.stats.dissolvedUnionKm2 - 3287263) / 3287263) * 100).toFixed(2)}%) |`);
  L.push('');
  L.push('Areas are computed in an Albers equal-area projection. `SHAPE_Area` is discarded —');
  L.push('it is 20.8% inflated (docs/DECISIONS.md D-010).');
  L.push('');

  if (ctx.deltas) {
    const d = ctx.deltas.dissolvedButPresentInGeometry;
    L.push('## Known boundary-version differences');
    L.push('');
    L.push(`### ${d.state} — ${d.districts.length} dissolved districts still in the geometry`);
    L.push('');
    L.push(`Dissolved ${d.effectiveDate}. Source: ${d.source}`);
    L.push('');
    L.push('| districtId | Name in layer | Gazette name | Present in geometry |');
    L.push('|---|---|---|---|');
    const ids = new Set(ctx.attrs.map((a) => a.districtId));
    for (const x of d.districts) {
      L.push(`| \`${x.districtId}\` | ${x.nameInLayer} | ${x.gazetteName} | ${ids.has(x.districtId) ? 'yes' : 'NO'} |`);
    }
    L.push('');
    L.push('The name differences are exactly why names are never join keys.');
    L.push('');

    const c = ctx.deltas.createdButAbsentFromGeometry;
    L.push(`### ${c.state} — ${c.districts.length} districts with no published boundary`);
    L.push('');
    L.push(`Notified ${c.notifiedDate}. Source: ${c.source}`);
    L.push('');
    L.push('| Name | Carved from |');
    L.push('|---|---|');
    for (const x of c.districts) L.push(`| ${x.name} | ${x.carvedFrom} |`);
    L.push('');
    L.push('**No boundary is fabricated for these.** They can only enter the dataset via the');
    L.push('OGD roster, with `status="no_boundary_published"`.');
    L.push('');
  }

  L.push('## Per-state district counts (from geometry)');
  L.push('');
  L.push('| id | State / UT | Type | Districts |');
  L.push('|---:|---|---|---:|');
  const per = new Map<string, number>();
  for (const a of ctx.attrs) per.set(a.stateId, (per.get(a.stateId) ?? 0) + 1);
  for (const [id, count] of [...per.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    L.push(`| ${id} | ${STATE_DISPLAY_NAMES[id]} | ${UNION_TERRITORY_IDS.has(id) ? 'UT' : 'State'} | ${count} |`);
  }
  L.push('');

  if (!ctx.rosterAvailable) {
    L.push('## Outstanding');
    L.push('');
    L.push('1. Set `DATA_GOV_IN_API_KEY` in `pipeline/.env` (free key from <https://www.data.gov.in/>)');
    L.push('2. `npm run fetch:admin` — OGD resource `37231365-78ba-44d5-ac22-3deec40b9197`');
    L.push('3. Re-run `npm run join && npm run simplify` to upgrade this report to complete');
    L.push('');
  }

  fs.writeFileSync(path.join(PATHS.reports, `coverage-${VINTAGE}.md`), L.join('\n'), 'utf8');
}

main().catch((err) => die(String(err?.stack ?? err)));
