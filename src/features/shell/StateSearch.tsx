import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { isExactMatch, searchStates, type StateOption } from '../../lib/search.ts';

/**
 * Searchable State/UT selector — the left-most toolbar control. It is a typeahead combobox
 * over the actual loaded State/UT list (never hard-coded); each result shows the official
 * name, a State vs Union Territory label, and the district count. Selection uses the canonical
 * `stateId`, never the name.
 */
export function StateSearch({
  value,
  onSelect,
  states,
}: {
  /** Currently scoped stateId, or '' for all-India. */
  value: string;
  onSelect: (stateId: string) => void;
  states: StateOption[];
}) {
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => states.find((s) => s.stateId === value) ?? null, [states, value]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // While closed, the field shows the selected State/UT name; typing overrides it.
  const displayValue = open ? query : (selected?.stateName ?? '');
  const results = useMemo(() => searchStates(open ? query : '', states), [open, query, states]);

  useEffect(() => setActiveIndex(-1), [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const commit = (stateId: string) => {
    onSelect(stateId);
    setOpen(false);
    setActiveIndex(-1);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
        setQuery('');
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + delta;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      if (!open) return;
      const hit = results[activeIndex >= 0 ? activeIndex : 0];
      if (hit) {
        e.preventDefault();
        commit(hit.state.stateId);
      }
      return;
    }
    if (e.key === 'Home' && open && results.length) {
      e.preventDefault();
      setActiveIndex(0);
    }
    if (e.key === 'End' && open && results.length) {
      e.preventDefault();
      setActiveIndex(results.length - 1);
    }
  };

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    listRef.current
      .querySelector(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <div ref={rootRef} className="relative min-w-56 flex-1">
      <label htmlFor={inputId} className="mb-1 block text-[11px] font-medium text-ink-500">
        State / UT
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
          value={displayValue}
          placeholder="All States / UTs"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded-md border border-ink-300 bg-white py-1.5 pr-8 pl-8 text-sm text-ink-900 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none"
        />

        {value !== '' && (
          <button
            type="button"
            aria-label="Clear State/UT scope"
            onClick={() => commit('')}
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
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-500">
              No State/UT matches{' '}
              <span className="font-medium text-ink-700">“{query.trim()}”</span>.
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="State and Union Territory results"
              className="max-h-80 overflow-y-auto py-1"
            >
              {results.map((hit, i) => {
                const active = i === activeIndex;
                const s = hit.state;
                return (
                  <li key={s.stateId} role="presentation">
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={active}
                      data-row-index={i}
                      onMouseEnter={() => setActiveIndex(i)}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        commit(s.stateId);
                      }}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                        active ? 'bg-accent-100' : ''
                      } ${
                        s.stateId === value
                          ? 'border-l-2 border-accent-600'
                          : 'border-l-2 border-transparent'
                      }`}
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm text-ink-900">{s.stateName}</span>
                        {isExactMatch(hit.kind) && (
                          <span className="shrink-0 rounded-sm bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-900">
                            exact
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2 text-xs">
                        <span className="text-ink-500">{s.isUnionTerritory ? 'UT' : 'State'}</span>
                        <span className="tabular text-ink-400">{s.districtCount} districts</span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
