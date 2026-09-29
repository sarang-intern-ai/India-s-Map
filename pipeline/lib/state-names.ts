/**
 * Display labels for the 36 LGD state / UT codes.
 *
 * This is a PRESENTATION table, not a source of truth. The source layer stores names in
 * upper case with irregular punctuation ("DADRA,NAGAR HAVELI,DAMAN & DIU"), which is fine
 * for data but poor for a UI. Algorithmic title-casing mangles conjunctions and ampersands,
 * so the 36 known entities are mapped explicitly.
 *
 * The raw `stname` is preserved on every record as `sourceStateName` — nothing is lost.
 * Stage 03 fails if the set of codes here does not exactly match the codes observed in the
 * data, so this table can never silently drift out of sync with a data refresh.
 *
 * Codes 25 (Daman & Diu) and 26 (Dadra & Nagar Haveli) are intentionally absent: they were
 * merged into code 38 in 2020 and do not appear in the source.
 */
export const STATE_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '1': 'Jammu and Kashmir',
  '2': 'Himachal Pradesh',
  '3': 'Punjab',
  '4': 'Chandigarh',
  '5': 'Uttarakhand',
  '6': 'Haryana',
  '7': 'Delhi',
  '8': 'Rajasthan',
  '9': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Ladakh',
  '38': 'Dadra and Nagar Haveli and Daman and Diu',
});

/** Union Territories, by LGD code. Used for the states-vs-UTs breakdown. */
export const UNION_TERRITORY_IDS: ReadonlySet<string> = new Set([
  '1', // Jammu and Kashmir (UT since 2019)
  '4', // Chandigarh
  '7', // Delhi (NCT)
  '31', // Lakshadweep
  '34', // Puducherry
  '35', // Andaman and Nicobar Islands
  '37', // Ladakh
  '38', // Dadra and Nagar Haveli and Daman and Diu
]);

/**
 * Title-cases a district name from the source layer only where the source is already
 * mixed-case; district names arrive in reasonable case and are passed through untouched.
 * Kept as an explicit no-op so the intent is unambiguous to the next reader.
 */
export function districtDisplayName(sourceName: string): string {
  return sourceName.trim();
}
