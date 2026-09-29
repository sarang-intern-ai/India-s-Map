import { useDatasetRecords } from '../../state/datasetRecords.tsx';
import { DatasetPanel } from './DatasetPanel.tsx';

/**
 * The per-state aggregated dataset panels. Reads the state's pre-computed aggregates (keyed by the
 * canonical stateId derived from the geographic hierarchy, never a spreadsheet state name) and
 * renders the SAME generic {@link DatasetPanel} per datasetType — totals-only, summed unit-aware
 * from every district in the state.
 *
 * There are no state totals in the spreadsheet: these are derived from the atomic district rows.
 */
export function StateDatasets({ stateId }: { stateId: string }) {
  const { status, bundle, stateAggregates } = useDatasetRecords();

  if (!bundle) {
    return status === 'loading' ? <p className="text-xs text-ink-400">Loading datasets…</p> : null;
  }

  const aggregates = stateAggregates.get(stateId) ?? [];
  if (aggregates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
        No dataset data available for this state.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {aggregates.map((aggregate) => (
        <DatasetPanel key={aggregate.datasetType} aggregate={aggregate} showSubcategories={false} />
      ))}
    </div>
  );
}
