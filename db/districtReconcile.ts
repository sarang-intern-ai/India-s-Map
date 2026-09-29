import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DISTRICT_NAME_OVERRIDES } from '../src/data/districtNames.ts';

/**
 * Reconciles a (state, district) name pair from an external source (e.g. the Word document) to a
 * canonical `districtId`, using ONLY the project's authoritative hierarchy + the official LGD name
 * registry + an explicit, human-verified alias table. It does NOT do unrestricted fuzzy matching:
 * a district that cannot be matched confidently is reported, never given an invented id. Geometry,
 * hierarchy and the LGD name registry are read-only here.
 *
 * Matching, in order (all within the correctly-matched state):
 *   1. exact normalized name (source name or official LGD name),
 *   2. space-insensitive normalized name (fixes DOCX spacing artifacts like "Mahendragar h"),
 *   3. an explicit curated alias (known LGD renames, e.g. Bangalore → Bengaluru).
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(district|dist|distt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const nospace = (s: string) => norm(s).replace(/ /g, '');

/** Curated, explicit aliases: "<stateNorm>|<docDistrictNorm>" → canonical LGD district name. Each
 *  is a verified rename/known-variant, not a guess. Extend here, outside any React code (§9). */
const DISTRICT_ALIASES: Record<string, string> = {
  // Karnataka renames
  'karnataka|bangalore urban': 'Bengaluru Urban',
  'karnataka|bangalore rural': 'Bengaluru Rural',
  'karnataka|mysore': 'Mysuru',
  'karnataka|belgaum': 'Belagavi',
  'karnataka|gulbarga': 'Kalaburagi',
  'karnataka|tumkur': 'Tumakuru',
  'karnataka|bagalkot': 'Bagalkote',
  'karnataka|bijapur': 'Vijayapura',
  'karnataka|chikmagalur': 'Chikkamagaluru',
  'karnataka|shimoga': 'Shivamogga',
  // Maharashtra
  'maharashtra|buldana': 'Buldhana',
  'maharashtra|mumbai city': 'Mumbai',
  // Odisha
  'odisha|jagatsinghpur': 'Jagatsinghapur',
  'odisha|balasore': 'Baleshwar',
  // Uttar Pradesh
  'uttar pradesh|gautam buddh nagar noida': 'Gautam Buddha Nagar',
  // Madhya Pradesh
  'madhya pradesh|ashok nagar': 'Ashoknagar',
  'madhya pradesh|chattarpur': 'Chhatarpur',
  'madhya pradesh|chhattarpur': 'Chhatarpur',
  'madhya pradesh|chindwara': 'Chhindwara',
  'madhya pradesh|jablpur': 'Jabalpur',
  // Andhra Pradesh
  'andhra pradesh|kadappa': 'Y.S.R. Kadapa',
  'andhra pradesh|kurnnol': 'Kurnool',
};

type Match =
  | { ok: true; districtId: string; stateId: string }
  | { ok: false; stateMatched: boolean; reason: string };

/** Canonical names for a districtId, used by the Excel WRITE-BACK path so a UI-added CRS row carries
 *  the authoritative "CRS State"/"CRS DISTRICT" text (never arbitrary user input) and reconciles
 *  back to the SAME districtId it was created for. */
export type CanonicalNames = { stateId: string; stateName: string; districtName: string };

export type Reconciler = {
  reconcile(state: string, district: string): Match;
  /** districtId → canonical { stateName, districtName } from the hierarchy, or null if unknown. */
  canonicalFor(districtId: string): CanonicalNames | null;
  readonly stateCount: number;
  readonly districtCount: number;
};

export function buildReconciler(hierarchyPath?: string): Reconciler {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const path = hierarchyPath ?? join(root, 'public/data/lgd-2024/hierarchy.json');
  const hierarchy = JSON.parse(readFileSync(path, 'utf8')) as {
    states: { stateId: string; stateName: string; districts: { districtId: string; districtName: string; sourceDistrictName?: string }[] }[];
  };

  const stateByNorm = new Map<string, string>(); // normalized state name → stateId
  const byNorm = new Map<string, string>();       // "stateId|normName" → districtId
  const byNospace = new Map<string, string>();     // "stateId|nospaceName" → districtId
  const stateIdToName = new Map<string, string>(); // for alias lookup by state name → id
  const canonical = new Map<string, CanonicalNames>(); // districtId → canonical names (reverse map)
  let districtCount = 0;

  const addName = (stateId: string, name: string, districtId: string) => {
    if (!name) return;
    byNorm.set(`${stateId}|${norm(name)}`, districtId);
    byNospace.set(`${stateId}|${nospace(name)}`, districtId);
  };

  for (const s of hierarchy.states) {
    stateByNorm.set(norm(s.stateName), s.stateId);
    stateIdToName.set(s.stateId, s.stateName);
    for (const d of s.districts) {
      districtCount++;
      addName(s.stateId, d.districtName, d.districtId);
      if (d.sourceDistrictName) addName(s.stateId, d.sourceDistrictName, d.districtId);
      const override = DISTRICT_NAME_OVERRIDES[d.districtId];
      if (override) addName(s.stateId, override.officialName, d.districtId);
      // Reverse map: prefer the official override name (it round-trips through reconcile() to the
      // same id) so a UI-written row is guaranteed to reconcile back to this exact districtId.
      canonical.set(d.districtId, {
        stateId: s.stateId,
        stateName: s.stateName,
        districtName: override?.officialName ?? d.districtName,
      });
    }
  }

  function reconcile(state: string, district: string): Match {
    const stateId = stateByNorm.get(norm(state));
    if (!stateId) return { ok: false, stateMatched: false, reason: `state "${state}" not in hierarchy` };
    const nd = norm(district);
    const direct = byNorm.get(`${stateId}|${nd}`);
    if (direct) return { ok: true, districtId: direct, stateId };
    const ns = byNospace.get(`${stateId}|${nospace(district)}`);
    if (ns) return { ok: true, districtId: ns, stateId };
    const alias = DISTRICT_ALIASES[`${norm(state)}|${nd}`];
    if (alias) {
      const aliased = byNorm.get(`${stateId}|${norm(alias)}`);
      if (aliased) return { ok: true, districtId: aliased, stateId };
    }
    return { ok: false, stateMatched: true, reason: `district "${district}" not found in ${state}` };
  }

  const canonicalFor = (districtId: string): CanonicalNames | null => canonical.get(districtId) ?? null;

  return { reconcile, canonicalFor, stateCount: hierarchy.states.length, districtCount };
}
