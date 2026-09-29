import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DistrictRecord } from '../data/schema.ts';

/**
 * Where a selection came from. This is NOT a second selection state — `selectedDistrictId`
 * remains the only answer to "what is selected". The origin answers a different question:
 * "how did it get selected", which is what lets the map decide whether to move the camera.
 *
 *  - 'map'          the user clicked the district on the map. They can already see it, so
 *                   moving the camera under their cursor would be disorienting.
 *  - 'search'       the user picked it from search. It is probably off-screen, so the map
 *                   must navigate to it.
 *  - 'state-panel'  the user picked it from the StatePanel's district list. Off-screen like
 *                   search, so the map navigates. Kept distinct from 'search' so focus/UX
 *                   rules can differ if needed.
 *  - 'programmatic' anything else (deep links, future table/chart interactions). Navigates.
 */
export type SelectionOrigin = 'map' | 'search' | 'state-panel' | 'programmatic';

type SelectionState = {
  districtId: string | null;
  origin: SelectionOrigin;
  /**
   * Increments on every selection action, including re-selecting the district that is
   * already selected. Without it, searching the same district twice would not re-frame the
   * map after the user had panned away — the id would not have changed, so no effect fires.
   */
  seq: number;
};

/**
 * An action deferred because a navigation guard blocked it (unsaved edits). It is stored as a
 * thunk so the same guard can protect any draft-losing action — selecting another district,
 * clearing the selection, or changing the State/UT scope out from under a dirty editor.
 */
export type PendingNavigation = { run: () => void };

/**
 * THE canonical selection state.
 *
 * `selectedDistrictId` is the single source of truth for what is selected, anywhere in the
 * app. The map, the search results and the detail panel all read from it and all write to
 * it through `selectDistrict`. There is deliberately no second copy — a map selection and a
 * search selection are the same fact, and duplicating it is how these two views drift apart.
 *
 * A navigation guard lets one consumer (the district data editor) veto a selection change
 * when it has unsaved edits. When vetoed, the requested change is parked in
 * `pendingNavigation` for a confirmation dialog to resolve, rather than being lost.
 */
export type SelectionContextValue = {
  selectedDistrictId: string | null;
  selectedDistrict: DistrictRecord | null;
  selectionOrigin: SelectionOrigin;
  selectionSeq: number;
  selectDistrict: (districtId: string | null, origin?: SelectionOrigin) => void;
  clearSelection: () => void;
  isSelected: (districtId: string) => boolean;

  /**
   * Run an arbitrary action through the same unsaved-edits guard used for selection changes.
   * Used by the shell to gate State/UT scope changes that would drop a dirty district.
   */
  runGuarded: (action: () => void) => void;
  /** Clear the district selection WITHOUT consulting the guard (for use inside a guarded action). */
  forceClearSelection: () => void;

  /** Register a predicate returning true when it is safe to navigate away (no unsaved edits). */
  registerNavigationGuard: (canNavigate: () => boolean) => void;
  clearNavigationGuard: () => void;
  pendingNavigation: PendingNavigation | null;
  confirmPendingNavigation: () => void;
  cancelPendingNavigation: () => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({
  districtsById,
  children,
}: {
  districtsById: Map<string, DistrictRecord>;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<SelectionState>({
    districtId: null,
    origin: 'programmatic',
    seq: 0,
  });
  const [pending, setPendingState] = useState<PendingNavigation | null>(null);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const guardRef = useRef<(() => boolean) | null>(null);

  const setPending = useCallback((p: PendingNavigation | null) => {
    pendingRef.current = p;
    setPendingState(p);
  }, []);

  const apply = useCallback((districtId: string | null, origin: SelectionOrigin) => {
    setSelection((current) => ({ districtId, origin, seq: current.seq + 1 }));
  }, []);

  /** Run `action` immediately, or park it as pending when the guard vetoes (unsaved edits). */
  const guarded = useCallback(
    (action: () => void) => {
      if (guardRef.current && !guardRef.current()) {
        setPending({ run: action });
      } else {
        action();
      }
    },
    [setPending],
  );

  const selectDistrict = useCallback(
    (districtId: string | null, origin: SelectionOrigin = 'programmatic') => {
      guarded(() => apply(districtId, origin));
    },
    [guarded, apply],
  );

  const clearSelection = useCallback(() => {
    guarded(() => apply(null, 'programmatic'));
  }, [guarded, apply]);

  const runGuarded = useCallback((action: () => void) => guarded(action), [guarded]);
  const forceClearSelection = useCallback(() => apply(null, 'programmatic'), [apply]);

  const confirmPendingNavigation = useCallback(() => {
    const p = pendingRef.current;
    setPending(null);
    p?.run();
  }, [setPending]);

  const cancelPendingNavigation = useCallback(() => setPending(null), [setPending]);

  const registerNavigationGuard = useCallback((fn: () => boolean) => {
    guardRef.current = fn;
  }, []);
  const clearNavigationGuard = useCallback(() => {
    guardRef.current = null;
  }, []);

  const value = useMemo<SelectionContextValue>(() => {
    const selectedDistrict =
      selection.districtId === null ? null : (districtsById.get(selection.districtId) ?? null);
    return {
      selectedDistrictId: selection.districtId,
      selectedDistrict,
      selectionOrigin: selection.origin,
      selectionSeq: selection.seq,
      selectDistrict,
      clearSelection,
      isSelected: (districtId: string) => districtId === selection.districtId,
      runGuarded,
      forceClearSelection,
      registerNavigationGuard,
      clearNavigationGuard,
      pendingNavigation: pending,
      confirmPendingNavigation,
      cancelPendingNavigation,
    };
  }, [
    selection,
    districtsById,
    selectDistrict,
    clearSelection,
    runGuarded,
    forceClearSelection,
    registerNavigationGuard,
    clearNavigationGuard,
    pending,
    confirmPendingNavigation,
    cancelPendingNavigation,
  ]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used inside a <SelectionProvider>');
  return ctx;
}
