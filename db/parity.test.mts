// LIVE Excel↔PostgreSQL parity test. Requires: DB migrated + imported, and the API running
// (npm run server). Compares raw records AND district/state aggregation for the 5 test districts,
// proving the frontend behaves identically whether the source is Excel or PostgreSQL.
// Run: npm run db:parity
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiPort } from './env.ts';
import { ExcelDatasetProvider } from '../src/data/excelProvider.ts';
import type { DatasetRecord } from '../src/data/datasetRecords.ts';
import {
  buildDistrictAggregates,
  buildStateAggregates,
  type DatasetAggregate,
} from '../src/data/aggregateDatasetRecords.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const XLSX_PATH = join(root, 'public/data/sample_india_district_dataset.xlsx');
const SHEET = 'DistrictData';
const BASE = `http://localhost:${apiPort()}/api`;
const DISTRICTS = ['490', '469', '165', '52', '103'];

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

/** Canonical, comparable form of a record — the semantic contract only (§14), districtName excluded. */
function canon(r: DatasetRecord) {
  return { districtId: r.districtId, datasetType: r.datasetType, subType: r.subType,
    valueType: typeof r.value, value: r.value, unit: r.unit,
    source: r.source ?? null, lastUpdated: r.lastUpdated ?? null, notes: r.notes ?? null };
}
// Compare as a SET (order-independent): DB row ids can be reordered by prior insert/delete cycles,
// but the set of records is what must match.
const canonList = (rs: DatasetRecord[]) =>
  JSON.stringify(rs.map(canon).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const aggJson = (a: DatasetAggregate[] | undefined) =>
  JSON.stringify((a ?? []).map((x) => ({ datasetType: x.datasetType, totalsByUnit: x.totalsByUnit, duplicateSubTypes: x.duplicateSubTypes })));

// Isolate the Excel-derived source so the comparison is unaffected by other sources (e.g. the
// Word/community-radio data) that also live in the same dataset_records table.
async function api(path: string): Promise<DatasetRecord[]> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}source=main-dataset`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${path} → HTTP ${res.status}`);
  return (await res.json()) as DatasetRecord[];
}

async function main() {
  // Excel side (buffer variant — reuses the real provider).
  const buf = readFileSync(XLSX_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const excel = await new ExcelDatasetProvider({ kind: 'buffer', data: ab, fileName: 'sample.xlsx', sheetName: SHEET }).load();
  if (excel.records.length === 0) throw new Error('Excel produced no records');

  // Postgres side (via API). Fail clearly if the server/DB is not up.
  let pgAll: DatasetRecord[];
  try {
    pgAll = await api('/datasets');
  } catch (e) {
    console.error(`\nCannot reach the dataset API at ${BASE}. Start it with "npm run server" after ` +
      `db:migrate + db:import.\n${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  const districtToState = new Map<string, string>();
  const hierarchy = JSON.parse(readFileSync(join(root, 'public/data/lgd-2024/hierarchy.json'), 'utf8')) as
    { states: { stateId: string; districts: { districtId: string }[] }[] };
  for (const s of hierarchy.states) for (const d of s.districts) districtToState.set(d.districtId, s.stateId);

  // I. Raw-record parity, whole dataset.
  console.log('[I. raw record parity — whole dataset]');
  check('whole-dataset records identical (semantic fields)', canonList(excel.records) === canonList(pgAll), {
    excel: excel.records.length, pg: pgAll.length });

  // Raw-record parity + per-district endpoint parity for the 5 districts.
  console.log('\n[E. per-district query + raw parity]');
  const excelByDistrict = new Map<string, DatasetRecord[]>();
  for (const r of excel.records) (excelByDistrict.get(r.districtId) ?? excelByDistrict.set(r.districtId, []).get(r.districtId)!).push(r);
  for (const id of DISTRICTS) {
    const pg = await api(`/datasets/district/${id}`);
    const ex = excelByDistrict.get(id) ?? [];
    check(`district ${id}: ${ex.length} records match`, canonList(ex) === canonList(pg), { ex: ex.length, pg: pg.length });
  }

  // J. District aggregation parity.
  console.log('\n[J. district aggregation parity]');
  const exD = buildDistrictAggregates(excel.records);
  const pgD = buildDistrictAggregates(pgAll);
  for (const id of DISTRICTS) {
    check(`district ${id} aggregates identical`, aggJson(exD.get(id)) === aggJson(pgD.get(id)), { id });
  }

  // K. State aggregation parity (via the shared engine, same districtToState).
  console.log('\n[K. state aggregation parity]');
  const exS = buildStateAggregates(exD, districtToState);
  const pgS = buildStateAggregates(pgD, districtToState);
  const states = new Set<string>();
  for (const id of DISTRICTS) { const s = districtToState.get(id); if (s) states.add(s); }
  for (const s of states) {
    check(`state ${s} aggregates identical`, aggJson(exS.get(s)) === aggJson(pgS.get(s)), { s });
  }
  // Spot-check named totals.
  const mh = districtToState.get('490')!;
  const mhSpeech = (pgS.get(mh) ?? []).find((a) => a.datasetType === 'Speech');
  check('Maharashtra Speech = 380 hours (from Postgres)',
    JSON.stringify(mhSpeech?.totalsByUnit) === JSON.stringify([{ unit: 'hours', value: 380 }]), mhSpeech?.totalsByUnit);

  // F. State endpoint parity for one state.
  console.log('\n[F. per-state endpoint raw parity]');
  const pgMh = await api(`/datasets/state/${mh}`);
  const exMh = excel.records.filter((r) => districtToState.get(r.districtId) === mh);
  check(`state ${mh}: ${exMh.length} records match`, canonList(exMh) === canonList(pgMh), { ex: exMh.length, pg: pgMh.length });

  // G/H/10. Unknown district, unknown state, empty result → [] (never fabricated zeros).
  console.log('\n[G/H. unknown district/state → empty]');
  check('unknown district 999999 → []', (await api('/datasets/district/999999')).length === 0);
  check('unknown state ZZ → []', (await api('/datasets/state/ZZ')).length === 0);

  console.log(`\nRESULT: ${fail === 0 ? 'ALL PARITY TESTS PASSED' : fail + ' FAILED'} (${pass} passed)`);
  if (fail > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error('Parity test error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
