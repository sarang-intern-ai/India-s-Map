// OFFLINE round-trip tests for the CRS Excel WRITE-BACK path (no DB). Works on a TEMP COPY of the
// real workbook — the authoritative file is never touched. Run: npm run db:test:crs:write
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCrsDataset } from './crsDataset.ts';
import { readCrsWorkbook, addCrs, updateCrs, deleteCrs, workbookVersion } from './crsWorkbook.ts';
import { buildReconciler } from './districtReconcile.ts';

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const rec = buildReconciler();
const SRC = 'public/data/CRS(data).xlsx';

const dir = join(tmpdir(), `crs-write-test-${process.pid}`);
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const FILE = join(dir, 'CRS(data).xlsx');
copyFileSync(SRC, FILE);

const parse = async (f: string) => {
  const r = await readCrsDataset(new Uint8Array(readFileSync(f)), rec);
  if (!r.ok) throw new Error('parse failed: ' + r.message);
  return r;
};

try {
  console.log('[1. identity parity: workbook view keys == parser keys]');
  const parsed0 = await parse(FILE);
  const view0 = await readCrsWorkbook(FILE);
  const parsedKeys = new Set(parsed0.records.map((r) => r.sourceKey));
  const viewKeys = new Set(view0.bySourceKey.keys());
  check('same record count', parsed0.records.length === view0.rows.length, { parser: parsed0.records.length, view: view0.rows.length });
  check('every parser sourceKey exists in the workbook view (byte-identical identity)',
    [...parsedKeys].every((k) => viewKeys.has(k)) && parsedKeys.size === viewKeys.size,
    { parser: parsedKeys.size, view: viewKeys.size });
  check('workbook version = sha256 of bytes', view0.version === workbookVersion(readFileSync(FILE)));

  console.log('\n[2. UPDATE language/hours → same sourceKey, values changed]');
  const victim = parsed0.records.find((r) => r.language === null && r.hours === null)!;
  const up = await updateCrs(FILE, victim.sourceKey, { language: 'Telugu', hours: 8 }, view0.version);
  check('update ok', up.ok === true, up);
  check('update kept the same sourceKey (language/hours are non-identity)', up.ok && up.sourceKey === victim.sourceKey);
  const parsed1 = await parse(FILE);
  const after = parsed1.records.find((r) => r.sourceKey === victim.sourceKey);
  check('language persisted to Excel = Telugu', after?.language === 'Telugu', after?.language);
  check('hours persisted to Excel = 8', after?.hours === 8, after?.hours);
  check('record count unchanged by update', parsed1.records.length === parsed0.records.length);
  check('every OTHER record is byte-identical (no collateral change)',
    parsed1.records.filter((r) => r.sourceKey !== victim.sourceKey)
      .every((r) => { const o = parsed0.records.find((x) => x.sourceKey === r.sourceKey);
        return o && o.language === r.language && o.hours === r.hours && o.crsName === r.crsName && o.organization === r.organization && o.location === r.location; }));

  console.log('\n[3. ADD → new row physically in Excel with canonical State/District + next S.No]');
  const districtId = '504'; // Y.S.R. Kadapa (from CRS tests)
  const canon = rec.canonicalFor(districtId)!;
  const v1 = (await readCrsWorkbook(FILE)).version;
  const maxSNoBefore = (await readCrsWorkbook(FILE)).maxSNo;
  const add = await addCrs(FILE, { districtId, crsName: 'Radio Roundtrip', organization: 'RT Org', location: 'RT Loc', language: 'Hindi', hours: 6 }, v1);
  check('add ok', add.ok === true, add);
  const parsed2 = await parse(FILE);
  const added = parsed2.records.find((r) => r.crsName === 'Radio Roundtrip' && r.districtId === districtId);
  check('added row exists in Excel, reconciled to the district', !!added, added);
  check('CRS State written from canonical mapping', added?.state === canon.stateName, added?.state);
  check('CRS DISTRICT written from canonical mapping', added?.district === canon.districtName, added?.district);
  check('S.No = previous max + 1', added?.sNo === maxSNoBefore + 1, { got: added?.sNo, expected: maxSNoBefore + 1 });
  check('language/hours captured on add', added?.language === 'Hindi' && added?.hours === 6);
  check('count increased by exactly 1', parsed2.records.length === parsed1.records.length + 1);

  console.log('\n[4. duplicate ADD refused]');
  const v2 = (await readCrsWorkbook(FILE)).version;
  const dup = await addCrs(FILE, { districtId, crsName: 'Radio Roundtrip', organization: 'RT Org', location: 'RT Loc' }, v2);
  check('duplicate identity refused (409 duplicate)', dup.ok === false && dup.code === 'duplicate', dup);

  console.log('\n[5. CONFLICT: stale baseVersion refused, workbook untouched]');
  const staleTry = await updateCrs(FILE, victim.sourceKey, { hours: 99 }, 'deadbeefstale');
  check('stale baseVersion → 409 conflict', staleTry.ok === false && staleTry.code === 'conflict', staleTry);
  const parsedConf = await parse(FILE);
  check('conflict did NOT change the workbook', parsedConf.records.find((r) => r.sourceKey === victim.sourceKey)?.hours === 8);

  console.log('\n[6. DELETE → row physically removed, others intact]');
  const v3 = (await readCrsWorkbook(FILE)).version;
  const del = await deleteCrs(FILE, added!.sourceKey, v3);
  check('delete ok', del.ok === true, del);
  const parsed3 = await parse(FILE);
  check('deleted row is gone from Excel', !parsed3.records.some((r) => r.crsName === 'Radio Roundtrip'));
  check('count back to post-update baseline', parsed3.records.length === parsed1.records.length);
  check('the earlier update survived the delete', parsed3.records.find((r) => r.sourceKey === victim.sourceKey)?.language === 'Telugu');

  console.log('\n[7. not_found for an unknown sourceKey]');
  const nf = await deleteCrs(FILE, 'nonexistentkey#0');
  check('unknown sourceKey → 404 not_found', nf.ok === false && nf.code === 'not_found', nf);

} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nRESULT: ${fail === 0 ? 'ALL CRS WRITE-BACK TESTS PASSED' : fail + ' FAILED'} (${pass} passed)`);
if (fail > 0) process.exit(1);
