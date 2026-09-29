import { useId, useMemo, useState } from 'react';
import type { DistrictRecord } from '../../data/schema.ts';
import { districtDisplayName, searchAll, type StateOption } from '../../lib/search.ts';
import { useSelection } from '../../state/selection.tsx';
import { StateDatasets } from './StateDatasets.tsx';
import { DatasetSourceBar } from './DatasetSourceBar.tsx';

/**
 * The State/UT panel: header (name, State/UT label, district count, LGD state code, close) and
 * a district list for the selected State/UT with its own search box. Selecting a district here
 * opens the DistrictPanel below without replacing this panel.
 *
 * It reuses the existing panel visual language and the existing search ranking — the only
 * difference from the toolbar district search is that the candidate set is scoped to this one
 * State/UT (`searchAll` with `stateFilter`), so results can never leak in from another state.
 *
 * No fabricated statistics: only administrative facts already in the dataset are shown. A
 * clearly-marked placeholder marks where future state-level data would go.
 */
export function StatePanel({
  state,
  districts,
  states,
  onClose,
}: {
  state: StateOption;
  districts: DistrictRecord[];
  states: StateOption[];
  onClose: () => void;
}) {
  const headingId = useId();
  const searchId = useId();
  const { selectDistrict, selectedDistrictId } = useSelection();
  const [query, setQuery] = useState('');

  // Scoped to this State/UT via the existing search. A high limit means the empty query lists
  // every district in the state (browsable), and a query filters within the same set.
  const results = useMemo(
    () =>
      searchAll(query, {
        districts,
        states,
        stateFilter: state.stateId,
        districtLimit: Number.MAX_SAFE_INTEGER,
      }),
    [query, districts, states, state.stateId],
  );

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="rp-panel relative flex h-full min-h-0 flex-col bg-white"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close State/UT panel"
        className="absolute top-3 right-3 z-10 grid h-7 w-7 place-items-center rounded-md text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ✕
        </span>
      </button>

      <header className="shrink-0 border-b border-ink-200 bg-white px-4 pt-3 pb-3 pr-12">
        <h2 id={headingId} className="text-xl leading-tight font-semibold tracking-tight text-brand-800">
          {state.stateName}
        </h2>
        <p className="mt-0.5 text-sm text-ink-600">
          {state.isUnionTerritory ? 'Union Territory' : 'State'}
        </p>
        <p className="tabular mt-1.5 text-[11px] font-medium tracking-wide text-ink-400">
          {state.districtCount} districts · LGD state code {state.stateId}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* External datasets — aggregated up from this state's district records. Derived, not
            stored in the sheet; read-only; the same generic DatasetPanel the district view uses. */}
        <section className="border-b border-ink-100 px-4 pt-3 pb-3">
          <h3 className="mb-1 border-b border-ink-200 pb-1.5 text-[11px] font-semibold tracking-wider text-brand-700 uppercase">
            External datasets
          </h3>
          <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
            Totals aggregated from this state’s district records — unit-aware, derived, read-only.
          </p>
          <DatasetSourceBar compact />
          <StateDatasets stateId={state.stateId} />
        </section>

        {/* Districts: the search stays pinned while the list (and the datasets above) scroll. */}
        <div className="sticky top-0 z-[1] border-b border-ink-100 bg-white px-4 pt-3 pb-2">
          <label htmlFor={searchId} className="mb-1 block text-[11px] font-semibold tracking-wider text-brand-700 uppercase">
            Districts
          </label>
          <input
            id={searchId}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search districts in ${state.stateName}…`}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none"
          />
        </div>

        <div className="px-2 pt-2 pb-3">
          {results.districts.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-500">
              No districts in {state.stateName} match{' '}
              <span className="font-medium text-ink-700">“{query.trim()}”</span>.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.districts.map(({ record }) => {
                const name = districtDisplayName(record);
                const isActive = record.districtId === selectedDistrictId;
                return (
                  <li key={record.districtId}>
                    <button
                      type="button"
                      onClick={() => selectDistrict(record.districtId, 'state-panel')}
                      aria-label={`Open ${name} district`}
                      aria-current={isActive ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition focus:ring-2 focus:ring-accent-200 focus:outline-none ${
                        isActive
                          ? 'bg-accent-100 text-accent-900'
                          : 'text-ink-800 hover:bg-ink-50'
                      }`}
                    >
                      <span className="truncate text-sm">{name}</span>
                      <span className="tabular shrink-0 text-xs text-ink-400">
                        {record.administered ? record.districtId : 'no code'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
