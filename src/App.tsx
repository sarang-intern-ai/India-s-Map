import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDataset, type Dataset } from './data/loadDataset.ts';
import { SelectionProvider, useSelection } from './state/selection.tsx';
import { DatasetRecordsProvider, useDatasetRecords } from './state/datasetRecords.tsx';
import { Header } from './features/shell/Header.tsx';
import { Toolbar, EMPTY_FILTERS, type Filters } from './features/shell/Toolbar.tsx';
import { PanelResizer } from './features/shell/PanelResizer.tsx';
import { DistrictMap } from './features/map/DistrictMap.tsx';
import { HeatmapControl } from './features/map/HeatmapControl.tsx';
import { MapModeControl } from './features/map/MapModeControl.tsx';
import type { MapMode } from './features/map/mapTheme.ts';
import { availableMetrics, buildHeatmap, type HeatmapMode } from './data/heatmap.ts';
import { StateDistrictExplorer } from './features/panel/StateDistrictExplorer.tsx';
import { ConfirmDialog } from './features/panel/ConfirmDialog.tsx';
import {
  DEFAULT_PANEL_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
  loadPanelWidth,
  panelMaxWidth,
  savePanelWidth,
} from './lib/panelWidth.ts';

/** Docked panel below this viewport width becomes a full-height overlay (Tailwind `sm`). */
const DOCK_BREAKPOINT = 640;

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then((d) => !cancelled && setDataset(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-lg border border-rose-200 bg-rose-50 p-5">
          <h1 className="text-sm font-semibold text-rose-900">Could not load the dataset</h1>
          <p className="mt-2 text-sm text-rose-800">{error}</p>
          <p className="mt-3 text-xs text-rose-700">
            The pipeline output is expected at <code>public/data/lgd-2024/</code>. Run{' '}
            <code>npm run all:geometry-only</code> in <code>pipeline/</code> to regenerate it.
          </p>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-ink-500" role="status">
          Loading districts…
        </p>
      </div>
    );
  }

  return (
    <SelectionProvider districtsById={dataset.districtsById}>
      <DatasetsGate dataset={dataset} />
    </SelectionProvider>
  );
}

/**
 * Provides the external dataset bundle (loaded once) to the Explorer. Split out so the
 * districtId universe is computed once from the loaded dataset and handed to the provider as a
 * stable set — used only to flag records that point at unknown ids.
 */
function DatasetsGate({ dataset }: { dataset: Dataset }) {
  // Canonical districtId → stateId from the verified hierarchy. This is the ONLY join used to
  // roll district dataset records up to their state — never a state name from the spreadsheet.
  const districtToState = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of dataset.hierarchy.states) {
      for (const d of s.districts) m.set(d.districtId, s.stateId);
    }
    return m;
  }, [dataset]);
  return (
    <DatasetRecordsProvider districtToState={districtToState}>
      <Explorer dataset={dataset} />
    </DatasetRecordsProvider>
  );
}

