import type { DistrictRecord } from '../../data/schema.ts';
import type { StateOption } from '../../lib/search.ts';
import type { MapMode } from '../map/mapTheme.ts';
import { DistrictSearch } from './DistrictSearch.tsx';
import { StateSearch } from './StateSearch.tsx';

export type Filters = { query: string; stateId: string };
export const EMPTY_FILTERS: Filters = { query: '', stateId: '' };

/**
 * Top toolbar. Controls read left-to-right: [ State/UT search ] [ District search ]
 * [ Reset filters ] [ count ]. The State/UT search is the primary way to scope to a state;
 * the district search is scoped to that state automatically once one is chosen.
 *
 * State/UT scope changes go through `onStateScopeChange`, which the shell routes through the
 * unsaved-edits guard (changing scope can drop a dirty district). Plain query typing does not
 * lose drafts, so it stays a direct update.
 */
export function Toolbar({
  query,
  onQueryChange,
  stateId,
  onStateScopeChange,
  onReset,
  states,
  districts,
  totalDistricts,
  mapMode,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  stateId: string;
  onStateScopeChange: (stateId: string) => void;
  onReset: () => void;
  states: StateOption[];
  districts: DistrictRecord[];
  totalDistricts: number;
  mapMode: MapMode;
}) {
  const activeState = states.find((s) => s.stateId === stateId);
  const isFiltered = query.trim() !== '' || stateId !== '';

  return (
    <div className="relative z-20 flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2 border-b border-ink-200 bg-white px-5 py-3">
      <StateSearch value={stateId} onSelect={onStateScopeChange} states={states} />

      <DistrictSearch
        query={query}
        onQueryChange={onQueryChange}
        stateFilter={stateId}
        onStateFilterChange={onStateScopeChange}
        districts={districts}
        states={states}
        mapMode={mapMode}
      />

      <button
        type="button"
        onClick={onReset}
        disabled={!isFiltered}
        title="Clears the search box and the State/UT scope. Your selected district is kept."
        className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 shadow-xs transition hover:border-ink-400 hover:bg-ink-50 focus:ring-2 focus:ring-accent-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        Reset filters
      </button>

      <p className="tabular ml-auto self-end pb-1.5 text-xs text-ink-500" aria-live="polite">
        {activeState ? (
          <>
            Showing <span className="font-medium text-ink-700">{activeState.districtCount}</span>{' '}
            districts in {activeState.stateName}
          </>
        ) : (
          <>
            <span className="font-medium text-ink-700">{totalDistricts}</span> districts across
            India
          </>
        )}
      </p>
    </div>
  );
}
