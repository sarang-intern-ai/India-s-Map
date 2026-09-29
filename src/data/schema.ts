import { z } from 'zod';

/**
 * Mirrors pipeline/lib/schema.ts. The pipeline validates on write; we validate on read, so
 * a malformed or half-generated dataset surfaces as a clear error rather than a blank map.
 *
 * Keep in sync with the pipeline. If these disagree, the pipeline is right.
 */

export const DistrictStatus = z.enum([
  'active',
  'no_boundary_published',
  'dissolved',
  'unreconciled',
]);
export type DistrictStatus = z.infer<typeof DistrictStatus>;

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
  areaKm2: z.number().nullable(),
  administered: z.boolean(),
  hasGeometry: z.boolean(),
  status: DistrictStatus,
});
export type DistrictRecord = z.infer<typeof DistrictRecord>;

export const StateGroup = z.object({
  stateId: z.string().min(1),
  stateName: z.string().min(1),
  sourceStateName: z.string(),
  isUnionTerritory: z.boolean(),
  districtCount: z.number().int().nonnegative(),
  districts: z.array(DistrictRecord),
});
export type StateGroup = z.infer<typeof StateGroup>;

export const Reconciliation = z.object({
  rosterAvailable: z.boolean(),
  mode: z.enum(['complete', 'partial']),
  note: z.string(),
});
export type Reconciliation = z.infer<typeof Reconciliation>;

export const Hierarchy = z.object({
  vintage: z.string(),
  generatedAt: z.string(),
  reconciliation: Reconciliation,
  counts: z.object({
    states: z.number().int(),
    districts: z.number().int(),
    districtsWithGeometry: z.number().int(),
    unadministered: z.number().int(),
  }),
  states: z.array(StateGroup),
});
export type Hierarchy = z.infer<typeof Hierarchy>;

/**
 * Only the manifest fields the UI actually reads. Deliberately loose elsewhere: the
 * manifest is allowed to grow without breaking the frontend.
 */
export const Manifest = z
  .object({
    vintage: z.string(),
    generatedAt: z.string(),
    reconciliation: Reconciliation,
    counts: z.object({
      districtFeatures: z.number().int(),
      states: z.number().int(),
      unionTerritories: z.number().int(),
      unadministeredDistricts: z.number().int(),
      districtsWithoutGeometry: z.number().int(),
    }),
    geometry: z.object({
      crs: z.string(),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    }),
    sources: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        licence: z.string(),
      }),
    ),
    licences: z.array(z.string()),
    knownGaps: z.array(
      z.object({ id: z.string(), summary: z.string(), detail: z.string(), source: z.string() }),
    ),
    knownGeometryIssues: z.array(
      z.object({ id: z.string(), summary: z.string(), detail: z.string() }),
    ),
  })
  .loose();
export type Manifest = z.infer<typeof Manifest>;

/** Properties carried on each district feature in districts.topo.json. */
export const DistrictFeatureProperties = z.object({
  districtId: z.string().min(1),
  districtName: z.string(),
  stateId: z.string().min(1),
  stateName: z.string(),
  sourceVintage: z.string().nullable(),
  administered: z.boolean(),
});
export type DistrictFeatureProperties = z.infer<typeof DistrictFeatureProperties>;
