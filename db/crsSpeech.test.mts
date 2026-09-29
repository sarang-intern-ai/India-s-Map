// OFFLINE unit tests for the CRS Speech Datasheet ingestion (no DB). Run: npm run db:test:crs-speech
import { readFileSync } from 'node:fs';
import { readCrsSpeechDataset, buildCrsSpeechDataset } from './crsSpeechDataset.ts';
import { assignSourceKeys } from './identity.ts';
import { buildReconciler } from './districtReconcile.ts';

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const rec = buildReconciler();
const FILE = 'public/data/Test- CRS - Datasheet.xlsx';

console.log('[1-3. workbook parsing + columns + reconciliation]');
const r = await readCrsSpeechDataset(new Uint8Array(readFileSync(FILE)), rec);
check('parsed ok', r.ok === true);
if (!r.ok) process.exit(1);
check('all 5 columns detected', ['Organization', 'CRS Name', 'Location', 'Language/s', 'Speech Data (Hrs)'].every((h) => r.meta.header.some((x) => x.toLowerCase().includes(h.split(' ')[0]!.toLowerCase()))));
check('35 reconciled, 1 unmatched (of 36 rows)', r.meta.matched === 35 && r.meta.unmatched.length === 1, { matched: r.meta.matched, unmatched: r.meta.unmatched.length });

console.log('\n[4. Speech hours are numeric, unit hours, datasetType Speech]');
check('every record datasetType=Speech, unit=hours', r.records.every((x) => x.datasetType === 'Speech' && x.unit === 'hours'));
check('every value is a finite number', r.records.every((x) => typeof x.value === 'number' && Number.isFinite(x.value as number)));
const charminar = r.records.find((x) => x.subType === 'Radio Charminar');
check('Radio Charminar = 1719 hours (numeric)', charminar?.value === 1719, charminar?.value);
check('subType is the CRS Name', r.records.every((x) => typeof x.subType === 'string' && x.subType.length > 0));

console.log('\n[5. Language/s preserved as metadata, NOT a numeric metric]');
check('Radio Charminar notes carry Organization + Language/s', /Organization: Ahle Bait Institute/.test(charminar?.notes ?? '') && /Language\/s: Telugu, Urdu, Hindi/.test(charminar?.notes ?? ''), charminar?.notes);
check('no record has a Language datasetType/unit', r.records.every((x) => x.datasetType !== 'Language' && x.unit !== 'language'));

console.log('\n[6-7. reconciliation + unmatched reported, not invented]');
check('unmatched is the Bengaluru row, reported via diagnostics', r.meta.unmatched[0]?.crsName === 'Radio Active CR 90.4 MHz' && r.diagnostics.some((d) => d.code === 'unknown_district'), r.meta.unmatched[0]);
check('no record has an empty districtId', r.records.every((x) => x.districtId && x.districtId.length > 0));

console.log('\n[8. multiple CRS in one district → distinct Speech subTypes (both aggregate)]');
const HEAD = ['Organization', 'CRS Name', 'Location', 'Language/s', 'Speech Data (Hrs)'];
const two = buildCrsSpeechDataset([
  HEAD,
  ['Org A', 'Radio A', 'Kollam, Kerala', 'Malayalam', 100],
  ['Org B', 'Radio B', 'Kollam, Kerala', 'Malayalam', 50],
], rec);
check('two CRS in one district → two records, distinct subTypes', two.ok && two.records.length === 2 && two.records[0]!.subType !== two.records[1]!.subType);
check('both resolve to the same districtId', two.ok && two.records[0]!.districtId === two.records[1]!.districtId);

console.log('\n[9-11. source identity: stable across reorder + value edit; identity-field change re-keys]');
const rowA = ['Org A', 'Radio A', 'Kollam, Kerala', 'Malayalam', 100];
const rowB = ['Org B', 'Radio B', 'Kollam, Kerala', 'Malayalam', 50];
const k1 = buildCrsSpeechDataset([HEAD, rowA, rowB], rec);
const k2 = buildCrsSpeechDataset([HEAD, rowB, rowA], rec); // reordered
const idOf = (res: any, name: string) => res.recordIds[res.records.findIndex((x: any) => x.subType === name)];
check('reorder → SAME record_id per CRS (a no-op)', k1.ok && k2.ok && idOf(k1, 'Radio A') === idOf(k2, 'Radio A') && idOf(k1, 'Radio B') === idOf(k2, 'Radio B'));
const edited = buildCrsSpeechDataset([HEAD, ['Org A', 'Radio A', 'Kollam, Kerala', 'Malayalam', 175]], rec);
check('editing Speech hours → SAME record_id (an UPDATE, not delete+insert)', edited.ok && idOf(edited, 'Radio A') === idOf(k1, 'Radio A'));
check('edited value captured', edited.ok && edited.records[0]!.value === 175);
const renamed = buildCrsSpeechDataset([HEAD, ['Org A', 'Radio A RENAMED', 'Kollam, Kerala', 'Malayalam', 100]], rec);
check('changing an identity field → DIFFERENT record_id', renamed.ok && idOf(renamed, 'Radio A RENAMED') !== idOf(k1, 'Radio A'));
// source_key from the generic identity uses record_id → rid:<id>
check('assignSourceKeys uses record_id → rid: prefix (independent source-key namespace)',
  k1.ok && assignSourceKeys(k1.records, k1.recordIds).every((sk) => sk.startsWith('rid:crs-speech:')));

console.log('\n[12. guards]');
const empty = buildCrsSpeechDataset([HEAD], rec);
check('no data rows → fatal no_data_rows (would empty the source)', empty.ok === false && empty.code === 'no_data_rows');
const noHeader = buildCrsSpeechDataset([['just', 'a', 'title']], rec);
check('no header → fatal missing_columns', noHeader.ok === false && noHeader.code === 'missing_columns');
const bareUT = buildCrsSpeechDataset([HEAD, ['Org', 'Radio Chd', 'Chandigarh', 'Hindi', 10]], rec);
check('single-token Location (Chandigarh UT) reconciles (district==state)', bareUT.ok && bareUT.records.length === 1);

console.log(`\nRESULT: ${fail === 0 ? 'ALL CRS-SPEECH TESTS PASSED' : fail + ' FAILED'} (${pass} passed)`);
if (fail > 0) process.exit(1);
