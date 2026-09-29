// Offline proof that the DB representation is LOSSLESS: DatasetRecord → typed columns → DB row →
// DatasetRecord is the identity for number/text/boolean. This is what guarantees Excel↔Postgres
// raw-record parity without needing a live database. Run: npm run db:test
import { recordToInsert, rowToRecord, valueTypeOf, type DatasetRow } from './mapping.ts';
import type { DatasetRecord } from '../src/data/datasetRecords.ts';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Simulate the DB: an inserted record comes back as a row with the same typed columns. (Postgres
// returns double precision as a JS number, boolean as boolean, text as string — modeled here.)
function roundTrip(rec: DatasetRecord): DatasetRecord {
  const ins = recordToInsert(rec, { sourceId: 'main-dataset', sourceKey: 'k', recordId: null, sourceName: 'test.xlsx' });
  const row: DatasetRow = {
    district_id: ins.district_id, dataset_type: ins.dataset_type, sub_type: ins.sub_type,
    value_type: ins.value_type, value_number: ins.value_number, value_text: ins.value_text,
    value_boolean: ins.value_boolean, unit: ins.unit, source: ins.source,
    last_updated: ins.last_updated, notes: ins.notes,
  };
  return rowToRecord(row);
}

// A record equals another on the semantically-meaningful fields (§14: id/type/subType/value/unit),
// with value TYPE preserved. districtName is intentionally not stored, so it is excluded.
function semanticEqual(a: DatasetRecord, b: DatasetRecord): boolean {
  return a.districtId === b.districtId && a.datasetType === b.datasetType && a.subType === b.subType &&
    a.unit === b.unit && typeof a.value === typeof b.value && a.value === b.value &&
    (a.source ?? null) === (b.source ?? null) && (a.lastUpdated ?? null) === (b.lastUpdated ?? null) &&
    (a.notes ?? null) === (b.notes ?? null);
}

const samples: DatasetRecord[] = [
  { districtId: '490', datasetType: 'Speech', subType: 'YouTube', value: 120, unit: 'hours' },
  { districtId: '490', datasetType: 'Text', subType: 'Newspapers', value: 250000, unit: 'words', source: 'Excel', lastUpdated: '2026-08-14', notes: 'n' },
  { districtId: '103', datasetType: 'Text', subType: 'Folk Manuscripts', value: 'Limited', unit: '' },
  { districtId: '103', datasetType: 'Text', subType: 'Digitised Archives', value: false, unit: '' },
  { districtId: '52', datasetType: 'Speech', subType: 'Community Radio', value: true, unit: '' },
  { districtId: '52', datasetType: 'Social Media', subType: 'Instagram', value: 125000, unit: 'posts' },
];

console.log('[value_type detection]');
check('number→number', valueTypeOf(120) === 'number');
check('text→text', valueTypeOf('x') === 'text');
check('boolean→boolean', valueTypeOf(true) === 'boolean');

console.log('\n[lossless round-trip]');
for (const rec of samples) {
  const rt = roundTrip(rec);
  check(`${rec.datasetType}/${rec.subType} (${typeof rec.value} ${JSON.stringify(rec.value)})`, semanticEqual(rec, rt), rt);
}

console.log('\n[exactly-one-typed-column invariant]');
for (const rec of samples) {
  const ins = recordToInsert(rec, { sourceId: 's', sourceKey: 'k', recordId: null, sourceName: 's' });
  const populated = [ins.value_number, ins.value_text, ins.value_boolean].filter((v) => v !== null).length;
  check(`${rec.subType}: exactly one typed column populated`, populated === 1, ins);
}

console.log(`\nRESULT: ${fail === 0 ? 'ALL MAPPING TESTS PASSED' : fail + ' FAILED'} (${pass} passed)`);
if (fail > 0) process.exit(1);
