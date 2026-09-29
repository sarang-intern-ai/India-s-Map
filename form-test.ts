import { validateDraft, dataToDraft, emptyDraft, newCustomFieldDraft, type DistrictDraft } from './src/features/panel/districtDataForm.ts';

const base = (): DistrictDraft => ({ population: '', literacy: '', notes: '', customFields: [] });
const show = (label: string, d: DistrictDraft) => {
  const r = validateDraft(d);
  const errs = { ...r.errors }; const custom = Object.entries(r.errors.custom);
  console.log(`${label.padEnd(42)} ok=${r.ok}` +
    (r.ok ? `  data=${JSON.stringify(r.data)}`
          : `  errors=${JSON.stringify({population:errs.population, literacy:errs.literacy, notes:errs.notes, custom: custom.map(([,e])=>e)})}`));
};

show('valid: pop 9400000, lit 87.4', { ...base(), population: '9400000', literacy: '87.4' });
show('empty (all blank)', base());
show('pop negative "-5"', { ...base(), population: '-5' });
show('pop decimal "12.5"', { ...base(), population: '12.5' });
show('pop non-numeric "abc"', { ...base(), population: 'abc' });
show('literacy 101', { ...base(), literacy: '101' });
show('literacy 100', { ...base(), literacy: '100' });
show('literacy 0', { ...base(), literacy: '0' });
show('literacy -1', { ...base(), literacy: '-1' });

const cf = (name: string, value: string, numeric: boolean) => ({ ...newCustomFieldDraft(), name, value, numeric });
show('custom valid text', { ...base(), customFields: [cf('Climate Risk', 'high', false)] });
show('custom valid numeric 0.72', { ...base(), customFields: [cf('Climate Risk', '0.72', true)] });
show('custom numeric non-number', { ...base(), customFields: [cf('Score', 'abc', true)] });
show('custom empty name', { ...base(), customFields: [cf('', 'x', false)] });
show('custom reserved name "Area"', { ...base(), customFields: [cf('Area', '5', false)] });
show('custom reserved name "population"', { ...base(), customFields: [cf('population', '5', false)] });
const dupA = cf('Score', '1', false); const dupB = cf('score', '2', false);
show('custom duplicate names', { ...base(), customFields: [dupA, dupB] });

console.log('\nround-trip: dataToDraft(empty) ==', JSON.stringify(emptyDraft()));
