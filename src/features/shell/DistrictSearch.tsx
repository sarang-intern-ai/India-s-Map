import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSelection } from '../../state/selection.tsx';
import {
  districtDisplayName,
  isExactMatch,
  searchAll,
  type SearchResults,
  type StateOption,
} from '../../lib/search.ts';
import type { DistrictRecord } from '../../data/schema.ts';
import type { MapMode } from '../map/mapTheme.ts';

/** One row in the flattened keyboard-navigable list (states first, then districts). */
type Row =
  | { type: 'state'; key: string; state: StateOption; exact: boolean }
  | { type: 'district'; key: string; record: DistrictRecord; exact: boolean };

function flatten(results: SearchResults): Row[] {
  return [
    ...results.states.map((h) => ({
      type: 'state' as const,
      key: `s:${h.state.stateId}`,
      state: h.state,
      exact: isExactMatch(h.kind),
    })),
    ...results.districts.map((h) => ({
      type: 'district' as const,
      key: `d:${h.record.districtId}`,
      record: h.record,
      exact: isExactMatch(h.kind),
    })),
  ];
}

export function DistrictSearch({
  query,
  onQueryChange,
  stateFilter,
  onStateFilterChange,
  districts,
  states,
  mapMode,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  stateFilter: string;
  onStateFilterChange: (stateId: string) => void;
  districts: DistrictRecord[];
  states: StateOption[];
  mapMode: MapMode;
}) {
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Search writes to the same canonical selection the map does. The 'search' origin is what
  // tells the map to navigate; there is no second camera path.
  const { selectDistrict, selectedDistrictId } = useSelection();

  const results = useMemo(
    () => searchAll(query, { districts, states, stateFilter }),
    [query, districts, states, stateFilter],
  );
  const rows = useMemo(() => flatten(results), [results]);

  // Any change to the result set invalidates the highlighted index.
  useEffect(() => setActiveIndex(-1), [query, stateFilter]);

  // Close when focus or a click leaves the combobox.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const commit = (row: Row) => {
    if (row.type === 'district') {
      selectDistrict(row.record.districtId, 'search');
      // Standard combobox behaviour: reflect the choice in the field and keep it editable.
      onQueryChange(districtDisplayName(row.record));
    } else {
      onStateFilterChange(row.state.stateId);
      onQueryChange('');
    }
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        // Stop the event reaching the panel's window-level Escape handler, so the first
        // Escape only closes this dropdown. A second Escape (dropdown now closed) is allowed
        // to bubble and close the panel — a deliberate two-stage behaviour.
        e.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (rows.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + delta;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      if (!open) return;
      // Enter with nothing highlighted takes the first result — the common case of typing
      // a full district name and pressing Enter.
      const row = rows[activeIndex >= 0 ? activeIndex : 0];
      if (row) {
        e.preventDefault();
        commit(row);
      }
      return;
    }
    if (e.key === 'Home' && open && rows.length) {
      e.preventDefault();
      setActiveIndex(0);
    }
    if (e.key === 'End' && open && rows.length) {
      e.preventDefault();
      setActiveIndex(rows.length - 1);
    }
  };

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    listRef.current
      .querySelector(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const hasRows = rows.length > 0;
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <div ref={rootRef} className="relative min-w-64 flex-1">
      <label htmlFor={inputId} className="mb-1 block text-[11px] font-medium text-ink-500">
        Search district or State/UT
        {mapMode === 'state' && (
          <span className="ml-1.5 font-normal text-ink-400">· choosing a district switches to District view</span>
        )}
      </label>

      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-ink-400"
        >
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M13.2 13.2 L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder="e.g. Pune, Delhi, or LGD code 490"
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-md border border-ink-300 bg-white py-1.5 pr-8 pl-8 text-sm text-ink-900 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none"
        />

        {query !== '' && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute top-1/2 right-1.5 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
          >
            <span aria-hidden="true" className="text-xs leading-none">
              ✕
            </span>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 z-40 mt-1.5 w-full overflow-hidden rounded-lg border border-ink-200 bg-white shadow-xl">
          {!hasRows ? (
            <p className="px-3 py-3 text-sm text-ink-500">
              {query.trim() === ''
                ? 'Type a district name, a State/UT, or an LGD code.'
                : (
                  <>
                    No district or State/UT matches{' '}
                    <span className="font-medium text-ink-700">“{query.trim()}”</span>.
                  </>
                )}
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Search results"
              className="max-h-80 overflow-y-auto py-1"
            >
              {results.states.length > 0 && (
                <li
                  role="presentation"
                  className="px-3 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-ink-400 uppercase"
                >
                  States &amp; Union Territories
                </li>
              )}

              {rows.map((row, i) => {
                const active = i === activeIndex;
                const isFirstDistrict =
                  row.type === 'district' && i === results.states.length && results.states.length > 0;
                return (
                  <li key={row.key} role="presentation">
                    {isFirstDistrict && (
                      <div className="mt-1 border-t border-ink-100 px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">
                        Districts
                      </div>
                    )}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={active}
                      data-row-index={i}
                      onMouseEnter={() => setActiveIndex(i)}
                      onPointerDown={(e) => {
                        // pointerdown so the outside-click handler does not close the list
                        // before the click lands.
                        e.preventDefault();
                        commit(row);
                      }}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                        active ? 'bg-accent-100' : ''
                      } ${
                        row.type === 'district' && row.record.districtId === selectedDistrictId
                          ? 'border-l-2 border-accent-600'
                          : 'border-l-2 border-transparent'
                      }`}
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm text-ink-900">
                          {row.type === 'state' ? row.state.stateName : districtDisplayName(row.record)}
                        </span>
                        {row.exact && (
                          <span className="shrink-0 rounded-sm bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-900">
                            exact
                          </span>
                        )}
                      </span>

                      <span className="flex shrink-0 items-baseline gap-2 text-xs">
                        {row.type === 'state' ? (
                          <>
                            <span className="text-ink-500">
                              {row.state.isUnionTerritory ? 'UT' : 'State'}
                            </span>
                            <span className="tabular text-ink-400">
                              {row.state.districtCount} districts
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="max-w-32 truncate text-ink-500">
                              {row.record.stateName}
                            </span>
                            <span className="tabular w-14 text-right text-ink-400">
                              {row.record.administered ? row.record.districtId : 'no code'}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasRows && (
            <div className="flex items-center justify-between border-t border-ink-100 bg-ink-50 px-3 py-1.5 text-[11px] text-ink-500">
              <span className="tabular">
                {results.truncated
                  ? `Showing ${results.districts.length} of ${results.totalDistricts} districts`
                  : `${results.totalDistricts} district${results.totalDistricts === 1 ? '' : 's'}`}
              </span>
              <span aria-hidden="true">↑↓ move · ↵ select · esc close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
