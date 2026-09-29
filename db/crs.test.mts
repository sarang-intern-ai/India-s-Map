// OFFLINE unit tests for the CRS Excel ingestion (no DB). Run: npm run db:test:crs
import { readFileSync } from 'node:fs';
import { readCrsDataset, buildCrsDataset } from './crsDataset.ts';
import { buildReconciler } from './districtReconcile.ts';

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const rec = buildReconciler();

console.log('[1-2. workbook parsing + rows]');
const r = await readCrsDataset(new Uint8Array(readFileSync('public/data/CRS(data).xlsx')), rec);
check('parsed ok (header located below the title row)', r.ok === true);
if (!r.ok) process.exit(1);
check('header = the CRS columns', r.meta.header.join('|').includes('CRS State') && r.meta.header.join('|').includes('No. of Hours'));
check('matched CRS = 509 → 287 districts', r.meta.matched === 509 && r.meta.districts === 287, { m: r.meta.matched, d: r.meta.districts });

console.log('\n[3. district reconciliation]');
check('Y.S.R. Kadapa (504) has 2 stations', r.records.filter((x) => x.districtId === '504').length === 2);
check('Hello Kadapa reconciled to 504', r.records.some((x) => x.crsName === 'Hello Kadapa' && x.districtId === '504'));

console.log('\n[4. unmatched diagnostics]');
check('unmatched districts reported (not attached)', r.meta.unmatched.length > 0 && r.diagnostics.some((d) => d.code === 'unknown_district'));
check('no record has an empty districtId', r.records.every((x) => x.districtId && x.districtId.length > 0));

console.log('\n[5-6. blank Language / No. of Hours → null]');
check('Language blank on every row → null', r.records.every((x) => x.language === null));
check('No. of Hours blank on every row → null', r.records.every((x) => x.hours === null));

console.log('\n[7. identity: stable across reorder + edits]');
const HEAD = ['S.No', 'CRS State', 'CRS DISTRICT', 'Name of Organization', 'Location of CRS', 'Name of CRS', 'Language', 'No. of Hours'];
const rowA = [1, 'Andhra Pradesh', 'Chittoor', 'Org A', 'Loc A', 'Radio A', null, null];
const rowB = [2, 'Andhra Pradesh', 'Chittoor', 'Org B', 'Loc B', 'Radio B', null, null];
const k1 = buildCrsDataset([HEAD, rowA, rowB], rec);
const k2 = buildCrsDataset([HEAD, rowB, rowA], rec); // reordered
const keyOf = (res: any, name: string) => res.records.find((x: any) => x.crsName === name)?.sourceKey;
check('reorder → same sourceKey per station', k1.ok && k2.ok && keyOf(k1, 'Radio A') === keyOf(k2, 'Radio A') && keyOf(k1, 'Radio B') === keyOf(k2, 'Radio B'));
const edited = buildCrsDataset([HEAD, [1, 'Andhra Pradesh', 'Chittoor', 'Org A', 'Loc A', 'Radio A', 'Telugu', 8]], rec);
check('language/hours edit → SAME sourceKey (an UPDATE, not delete+insert)', edited.ok && keyOf(edited, 'Radio A') === keyOf(k1, 'Radio A'));
check('edited values captured', edited.ok && edited.records[0]!.language === 'Telugu' && edited.records[0]!.hours === 8);

console.log('\n[8. malformed + no-data guards]');
const bad = buildCrsDataset([HEAD, [1, '', '', 'O', 'L', 'X', null, null]], rec);
check('all-unusable → fatal no_data_rows (would empty dataset)', bad.ok === false && bad.code === 'no_data_rows');
const noHeader = buildCrsDataset([['just', 'a', 'title']], rec);
check('no header → fatal missing_header', noHeader.ok === false && noHeader.code === 'missing_header');

console.log(`\nRESULT: ${fail === 0 ? 'ALL CRS TESTS PASSED' : fail + ' FAILED'} (${pass} passed)`);
if (fail > 0) process.exit(1);
