import { z } from 'zod';

/**
 * The shared data contract. The pipeline validates on write; the frontend validates the
 * same shapes on read. Defined once so documentation cannot drift from data.
 */

export const DistrictStatus = z.enum([
  'active', // in the LGD roster and has geometry
  'no_boundary_published', // in the roster, no polygon exists anywhere (e.g. Ladakh's 5)
  'dissolved', // polygon exists, no longer in the roster (e.g. Rajasthan's 9)
  'unreconciled', // roster not yet fetched — status genuinely unknown, never guessed
]);
export type DistrictStatusT = z.infer<typeof DistrictStatus>;

/** Canonical district record. `geometry` lives in the TopoJSON, keyed by `districtId`. */
export const DistrictRecord = z.object({
  districtId: z.string().min(1),
  districtName: z.string().min(1),
  stateId: z.string().min(1),
  stateName: z.string().min(1),
  sourceVintage: z.string().nullable(),

  sourceDistrictName: z.string(),
  sourceStateName: z.string(),
  censusDistrictCode: z.string().nullable(),
  censusStateCode: z.string().nullable(),
  areaKm2: z.number().positive().nullable(),
  administered: z.boolean(),
  hasGeometry: z.boolean(),
  status: DistrictStatus,
});
export type DistrictRecordT = z.infer<typeof DistrictRecord>;

export const StateRecord = z.object({
  stateId: z.string().min(1),
  stateName: z.string().min(1),
  sourceStateName: z.string(),
  isUnionTerritory: z.boolean(),
  districtCount: z.number().int().nonnegative(),
});
export type StateRecordT = z.infer<typeof StateRecord>;

export const Hierarchy = z.object({
  vintage: z.string(),
  generatedAt: z.string(),
  reconciliation: z.object({
    rosterAvailable: z.boolean(),
    mode: z.enum(['complete', 'partial']),
    note: z.string(),
  }),
  counts: z.object({
    states: z.number().int(),
    districts: z.number().int(),
    districtsWithGeometry: z.number().int(),
    unadministered: z.number().int(),
  }),
  states: z.array(
    StateRecord.extend({ districts: z.array(DistrictRecord) }),
  ),
});
export type HierarchyT = z.infer<typeof Hierarchy>;

export const SourceEntry = z.object({
  id: z.string(),
  role: z.string(),
  title: z.string(),
  url: z.string().url(),
  licence: z.string().optional(),
  sha256: z.string().nullable().optional(),
  bytes: z.number().optional(),
});

export const Manifest = z.object({
  vintage: z.string(),
  generatedAt: z.string(),
  generator: z.string(),
  reconciliation: z.object({
    rosterAvailable: z.boolean(),
    mode: z.enum(['complete', 'partial']),
    note: z.string(),
  }),
  counts: z.object({
    districtFeatures: z.number().int(),
    states: z.number().int(),
    unionTerritories: z.number().int(),
    unadministeredDistricts: z.number().int(),
    districtsWithoutGeometry: z.number().int(),
  }),
  geometry: z.object({
    crs: z.literal('EPSG:4326'),
    equalAreaProjection: z.string(),
    sumOfPartsKm2: z.number(),
    dissolvedUnionKm2: z.number(),
    overlapKm2: z.number(),
    officialIndiaAreaKm2: z.number(),
    unionDeltaPct: z.number(),
    bbox: z.array(z.number()).length(4),
  }),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      licence: z.string(),
      sha256: z.string().nullable(),
      bytes: z.number().nullable(),
      attribution: z.record(z.unknown()).optional(),
    }),
  ),
  licences: z.array(z.string()),
  knownGaps: z.array(
    z.object({ id: z.string(), summary: z.string(), detail: z.string(), source: z.string() }),
  ),
  knownGeometryIssues: z.array(
    z.object({ id: z.string(), summary: z.string(), detail: z.string() }),
  ),
  outputs: z.record(z.object({ bytes: z.number(), sha256: z.string() })),
});
export type ManifestT = z.infer<typeof Manifest>;

/** One record of the OGD LGD district roster, after normalisation. */
export const AdminDistrictRecord = z.object({
  districtId: z.string().min(1),
  districtName: z.string().min(1),
  stateId: z.string().min(1),
  stateName: z.string().min(1),
});
export type AdminDistrictRecordT = z.infer<typeof AdminDistrictRecord>;

export const AdminRoster = z.object({
  fetchedAt: z.string(),
  resourceId: z.string(),
  endpoint: z.string(),
  licence: z.string(),
  total: z.number().int(),
  records: z.array(AdminDistrictRecord),
});
export type AdminRosterT = z.infer<typeof AdminRoster>;
