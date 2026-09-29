// AUTO-GENERATED — do not edit by hand.
// Reconciliation of the map's LGD district names against the official/latest LGD reference
// "All Districts of India" (Local Government Directory), exported 2026-08-14.
// Method + full report: docs/district-name-reconciliation.md
//
// Keyed by canonical districtId (=== String(dist_lgd) for administered districts, which is
// exactly the LGD "District Code"). An entry exists ONLY where the official/latest LGD name
// differs from the source/map name AND the match is confirmed by BOTH district code and state
// code. Cross-state code collisions and unmatched districts are deliberately absent (they keep
// their source name); see the report. The source name is retained, never discarded.

export type DistrictNameOverride = {
  /** LGD district code (equals districtId for administered districts). */
  lgdDistrictCode: string;
  /** Name carried in the geometry/source dataset — preserved, never overwritten. */
  sourceName: string;
  /** Official/latest LGD district name — the preferred display name. */
  officialName: string;
};

export const DISTRICT_NAME_OVERRIDES: Record<string, DistrictNameOverride> = {
  "21": { lgdDistrictCode: "21", sourceName: "Lahul And Spiti", officialName: "Lahaul And Spiti" },
  "54": { lgdDistrictCode: "54", sourceName: "Rudra Prayag", officialName: "Rudraprayag" },
  "56": { lgdDistrictCode: "56", sourceName: "Udam Singh Nagar", officialName: "Udham Singh Nagar" },
  "57": { lgdDistrictCode: "57", sourceName: "Uttar Kashi", officialName: "Uttarkashi" },
  "129": { lgdDistrictCode: "129", sourceName: "Barabanki", officialName: "Bara Banki" },
  "160": { lgdDistrictCode: "160", sourceName: "Kushi Nagar", officialName: "Kushinagar" },
  "164": { lgdDistrictCode: "164", sourceName: "Maharajganj", officialName: "Mahrajganj" },
  "178": { lgdDistrictCode: "178", sourceName: "Sant Kabeer Nagar", officialName: "Sant Kabir Nagar" },
  "181": { lgdDistrictCode: "181", sourceName: "Shravasti", officialName: "Shrawasti" },
  "182": { lgdDistrictCode: "182", sourceName: "Siddharth Nagar", officialName: "Siddharthnagar" },
  "267": { lgdDistrictCode: "267", sourceName: "Saiha", officialName: "Siaha" },
  "293": { lgdDistrictCode: "293", sourceName: "Karimganj", officialName: "Sribhumi" },
  "303": { lgdDistrictCode: "303", sourceName: "24 Paraganas North", officialName: "North 24 Parganas" },
  "304": { lgdDistrictCode: "304", sourceName: "24 Paraganas South", officialName: "South 24 Parganas" },
  "308": { lgdDistrictCode: "308", sourceName: "Coochbehar", officialName: "Cooch Behar" },
  "310": { lgdDistrictCode: "310", sourceName: "Dinajpur Dakshin", officialName: "Dakshin Dinajpur" },
  "311": { lgdDistrictCode: "311", sourceName: "Dinajpur Uttar", officialName: "Uttar Dinajpur" },
  "316": { lgdDistrictCode: "316", sourceName: "Maldah", officialName: "Malda" },
  "317": { lgdDistrictCode: "317", sourceName: "Medinipur East", officialName: "Purba Medinipur" },
  "318": { lgdDistrictCode: "318", sourceName: "Medinipur West", officialName: "Paschim Medinipur" },
  "344": { lgdDistrictCode: "344", sourceName: "Anugul", officialName: "Anugola" },
  "347": { lgdDistrictCode: "347", sourceName: "Bargarh", officialName: "Baragada" },
  "350": { lgdDistrictCode: "350", sourceName: "Cuttack", officialName: "Kataka" },
  "351": { lgdDistrictCode: "351", sourceName: "Deogarh", officialName: "Debagada" },
  "356": { lgdDistrictCode: "356", sourceName: "Jajapur", officialName: "Jajpur" },
  "359": { lgdDistrictCode: "359", sourceName: "Kandhamal", officialName: "Kandhamala" },
  "360": { lgdDistrictCode: "360", sourceName: "Kendrapara", officialName: "Kendrapada" },
  "367": { lgdDistrictCode: "367", sourceName: "Nayagarh", officialName: "Nayagada" },
  "372": { lgdDistrictCode: "372", sourceName: "Sonepur", officialName: "Subarnapur" },
  "373": { lgdDistrictCode: "373", sourceName: "Sundargarh", officialName: "Sundaragada" },
  "376": { lgdDistrictCode: "376", sourceName: "Dantewada", officialName: "Dakshin Bastar Dantewada" },
  "381": { lgdDistrictCode: "381", sourceName: "Kanker", officialName: "Uttar Bastar Kanker" },
  "382": { lgdDistrictCode: "382", sourceName: "Kabirdham", officialName: "Kabeerdham" },
  "405": { lgdDistrictCode: "405", sourceName: "East Nimar", officialName: "Khandwa (East Nimar)" },
  "414": { lgdDistrictCode: "414", sourceName: "Khargone", officialName: "Khargone (West Nimar)" },
  "418": { lgdDistrictCode: "418", sourceName: "Narsinghpur", officialName: "Narsimhapur" },
  "438": { lgdDistrictCode: "438", sourceName: "Ahmadabad", officialName: "Ahmedabad" },
  "444": { lgdDistrictCode: "444", sourceName: "Dang", officialName: "Dangs" },
  "445": { lgdDistrictCode: "445", sourceName: "Dohad", officialName: "Dahod" },
  "466": { lgdDistrictCode: "466", sourceName: "Ahmednagar", officialName: "Ahilyanagar" },
  "469": { lgdDistrictCode: "469", sourceName: "Aurangabad", officialName: "Chhatrapati Sambhajinagar" },
  "488": { lgdDistrictCode: "488", sourceName: "Osmanabad", officialName: "Dharashiv" },
  "502": { lgdDistrictCode: "502", sourceName: "Anantapur", officialName: "Ananthapuramu" },
  "504": { lgdDistrictCode: "504", sourceName: "Y.S.R.", officialName: "Y.S.R. Kadapa" },
  "515": { lgdDistrictCode: "515", sourceName: "Spsr Nellore", officialName: "Sri Potti Sriramulu Nellore" },
  "520": { lgdDistrictCode: "520", sourceName: "Visakhapatanam", officialName: "Visakhapatnam" },
  "531": { lgdDistrictCode: "531", sourceName: "Chamarajanagara", officialName: "Chamarajanagar" },
  "535": { lgdDistrictCode: "535", sourceName: "Davangere", officialName: "Davanagere" },
  "574": { lgdDistrictCode: "574", sourceName: "Kanchipuram", officialName: "Kancheepuram" },
  "594": { lgdDistrictCode: "594", sourceName: "Tuticorin", officialName: "Thoothukkudi" },
  "596": { lgdDistrictCode: "596", sourceName: "Villupuram", officialName: "Viluppuram" },
  "600": { lgdDistrictCode: "600", sourceName: "Pondicherry", officialName: "Puducherry" },
  "631": { lgdDistrictCode: "631", sourceName: "Ramanagara", officialName: "Bengaluru South" },
  "644": { lgdDistrictCode: "644", sourceName: "Baloda Bazar", officialName: "Balodabazar-Bhatapara" },
  "649": { lgdDistrictCode: "649", sourceName: "Balrampur", officialName: "Balrampur-Ramanujganj" },
  "667": { lgdDistrictCode: "667", sourceName: "Agar Malwa", officialName: "Agar-Malwa" },
  "701": { lgdDistrictCode: "701", sourceName: "Charki Dadri", officialName: "Charkhi Dadri" },
  "734": { lgdDistrictCode: "734", sourceName: "Gaurella Pendra Marwahi", officialName: "Gaurela-Pendra-Marwahi" },
  "738": { lgdDistrictCode: "738", sourceName: "Vijayanagar", officialName: "Vijayanagara" },
  "747": { lgdDistrictCode: "747", sourceName: "Konaseema", officialName: "Dr. B.R. Ambedkar Konaseema" },
  "759": { lgdDistrictCode: "759", sourceName: "Khairgarh Chhuikhadan Gandai", officialName: "Khairagarh-Chhuikhadan-Gandai" },
  "760": { lgdDistrictCode: "760", sourceName: "Manendragarh Chirimiri Bharatpur", officialName: "Manendragarh-Chirmiri-Bharatpur(M C B)" },
  "761": { lgdDistrictCode: "761", sourceName: "Mohla Manpur Ambagarh Chouki", officialName: "Mohla-Manpur-Ambagarh Chouki" },
  "763": { lgdDistrictCode: "763", sourceName: "Sarangarh Bilaigarh", officialName: "Sarangarh-Bilaigarh" },
  "768": { lgdDistrictCode: "768", sourceName: "Didwana Kuchaman", officialName: "Didwana-Kuchaman" },
};

/**
 * Preferred user-facing district name: the official/latest LGD name when the district was
 * reconciled to a differing name, otherwise the unchanged source/map name.
 */
export function officialDistrictName(districtId: string, sourceName: string): string {
  return DISTRICT_NAME_OVERRIDES[districtId]?.officialName ?? sourceName;
}

/**
 * The source/map name for a district when it was overridden — used as a search fallback and
 * for honest provenance in the panel. Returns null when there is no override (the source name
 * is already the display name).
 */
export function overriddenSourceName(districtId: string): string | null {
  return DISTRICT_NAME_OVERRIDES[districtId]?.sourceName ?? null;
}
