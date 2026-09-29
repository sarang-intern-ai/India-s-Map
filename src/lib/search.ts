import type { DistrictRecord } from '../data/schema.ts';
import { officialDistrictName, overriddenSourceName } from '../data/districtNames.ts';

export type StateOption = {
  stateId: string;
  stateName: string;
  districtCount: number;
  isUnionTerritory: boolean;
};

/** Ordered best → worst. The numeric value is the sort rank. */
export const MATCH_RANK = {
  'exact-name': 0,
  'exact-code': 1,
  'prefix-name': 2,
  'prefix-code': 3,
  'word-name': 4,
  'substring-name': 5,
} as const;
export type MatchKind = keyof typeof MATCH_RANK;

export type DistrictHit = { record: DistrictRecord; kind: MatchKind };
export type StateHit = { state: StateOption; kind: MatchKind };

export type SearchResults = {
  query: string;
  /** Matching States/UTs. Empty while a state filter is active — see searchAll(). */
  states: StateHit[];
  districts: DistrictHit[];
  /** Total district matches before the display limit, for "showing N of M". */
  totalDistricts: number;
  truncated: boolean;
};

export function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The preferred user-facing name for a district — official/latest LGD name when reconciled. */
export function districtDisplayName(record: DistrictRecord): string {
  return officialDistrictName(record.districtId, record.districtName);
}

/**
 * LGD codes in this dataset are short integers ("1", "3", "77", "623"). Substring matching
 * them would make a query of "1" match hundreds of districts, so codes are only ever
 * matched exactly or by prefix, and only when the query looks like a code.
 */
function isCodeQuery(q: string): boolean {
  return /^\d+$/.test(q);
}

/** True when `q` matches the start of any whitespace-separated word in `haystack`. */
function matchesWordStart(haystack: string, q: string): boolean {
  return haystack.split(' ').some((word) => word.startsWith(q));
}

/** Best name-based rank for a single candidate name, or null if it does not match. */
function classifyName(name: string, q: string): MatchKind | null {
  if (name === q) return 'exact-name';
  if (name.startsWith(q)) return 'prefix-name';
  if (matchesWordStart(name, q)) return 'word-name';
  if (name.includes(q)) return 'substring-name';
  return null;
}

function classifyDistrict(record: DistrictRecord, q: string): MatchKind | null {
  // A district is searchable by BOTH its official/latest LGD name (the display name) and its
  // original source/map name, so e.g. "Dahod" (official) and "Dohad" (map) both resolve. Only
  // names supported by the reconciliation are used — no invented aliases.
  const candidates = [normalise(officialDistrictName(record.districtId, record.districtName))];
  const source = overriddenSourceName(record.districtId);
  if (source) candidates.push(normalise(source));

  let best: MatchKind | null = null;
  for (const name of candidates) {
    const kind = classifyName(name, q);
    if (kind && (best === null || MATCH_RANK[kind] < MATCH_RANK[best])) best = kind;
  }

  if (isCodeQuery(q)) {
    // The two unadministered districts have no LGD code; their fallback identifier is
    // "unadministered:<census code>", so the census code is what a user would type.
    const code = record.administered ? record.districtId : (record.censusDistrictCode ?? '');
    let codeKind: MatchKind | null = null;
    if (code === q) codeKind = 'exact-code';
    else if (code.startsWith(q)) codeKind = 'prefix-code';
    if (codeKind && (best === null || MATCH_RANK[codeKind] < MATCH_RANK[best])) best = codeKind;
  }

  return best;
}

function classifyState(state: StateOption, q: string): MatchKind | null {
  const name = normalise(state.stateName);
  if (name === q) return 'exact-name';
  if (name.startsWith(q)) return 'prefix-name';
  if (matchesWordStart(name, q)) return 'word-name';
  if (name.includes(q)) return 'substring-name';
  return null;
}

export const DISTRICT_LIMIT = 10;
export const STATE_LIMIT = 3;

