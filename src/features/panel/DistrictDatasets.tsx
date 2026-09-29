import { useDatasetRecords } from '../../state/datasetRecords.tsx';
import { DatasetPanel } from './DatasetPanel.tsx';

/**
 * The per-district dataset panels. Reads the district's pre-computed aggregates (keyed by the
 * canonical districtId, never a name) and renders one generic {@link DatasetPanel} per datasetType
 * — unit-aware totals plus the atomic subType rows. Hard-codes NO dataset type or subType.
 *
 * Read-only, and completely separate from the user's editable localStorage tree.
 */
export function DistrictDatasets({ districtId }: { districtId: string }) {
  const { status, bundle, districtAggregates } = useDatasetRecords();

  // No bundle yet: either the first load is in flight, or the source failed before any data
  // arrived (the source bar shows that error). Show a quiet placeholder, never fake values.
  if (!bundle) {
    return status === 'loading' ? <p className="text-xs text-ink-400">Loading datasets…</p> : null;
  }

  const aggregates = districtAggregates.get(districtId) ?? [];
  if (aggregates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
        No dataset data available for this district.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {aggregates.map((aggregate) => (
        <DatasetPanel
          key={aggregate.datasetType}
          aggregate={aggregate}
          showSubcategories
          // Speech reads as a district summary (HOURS TOTAL / STATIONS TOTAL); its per-station detail
          // — joined with Speech hours, language and location — lives in the CRS DATA cards below.
          hideSubtypeRows={aggregate.datasetType === 'Speech'}
        />
      ))}
    </div>
  );
}
