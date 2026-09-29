// OFFLINE unit tests for the Word/DOCX ingestion (no DB needed). Run: npm run db:test:word
import { readFileSync } from 'node:fs';
import { parseDocxTables } from './wordParser.ts';
import { buildWordDataset, readWordDataset } from './wordDataset.ts';
import { buildReconciler } from './districtReconcile.ts';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const bytes = new Uint8Array(readFileSync('public/data/community-radio-stations.docx'));
const rec = buildReconciler();

console.log('[1. parsing + table detection]');
const tables = parseDocxTables(bytes);
check('parsed 140 tables', tables.length === 140, tables.length);
check('table 0 row 0 is the header (has CRS State/District)',
  /state/i.test(tables[0]![0]![1]!) && /district/i.test(tables[0]![0]![2]!));

console.log('\n[2. header once / no repeated headers]');
let headerLike = 0;
for (const t of tables) for (const r of t) if (/state/i.test(r[1] ?? '') && /district/i.test(r[2] ?? '') && !/^\d/.test(r[0] ?? '')) headerLike++;
check('header row appears exactly once', headerLike === 1, headerLike);

console.log('\n[3. merged cells: none]');
check('no gridSpan/vMerge in the source (clean tables)',
  !readFileSync('public/data/community-radio-stations.docx').includes(Buffer.from('gridSpan')));

console.log('\n[4-5. row + state/district extraction]');
const r = readWordDataset(bytes, rec);
check('readWordDataset ok', r.ok === true);
if (r.ok) {
  check('540 station rows extracted', r.meta.stationRows === 540, r.meta.stationRows);
  check('S.No 1..540 continuous', (() => { const s = r.meta.stations.map(x => x.sNo).sort((a,b)=>a-b); return s[0]===1 && s[539]===540 && new Set(s).size===540; })());
  check('one entity per row (state+district present on every station)', r.meta.stations.every(x => x.state && x.district));
}

console.log('\n[6-7. district reconciliation — exact / nospace / alias]');
const m = (st: string, d: string) => { const x = rec.reconcile(st, d); return x.ok ? x.districtId : null; };
check('exact: Andhra Pradesh/Chittoor → 503', m('Andhra Pradesh', 'Chittoor') === '503', m('Andhra Pradesh', 'Chittoor'));
check('alias: Karnataka/Bangalore Urban → Bengaluru Urban (matched)', m('Karnataka', 'Bangalore Urban') !== null);
check('alias: Andhra Pradesh/Kadappa → 504 (Y.S.R. Kadapa)', m('Andhra Pradesh', 'Kadappa') === '504', m('Andhra Pradesh', 'Kadappa'));
check('nospace: Uttar Pradesh/RaeBareli → matched', m('Uttar Pradesh', 'RaeBareli') !== null);
check('unknown: Andhra Pradesh/Nowhereville → unmatched', m('Andhra Pradesh', 'Nowhereville') === null);
check('unknown state → unmatched', m('Atlantis', 'Somewhere') === null);

console.log('\n[8. malformed rows — synthetic]');
const HEADER = ['S.No', 'CRS State', 'CRS District', 'Org', 'Loc', 'Name', 'Freq'];
const badTables = [[HEADER, ['1', 'Andhra Pradesh', 'Chittoor', 'O', 'L', 'N', '90'], ['2', '', ''], ['not-a-number', 'x', 'y']]];
const bad = buildWordDataset(badTables, rec);
check('ok with one valid row', bad.ok === true);
if (bad.ok) {
  check('malformed empty-district row skipped (1 station kept)', bad.meta.stationRows === 1, bad.meta.stationRows);
  check('a malformed_row warning was recorded', bad.diagnostics.some(d => d.code === 'malformed_row'));
}

console.log('\n[9. unknown district → reported, not inserted]');
const unkTables = [[HEADER, ['1', 'Andhra Pradesh', 'Chittoor', 'O', 'L', 'N', '90'], ['2', 'Andhra Pradesh', 'Nowhereville', 'O', 'L', 'N', '91']]];
const unk = buildWordDataset(unkTables, rec);
check('unknown district excluded from records', unk.ok === true && unk.records.length === 1, unk.ok ? unk.records.length : 'fatal');
check('unknown district reported as unknown_district warning', unk.ok === true && unk.diagnostics.some(d => d.code === 'unknown_district'));

console.log('\n[10-11. numeric non-metrics NOT aggregated]');
if (r.ok) {
  check('only metric is Community Radio count (unit=stations)', r.records.every(x => x.datasetType === 'Speech' && x.subType === 'Community Radio' && x.unit === 'stations' && typeof x.value === 'number'));
  check('NO record uses frequency/contact as a value', !r.records.some(x => x.unit === 'MHz' || x.subType.toLowerCase().includes('frequency') || x.subType.toLowerCase().includes('contact')));
  check('frequency preserved on raw station, not summed', r.meta.stations.some(s => s.frequency !== '') );
}

console.log('\n[12. count correctness]');
if (r.ok) {
  const sum = r.records.reduce((a, x) => a + (x.value as number), 0);
  check('Σ district counts == matched stations', sum === r.meta.matched, { sum, matched: r.meta.matched });
  const dupIds = r.records.map(x => x.districtId);
  check('one count record per district (no dup districtIds)', new Set(dupIds).size === dupIds.length);
}

console.log(`\nRESULT: ${fail === 0 ? 'ALL WORD TESTS PASSED' : fail + ' FAILED'} (${pass} passed)`);
if (fail > 0) process.exit(1);