/**
 * Searches the loaded hierarchy. No aliases, no synonyms and no invented administrative
 * entities — every result is a row that exists in public/data/lgd-2024/.
 *
 * States/UTs are returned as their own result group because several queries a user would
 * naturally type are States/UTs and not districts at all:
 *   · "Delhi"      — a UT of 11 districts named Central, East, New Delhi, North, …
 *   · "Puducherry" — a UT whose district is spelled "Pondicherry"
 * Returning nothing (or silently pretending a district exists) would be wrong for both.
 *
 * When a state filter is active the state group is suppressed: the scope is already chosen,
 * and the State/UT dropdown is the control for changing it.
 */
export function searchAll(
  rawQuery: string,
  options: {
    districts: DistrictRecord[];
    states: StateOption[];
    stateFilter: string;
    districtLimit?: number;
    stateLimit?: number;
  },
): SearchResults {
  const q = normalise(rawQuery);
  const districtLimit = options.districtLimit ?? DISTRICT_LIMIT;
  const stateLimit = options.stateLimit ?? STATE_LIMIT;
  const inScope = options.stateFilter
    ? options.districts.filter((d) => d.stateId === options.stateFilter)
    : options.districts;

  // Empty query inside a state filter: list that state's districts so the filter is
  // browsable rather than a dead end.
  if (q === '') {
    if (!options.stateFilter) {
      return { query: q, states: [], districts: [], totalDistricts: 0, truncated: false };
    }
    const sorted = [...inScope].sort((a, b) =>
      districtDisplayName(a).localeCompare(districtDisplayName(b), 'en-IN'),
    );
    return {
      query: q,
      states: [],
      districts: sorted.slice(0, districtLimit).map((record) => ({
        record,
        kind: 'substring-name' as MatchKind,
      })),
      totalDistricts: sorted.length,
      truncated: sorted.length > districtLimit,
    };
  }

  const districtHits: DistrictHit[] = [];
  for (const record of inScope) {
    const kind = classifyDistrict(record, q);
    if (kind) districtHits.push({ record, kind });
  }
  districtHits.sort(
    (a, b) =>
      MATCH_RANK[a.kind] - MATCH_RANK[b.kind] ||
      districtDisplayName(a.record).localeCompare(districtDisplayName(b.record), 'en-IN'),
  );

  const stateHits: StateHit[] = [];
  if (!options.stateFilter) {
    for (const state of options.states) {
      const kind = classifyState(state, q);
      if (kind) stateHits.push({ state, kind });
    }
    stateHits.sort(
      (a, b) =>
        MATCH_RANK[a.kind] - MATCH_RANK[b.kind] ||
        a.state.stateName.localeCompare(b.state.stateName, 'en-IN'),
    );
  }

  return {
    query: q,
    states: stateHits.slice(0, stateLimit),
    districts: districtHits.slice(0, districtLimit),
    totalDistricts: districtHits.length,
    truncated: districtHits.length > districtLimit,
  };
}

/**
 * State/UT-only search for the dedicated State/UT selector in the toolbar. Reuses the same
 * matching/ranking as {@link searchAll} — the only difference is that the candidate set is
 * States/UTs rather than districts. An empty query lists all States/UTs alphabetically so the
 * control is browsable.
 */
export function searchStates(
  rawQuery: string,
  states: StateOption[],
  limit = 8,
): StateHit[] {
  const q = normalise(rawQuery);
  if (q === '') {
    return [...states]
      .sort((a, b) => a.stateName.localeCompare(b.stateName, 'en-IN'))
      .slice(0, limit)
      .map((state) => ({ state, kind: 'substring-name' as MatchKind }));
  }
  const hits: StateHit[] = [];
  for (const state of states) {
    const kind = classifyState(state, q);
    if (kind) hits.push({ state, kind });
  }
  hits.sort(
    (a, b) =>
      MATCH_RANK[a.kind] - MATCH_RANK[b.kind] ||
      a.state.stateName.localeCompare(b.state.stateName, 'en-IN'),
  );
  return hits.slice(0, limit);
}

/** True when a hit is an unambiguous exact match worth badging in the UI. */
export function isExactMatch(kind: MatchKind): boolean {
  return kind === 'exact-name' || kind === 'exact-code';
}
