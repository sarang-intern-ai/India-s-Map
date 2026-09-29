import { z } from 'zod';

/**
 * The normalized, source-agnostic dataset contract.
 *
 * Every dataset source (the local demo CSV today; Google Sheets / Excel / a database later)
 * is reduced to an array of these records. Nothing downstream — grouping, the DistrictPanel,
 * the dynamic DatasetPanels — knows or cares where a record came from. Replacing the source
 * is swapping a {@link DatasetProvider}, never touching this shape or the UI that reads it.
 *
 * This is deliberately LONG-FORM (one row per district × datasetType × subType), not a wide
 * per-metric object. Wide shapes (`youtubeHours`, `newspaperWords`, …) become unmaintainable
 * the moment a new dataset type appears; a long-form row model absorbs new types and new
 * subcategories as data, with no code change.
 */

/**
 * A value can be a number, free text, or a boolean — not every dataset is numeric. The unit
 * is carried alongside as its own field (see {@link DatasetRecord.unit}); it is never inferred
 * from the subType.
 */
export const DatasetValue = z.union([z.number(), z.string().min(1), z.boolean()]);
export type DatasetValue = z.infer<typeof DatasetValue>;

export const DatasetRecord = z.object({
  /**
   * Canonical districtId (=== String(dist_lgd), or "unadministered:"+dtcode11). This is the
   * ONLY join key. District name is never used to match — see `districtName` below.
   */
  districtId: z.string().min(1),
  /** e.g. "Speech", "Text", "Video". Free-form; the source defines the vocabulary. */
  datasetType: z.string().min(1),
  /** e.g. "YouTube", "Newspapers", "Television". Free-form; the source defines it. */
  subType: z.string().min(1),
  /** number | text | boolean. See {@link DatasetValue}. */
  value: DatasetValue,
  /**
   * Unit is DATA, defined by the source ("hours", "words", "documents", …). It may be empty
   * for boolean/text values. The UI never hard-codes a unit for a subType, and V1 never
   * converts between units — it renders exactly what the source provides.
   */
  unit: z.string(),
  /**
   * Optional, human-readability only. Present so a sheet can carry a friendly name next to the
   * id, but it is NEVER a join key — display always resolves from `districtId` through the
   * official/latest LGD reconciliation. A stale name here (e.g. "Aurangabad" for id 469) is
   * harmless: it is ignored.
   */
  districtName: z.string().optional(),
  source: z.string().optional(),
  lastUpdated: z.string().optional(),
  notes: z.string().optional(),
});
export type DatasetRecord = z.infer<typeof DatasetRecord>;

/**
 * A problem found while loading dataset records. Nothing is ever silently dropped — malformed
 * rows, unknown district ids and duplicates all surface here so a data author can fix the
 * source rather than wonder why a value vanished.
 */
export type DatasetDiagnostic = {
  level: 'error' | 'warning';
  /** Machine-stable tag, e.g. 'malformed_row', 'unknown_district', 'duplicate'. */
  code: string;
  /** Human-readable, ready to log or show in a dev panel. */
  message: string;
  /** Originating source id (provider id), when applicable. */
  source?: string;
};

/**
 * Group records by datasetType, preserving first-seen order of both the types and the records
 * within each type. Ordering is intentionally NOT alphabetical: the source's row order is the
 * display order until an explicit ordering column is added to the schema later.
 */
export function groupByDatasetType(records: DatasetRecord[]): Map<string, DatasetRecord[]> {
  const byType = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const bucket = byType.get(r.datasetType);
    if (bucket) bucket.push(r);
    else byType.set(r.datasetType, [r]);
  }
  return byType;
}

/**
 * Group a flat record array by districtId, preserving first-seen order. The returned map is
 * the canonical lookup the DistrictPanel uses: `byDistrict.get(districtId)`.
 */
export function groupByDistrictId(records: DatasetRecord[]): Map<string, DatasetRecord[]> {
  const byDistrict = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const bucket = byDistrict.get(r.districtId);
    if (bucket) bucket.push(r);
    else byDistrict.set(r.districtId, [r]);
  }
  return byDistrict;
}