function Explorer({ dataset }: { dataset: Dataset }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const {
    selectedDistrict,
    selectedDistrictId,
    runGuarded,
    forceClearSelection,
    pendingNavigation,
    confirmPendingNavigation,
    cancelPendingNavigation,
  } = useSelection();

  const allDistricts = useMemo(
    () => dataset.hierarchy.states.flatMap((s) => s.districts),
    [dataset],
  );

  // ---- resizable docked panel -----------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(() =>
    clampPanelWidth(loadPanelWidth() ?? DEFAULT_PANEL_WIDTH, window.innerWidth),
  );
  const [isDocked, setIsDocked] = useState(() => window.innerWidth >= DOCK_BREAKPOINT);

  // Persist the width whenever it settles, but not on the many intermediate values during a
  // pointer drag ("do not persist temporary drag state"). Keeping persistence in an effect
  // rather than inside a state updater keeps the updater pure.
  const draggingRef = useRef(false);
  const widthRef = useRef(panelWidth);
  useEffect(() => {
    widthRef.current = panelWidth;
    if (!draggingRef.current) savePanelWidth(panelWidth);
  }, [panelWidth]);

  useEffect(() => {
    const onResize = () => {
      setIsDocked(window.innerWidth >= DOCK_BREAKPOINT);
      // Keep the width valid as the viewport changes (max is 60vw).
      setPanelWidth((w) => clampPanelWidth(w, window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Live update during a pointer drag; the dragging flag suppresses per-frame persistence.
  const resizePanelWidth = useCallback((w: number) => {
    draggingRef.current = true;
    setPanelWidth(clampPanelWidth(w, window.innerWidth));
  }, []);

  const commitPanelWidth = useCallback(() => {
    draggingRef.current = false;
    savePanelWidth(widthRef.current);
  }, []);

  // Keyboard: functional update so held keys accumulate correctly; the effect persists.
  const nudgePanelWidth = useCallback((deltaPx: number) => {
    setPanelWidth((w) => clampPanelWidth(w + deltaPx, window.innerWidth));
  }, []);

  const jumpPanelWidth = useCallback((edge: 'min' | 'max') => {
    setPanelWidth(edge === 'max' ? panelMaxWidth(window.innerWidth) : PANEL_MIN_WIDTH);
  }, []);

  // Divider shows when the docked explorer is open — i.e. a State/UT and/or a district is
  // selected. It controls the whole explorer's width, exactly as before.
  const explorerOpen = selectedDistrictId !== null || filters.stateId !== '';
  const showDivider = isDocked && explorerOpen;

  const setQuery = useCallback(
    (query: string) => setFilters((f) => ({ ...f, query })),
    [],
  );

  /**
   * Change the State/UT scope. This is the single funnel for every scope change (toolbar
   * State/UT search, a State/UT picked from the district search, alt-clicking the map, Reset).
   *
   * Changing to a scope that would exclude the selected district drops that district — and
   * because the district editor may hold unsaved edits, that drop is routed through the
   * navigation guard. Confirming applies the scope and clears the district together; cancelling
   * leaves both untouched, so the scope and the selection never disagree. Scopes that still
   * contain the district (or clearing to all-India, which keeps it) skip the guard.
   */
  const changeStateScope = useCallback(
    (stateId: string) => {
      const dropsDistrict =
        !!selectedDistrict && stateId !== '' && selectedDistrict.stateId !== stateId;
      if (dropsDistrict) {
        runGuarded(() => {
          setFilters((f) => ({ ...f, stateId }));
          forceClearSelection();
        });
      } else {
        setFilters((f) => ({ ...f, stateId }));
      }
    },
    [selectedDistrict, runGuarded, forceClearSelection],
  );

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  // ---- Heatmap (external dataset values only) ------------------------------------------------
  const { bundle, districtAggregates } = useDatasetRecords();
  const records = bundle?.records ?? [];

  // ---- District hover metrics (Speech hours / Text tokens) ----------------------------------
  // Precomputed ONCE per data change from the existing unit-aware district aggregates — the exact
  // structure the panels use. Speech = the district's summed Speech records in `hours`; Text = its
  // summed Text records in `tokens`. Unit-aware: only matching units contribute (stations/words/
  // documents never leak in). A metric absent from the aggregates is `null` (missing ≠ zero); a real
  // total, including a genuine 0, is kept. The map does a pure districtId lookup on hover — no fetch.
  const districtHoverData = useMemo(() => {
    const m = new Map<string, { speechHours: number | null; textTokens: number | null }>();
    for (const [districtId, aggs] of districtAggregates) {
      const speech = aggs.find((a) => a.datasetType === 'Speech');
      const text = aggs.find((a) => a.datasetType === 'Text');
      const speechHours = speech?.totalsByUnit.find((t) => t.unit === 'hours')?.value ?? null;
      const textTokens = text?.totalsByUnit.find((t) => t.unit === 'tokens')?.value ?? null;
      m.set(districtId, { speechHours, textTokens });
    }
    return m;
  }, [districtAggregates]);
  const districtToState = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of dataset.hierarchy.states) for (const d of s.districts) m.set(d.districtId, s.stateId);
    return m;
  }, [dataset]);

  // ---- Map view mode (default State: only India + state boundaries; districts hidden) --------
  const [mapMode, setMapMode] = useState<MapMode>('state');
  // Selecting a district (search, state-panel list, or a future path) auto-enters District mode so
  // the chosen district is actually visible/interactive on the map. Fires only when the selection
  // changes to a district — never on a fresh load (nothing is selected) and never forced back to
  // State mode, so a district can still be selected while the user is looking at the state view.
  useEffect(() => {
    if (selectedDistrictId && mapMode === 'state') setMapMode('district');
  }, [selectedDistrictId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [heatMode, setHeatMode] = useState<HeatmapMode>('off');
  const [metric, setMetric] = useState<{ datasetType: string; subType: string } | null>(null);
  // District-wise requires a selected State/UT; if the scope is cleared, it falls back to off while
  // remembering the preference (re-selecting a state reactivates it). State-wise is always allowed.
  const activeMode: HeatmapMode = heatMode === 'district' && filters.stateId === '' ? 'off' : heatMode;

  const scopeIds = useMemo(
    () =>
      activeMode === 'district' && filters.stateId
        ? new Set([...districtToState].filter(([, s]) => s === filters.stateId).map(([d]) => d))
        : undefined,
    [activeMode, filters.stateId, districtToState],
  );
  const metrics = useMemo(() => availableMetrics(records, scopeIds), [records, scopeIds]);

  // Auto-select the first available metric when a mode activates or the current one leaves scope.
  useEffect(() => {
    if (activeMode === 'off') return;
    const valid =
      metric && metrics.some((m) => m.datasetType === metric.datasetType && m.subTypes.some((s) => s.subType === metric.subType));
    if (!valid) {
      const first = metrics[0];
      setMetric(first ? { datasetType: first.datasetType, subType: first.subTypes[0]!.subType } : null);
    }
  }, [activeMode, metrics, metric]);

  const heatmapResult = useMemo(() => {
    if (activeMode === 'off' || !metric) return null;
    return buildHeatmap({
      records,
      mode: activeMode,
      metric,
      stateId: activeMode === 'district' ? filters.stateId : '',
      districtToState,
    });
  }, [activeMode, metric, records, filters.stateId, districtToState]);

  return (
    <div className="flex h-full flex-col">
      <Header manifest={dataset.manifest} />
      <Toolbar
        query={filters.query}
        onQueryChange={setQuery}
        stateId={filters.stateId}
        onStateScopeChange={changeStateScope}
        onReset={resetFilters}
        states={dataset.stateOptions}
        districts={allDistricts}
        totalDistricts={dataset.manifest.counts.districtFeatures}
        mapMode={mapMode}
      />
      {/* `relative` anchors the panel when it overlays the map on small screens. */}
      <div ref={containerRef} className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <DistrictMap
            dataset={dataset}
            mapMode={mapMode}
            stateFilter={filters.stateId}
            onSelectState={changeStateScope}
            heatmap={heatmapResult?.classByDistrictId ?? null}
            heatActive={activeMode !== 'off' && heatmapResult !== null}
            districtHoverData={districtHoverData}
          />
          <MapModeControl mode={mapMode} onModeChange={setMapMode} />
          <HeatmapControl
            mode={activeMode}
            onModeChange={setHeatMode}
            stateSelected={filters.stateId !== ''}
            metrics={metrics}
            metric={metric}
            onMetricChange={setMetric}
            result={heatmapResult}
          />
        </main>
        {showDivider && (
          <PanelResizer
            containerRef={containerRef}
            width={panelWidth}
            onResize={resizePanelWidth}
            onCommit={commitPanelWidth}
            onNudge={nudgePanelWidth}
            onJump={jumpPanelWidth}
          />
        )}
        <StateDistrictExplorer
          variant={isDocked ? 'docked' : 'overlay'}
          width={panelWidth}
          selectedStateId={filters.stateId}
          states={dataset.stateOptions}
          districts={allDistricts}
          onCloseState={() => changeStateScope('')}
        />
      </div>

      {/* Guards selection changes (map click, search, panel close, filter exclusion) when the
          district editor has unsaved edits. */}
      <ConfirmDialog
        open={pendingNavigation !== null}
        title="Discard unsaved changes?"
        message="You have unsaved edits to this district. Discarding will lose them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={confirmPendingNavigation}
        onCancel={cancelPendingNavigation}
      />
    </div>
  );
}
