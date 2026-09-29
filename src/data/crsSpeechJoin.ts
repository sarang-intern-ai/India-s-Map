import type { DatasetRecord } from './datasetRecords.ts';

/**
 * View-layer join between the two CRS sources, computed in the frontend (no DB/API change, no
 * duplicated data). The authoritative station source (CRS(data).xlsx → crs_records → the CRS DATA
 * cards) is ENRICHED per station with the Speech-hours source (Test- CRS - Datasheet.xlsx →
 * dataset_records, in the bundle): its Location, Language/s and Speech Data (Hrs). Provenance stays
 * separate internally — this only combines the two for display.
 *
 * Matching is deterministic on the canonical districtId (both sides already scoped to one district)
 * plus the normalized CRS name, with the organization as a tie-breaker. No fuzzy matching.
 */

/** The `source` value the crs-speech parser stamps on every record it emits (see db/crsSpeechDataset.ts). */
export const SPEECH_SOURCE_NAME = 'Test CRS Speech Datasheet (Excel)';

export type SpeechMeta = { organization: string | null; location: string | null; language: string | null; hours: number };

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Parse the metadata the crs-speech parser packs into `notes`:
 *   "Organization: <org>; Location: <loc>; Language/s: <lang>"
 * Fields are separated by "; "; each value may itself contain commas (e.g. "Saran, Bihar").
 */
export function parseSpeechNotes(notes: string | undefined): { organization: string | null; location: string | null; language: string | null } {
  const out = { organization: null as string | null, location: null as string | null, language: null as string | null };
  for (const part of String(notes ?? '').split('; ')) {
    const i = part.indexOf(': ');
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 2).trim();
    if (!val) continue;
    if (key === 'organization') out.organization = val;
    else if (key === 'location') out.location = val;
    else if (key === 'language/s' || key === 'language') out.language = val;
  }
  return out;
}

/**
 * Build a per-district lookup of Speech-hours metadata keyed by normalized CRS name. Reads the
 * Speech-hours records straight from the already-loaded bundle (datasetType `Speech`, unit `hours`,
 * from the crs-speech source) — no extra fetch. Districts absent from that source yield an empty map.
 */
export function buildSpeechLookup(records: DatasetRecord[], districtId: string): Map<string, SpeechMeta[]> {
  const map = new Map<string, SpeechMeta[]>();
  for (const r of records) {
    if (r.districtId !== districtId) continue;
    if (r.datasetType !== 'Speech' || r.unit !== 'hours') continue;
    if (r.source !== SPEECH_SOURCE_NAME) continue;
    if (typeof r.value !== 'number') continue;
    const meta = parseSpeechNotes(r.notes);
    const key = norm(r.subType); // subType === CRS Name in the crs-speech source
    const entry: SpeechMeta = { organization: meta.organization, location: meta.location, language: meta.language, hours: r.value };
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

/**
 * Resolve the Speech-hours metadata for one CRS station: match by normalized CRS name, disambiguating
 * by organization when the name maps to more than one Speech record. Returns null when there is no
 * matching Speech record (the card then keeps its authoritative CRS-source values / "Not available").
 */
export function matchSpeech(lookup: Map<string, SpeechMeta[]>, crsName: string, organization: string | null): SpeechMeta | null {
  const bucket = lookup.get(norm(crsName));
  if (!bucket || bucket.length === 0) return null;
  if (bucket.length === 1) return bucket[0]!;
  const byOrg = bucket.find((m) => norm(m.organization) === norm(organization));
  return byOrg ?? bucket[0]!;
}
