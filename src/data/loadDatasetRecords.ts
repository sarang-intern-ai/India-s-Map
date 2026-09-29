import type { DatasetProvider } from './datasetProvider.ts';
import {
  groupByDistrictId,
  type DatasetDiagnostic,
  type DatasetRecord,
} from './datasetRecords.ts';

export type DatasetBundle = {
  /** All normalized records, in source order, merged across every provider. */
  records: DatasetRecord[];
  /** districtId → its records. The canonical lookup the DistrictPanel reads. */
  byDistrict: Map<string, DatasetRecord[]>;
  /** Every problem found: malformed rows, unknown ids, duplicates. Never thrown away. */
  diagnostics: DatasetDiagnostic[];
  /** Provider labels that contributed, for honest provenance in the UI. */
  sources: { id: string; label: string }[];
};

/**
 * Load dataset records from one or more providers and normalize them into a single grouped
 * bundle. This is the layer where cross-source facts live — duplicate detection and unknown
 * districtId checks need the full merged set and the known-district universe, which no single
 * provider has.
 *
 *   sources → providers → DatasetRecord[] (merged) → group by districtId → UI
 *
 * The UI depends only on {@link DatasetBundle}. Adding Google Sheets, Excel or a database means
 * passing a different provider; this function and everything above it are unchanged.
 *
 * @param knownDistrictIds the canonical id universe (dataset.districtsById keys), used only to
 *   FLAG records pointing at ids that do not exist — never to invent or drop data.
 */
export async function loadDatasetRecords(
  providers: DatasetProvider[],
  knownDistrictIds: ReadonlySet<string>,
): Promise<DatasetBundle> {
  const diagnostics: DatasetDiagnostic[] = [];
  const records: DatasetRecord[] = [];
  const sources: { id: string; label: string }[] = [];

  for (const provider of providers) {
    sources.push({ id: provider.id, label: provider.label });
    try {
      const result = await provider.load();
      records.push(...result.records);
      diagnostics.push(...result.diagnostics);
    } catch (e: unknown) {
      diagnostics.push({
        level: 'error',
        code: 'provider_failed',
        message: `Provider "${provider.id}" threw: ${e instanceof Error ? e.message : String(e)}.`,
        source: provider.id,
      });
    }
  }

  // Unknown districtId — a record that will never match a real district. Report once per id.
  const unknownCounts = new Map<string, number>();
  for (const r of records) {
    if (!knownDistrictIds.has(r.districtId)) {
      unknownCounts.set(r.districtId, (unknownCounts.get(r.districtId) ?? 0) + 1);
    }
  }
  for (const [districtId, count] of unknownCounts) {
    diagnostics.push({
      level: 'warning',
      code: 'unknown_district',
      message: `districtId "${districtId}" is not in the current dataset (${count} record(s)). ` +
        `These will not appear under any district. Check the id — names are never matched.`,
    });
  }

  // Duplicates — same (districtId, datasetType, subType) appearing more than once. We do NOT
  // sum or overwrite (the model does not define that); both rows are kept and the collision is
  // flagged so a data author can resolve it deliberately. The parts are stored alongside the
  // count so the message never has to re-split a delimited key.
  type DupEntry = { count: number; districtId: string; datasetType: string; subType: string };
  const dupCounts = new Map<string, DupEntry>();
  for (const r of records) {
    const key = JSON.stringify([r.districtId, r.datasetType, r.subType]);
    const existing = dupCounts.get(key);
    if (existing) existing.count += 1;
    else dupCounts.set(key, { count: 1, districtId: r.districtId, datasetType: r.datasetType, subType: r.subType });
  }
  for (const { count, districtId, datasetType, subType } of dupCounts.values()) {
    if (count > 1) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate',
        message: `Duplicate row: districtId ${districtId} · ${datasetType} · ${subType} appears ` +
          `${count} times. Both are kept and shown; values are not merged.`,
      });
    }
  }

  return {
    records,
    byDistrict: groupByDistrictId(records),
    diagnostics,
    sources,
  };
}
