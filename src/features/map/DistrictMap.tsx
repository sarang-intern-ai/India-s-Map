import { useCallback, useEffect, useRef, useState } from 'react';
// maplibre-gl v6 exports named symbols only. Its `Map` is imported as `MapLibreMap` so it
// does not shadow the global `Map` used elsewhere in the app.
import {
  MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import type { Dataset } from '../../data/loadDataset.ts';
import type { HeatmapClass } from '../../data/heatmap.ts';
import { officialDistrictName } from '../../data/districtNames.ts';
import { useSelection } from '../../state/selection.tsx';
import {
  FIT_PADDING,
  LAYER,
  MAP_COLORS,
  OUT_OF_SCOPE_FILL_OPACITY,
  OUT_OF_SCOPE_LINE_OPACITY,
  SOURCE,
  type MapMode,
} from './mapTheme.ts';
import {
  DISTRICT_FIT_DURATION_MS,
  DISTRICT_MAX_ZOOM,
  STATE_MAX_ZOOM,
  featureBounds,
  fitPaddingFor,
  type Bounds,
} from '../../lib/districtCamera.ts';
// Side-effect import: points MapLibre at the worker URL Vite emits. Must run before a Map
// is constructed, or the map renders empty with no error. See maplibreWorker.ts.
import './maplibreWorker.ts';

/** Per-district hover metrics, looked up by canonical districtId from the existing aggregates.
 *  `null` means the district has no record for that metric (missing ≠ zero); a real numeric total
 *  (including 0) is a valid value. Absent (`undefined` `datasets`) means this is a state hover. */
export type DistrictHoverData = { speechHours: number | null; textTokens: number | null };
type HoverInfo = { districtName: string; stateName: string; datasets?: DistrictHoverData };

const HOVER_NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
/**
 * Format one hover metric. A missing value (null/undefined) → "Data not available"; a real numeric
 * value — including a genuine 0 — → "<grouped number> <unit>". The explicit null check (never a
 * falsy check) is what keeps a real 0 distinct from missing data.
 */
function hoverMetricLabel(value: number | null | undefined, unit: string): string {
  return value == null ? 'Data not available' : `${HOVER_NUM.format(value)} ${unit}`;
}

/**
 * An empty style — no basemap sources, no glyphs, no sprite. Every byte the map renders
 * comes from public/data/lgd-2024/. There is no external request and no API token.
 */
const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'canvas', type: 'background', paint: { 'background-color': MAP_COLORS.canvas } }],
};

export function DistrictMap({
  dataset,
  mapMode,
  stateFilter,
  onSelectState,
  heatmap,
  heatActive,
  districtHoverData,
}: {
  dataset: Dataset;
  /** Single source of truth for layer visibility + interaction gating. Default 'state'. */
  mapMode: MapMode;
  /** canonical districtId → precomputed Speech/Text hover metrics (from the existing dataset
   *  aggregates). A pure in-memory lookup — the hover handler never fetches per mouse move. */
  districtHoverData: ReadonlyMap<string, DistrictHoverData>;
  /** '' means all of India. Districts outside this scope are dimmed and non-interactive. */
  stateFilter: string;
  /** Select a State/UT scope (alt-click in district mode; a plain click in state mode). */
  onSelectState: (stateId: string) => void;
  /** districtId → heat class, or null when the heatmap is off. Applied purely via feature-state. */
  heatmap: ReadonlyMap<string, HeatmapClass> | null;
  /** True while a heatmap metric is displayed: districts with no value show the neutral grey
   * NO-DATA fill instead of the orange base, so "no signal" reads apart from the signal colours. */
  heatActive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredStateIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // Map handlers are bound once on mount; they read the live mode through this ref.
  const mapModeRef = useRef<MapMode>(mapMode);
  mapModeRef.current = mapMode;

  // The hover handler (bound once) reads the latest aggregates through this ref, so a data refresh
  // (sync/version poll) is reflected on the next hover with no listener rebinding and no per-hover fetch.
  const hoverDataRef = useRef(districtHoverData);
  hoverDataRef.current = districtHoverData;

  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);

  const { selectedDistrictId, selectionOrigin, selectionSeq, selectDistrict } = useSelection();

  // `selectDistrict` is stable (useCallback with no deps), but the map handlers are bound
  // once on mount, so read the latest value through a ref rather than rebinding listeners.
  const selectDistrictRef = useRef(selectDistrict);
  selectDistrictRef.current = selectDistrict;

  const onSelectStateRef = useRef(onSelectState);
  onSelectStateRef.current = onSelectState;

  // Map event handlers are bound once, so they read the live scope through a ref.
  const stateFilterRef = useRef(stateFilter);
  stateFilterRef.current = stateFilter;

  /** True when a district is inside the active State/UT scope (always true when unscoped). */
  const inScope = (districtStateId: unknown) =>
    stateFilterRef.current === '' || String(districtStateId) === stateFilterRef.current;

  /**
   * Frames a district using its own geometry from the loaded dataset. This is the single
   * place district camera movement happens; nothing else calls `fitBounds` for a district.
   *
   * Returns false and leaves the camera completely untouched when the district is unknown,
   * has no published boundary, or carries unusable coordinates — so a bad id is a no-op
   * rather than a jump to null island.
   */
  /**
   * The one and only camera path. Every framing entry point below funnels through here, so
   * padding, motion preference and the pre-fit resize are solved in a single place.
   */
  const fitTo = useCallback((bounds: Bounds | null, maxZoom: number): boolean => {
    const map = mapRef.current;
    if (!map || !bounds) return false;

    // The detail panel is a flex sibling, so opening it narrows the map container. Resize
    // before measuring, otherwise fitBounds solves for a stale viewport and the target
    // lands under the panel.
    map.resize();

    const canvas = map.getCanvas();
    const padding = fitPaddingFor(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
    );
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    map.fitBounds(bounds, {
      padding,
      maxZoom,
      duration: reduceMotion ? 0 : DISTRICT_FIT_DURATION_MS,
    });
    return true;
  }, []);

  /**
   * Frames a district using its own geometry from the loaded dataset.
   *
   * Returns false and leaves the camera completely untouched when the district is unknown,
   * has no published boundary, or carries unusable coordinates — so a bad id is a no-op
   * rather than a jump to null island.
   */
  const zoomToDistrict = useCallback(
    (districtId: string | null): boolean => {
      if (!districtId) return false;
      const feature = dataset.districtFeaturesById.get(districtId);
      if (!feature) return false; // e.g. status "no_boundary_published"
      return fitTo(featureBounds(feature), DISTRICT_MAX_ZOOM);
    },
    [dataset, fitTo],
  );

  /** Frames a State/UT, or all of India when the scope is cleared. Same camera path. */
  const zoomToStateScope = useCallback(
    (stateId: string): boolean => {
      if (!stateId) {
        const [w, s, e, n] = dataset.manifest.geometry.bbox;
        return fitTo(
          [
            [w, s],
            [e, n],
          ],
          STATE_MAX_ZOOM,
        );
      }
      const feature = dataset.stateFeaturesById.get(stateId);
      if (!feature) return false;
      return fitTo(featureBounds(feature), STATE_MAX_ZOOM);
    },
    [dataset, fitTo],
  );

  // ---- create the map once -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: EMPTY_STYLE,
      bounds: dataset.manifest.geometry.bbox,
      fitBoundsOptions: { padding: FIT_PADDING },
      minZoom: 3,
      maxZoom: 12,
      attributionControl: false,
      // The dataset is a plane of polygons; tilting and rotating add nothing and make
      // an administrative map harder to read.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    });
    mapRef.current = map;

    // Dev-only handle for debugging in the console. Never referenced by app code.
    if (import.meta.env.DEV) {
      (window as unknown as { __map?: MapLibreMap }).__map = map;
    }

    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.touchZoomRotate.disableRotation();
    map.getCanvas().setAttribute('aria-label', 'Map of districts of India');

    // Opening/closing the detail panel narrows the map column on desktop. Observe the
    // container directly so the canvas keeps its aspect ratio — this is a resize, never a
    // re-init, so the single map instance is preserved.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on('load', () => {
      // India outer boundary (dissolved union of states) — fills the territory with a light
      // orange. Added first so it renders below all district and state layers.
      map.addSource(SOURCE.india, { type: 'geojson', data: dataset.indiaOutline });
      map.addLayer({
        id: LAYER.indiaFill,
        type: 'fill',
        source: SOURCE.india,
        paint: {
          'fill-color': MAP_COLORS.indiaFill,
          'fill-opacity': 1,
        },
      });

      map.addSource(SOURCE.districts, {
        type: 'geojson',
        data: dataset.districts,
        // districtId values include "unadministered:991", so promoteId is required —
        // MapLibre will not accept those as raw numeric feature ids.
        promoteId: 'districtId',
      });
      map.addSource(SOURCE.states, { type: 'geojson', data: dataset.states, promoteId: 'stateId' });

      // Fill. Hover and selection are independent feature-state flags, so moving the
      // mouse away never disturbs the selection.
      // District layers start hidden in State mode (the default) so a fresh load shows a clean
      // state map with no flash of 785 polygons. The mode-visibility effect keeps them in step.
      const districtVisibility = mapModeRef.current === 'district' ? 'visible' : 'none';

      map.addLayer({
        id: LAYER.districtFill,
        type: 'fill',
        source: SOURCE.districts,
        layout: { visibility: districtVisibility },
        paint: {
          // Every district — administered or not — uses the same default/hover/selected fill.
          // The two unadministered (PoK) districts must be visually indistinguishable from any
          // other district when not selected, so there is no `administered`-based special case.
          // Priority: selection > hover > heatmap class > base (orange / NO-DATA). The heatmap
          // sets a `heatClass` feature-state per district; when it is unset the fill falls through
          // to the base, so this expression is harmless with the heatmap off and needs no rewrite
          // when a metric changes (only feature-state is toggled — no MapLibre reinit).
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], MAP_COLORS.selectedFill,
            ['boolean', ['feature-state', 'hover'], false], MAP_COLORS.hoverFill,
            ['==', ['feature-state', 'heatClass'], 'high'], MAP_COLORS.heatHigh,
            ['==', ['feature-state', 'heatClass'], 'medium'], MAP_COLORS.heatMedium,
            ['==', ['feature-state', 'heatClass'], 'low'], MAP_COLORS.heatLow,
            MAP_COLORS.districtFill,
          ],
          // Replaced wholesale when the State/UT scope changes — see the scope effect.
          'fill-opacity': 1,
        },
      });

      map.addLayer({
        id: LAYER.districtOutline,
        type: 'line',
        source: SOURCE.districts,
        layout: { visibility: districtVisibility },
        paint: {
          'line-color': MAP_COLORS.districtOutline,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 1.1],
          'line-opacity': 0.9,
        },
      });

      // Transparent per-state fill — the hover/click interaction surface for State mode. Sits just
      // below the district fill (so district interactions win in District mode) and reuses the
      // existing `states` source (no second GeoJSON, no second TopoJSON decode).
      map.addLayer(
        {
          id: LAYER.stateFill,
          type: 'fill',
          source: SOURCE.states,
          layout: { visibility: mapModeRef.current === 'state' ? 'visible' : 'none' },
          paint: {
            'fill-color': MAP_COLORS.stateHoverFill,
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.16, 0],
          },
        },
        LAYER.districtFill,
      );

      map.addLayer({
        id: LAYER.stateOutline,
        type: 'line',
        source: SOURCE.states,
        paint: {
          // Prominent in State mode (districts hidden), subtle in District mode. The mode effect
          // swaps these; the initial values match the default 'state' mode.
          'line-color': mapModeRef.current === 'state' ? MAP_COLORS.stateOutlineStrong : MAP_COLORS.stateOutline,
          'line-width':
            mapModeRef.current === 'state'
              ? ['interpolate', ['linear'], ['zoom'], 3, 1.2, 8, 3.2]
              : ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1.8],
        },
      });

      // Outline of the State/UT currently in scope. A dedicated filtered layer keeps the
      // base state-outline paint expressions untouched.
      map.addLayer({
        id: LAYER.stateHighlight,
        type: 'line',
        source: SOURCE.states,
        filter: ['==', ['get', 'stateId'], '__none__'],
        paint: {
          'line-color': MAP_COLORS.stateHighlight,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 8, 2.6],
        },
      });

      // Drawn above the state outline so a selected district reads clearly even when it
      // sits on a state border.
      map.addLayer({
        id: LAYER.districtSelected,
        type: 'line',
        source: SOURCE.districts,
        layout: { visibility: districtVisibility },
        filter: ['==', ['get', 'districtId'], '__none__'],
        paint: {
          'line-color': MAP_COLORS.selectedOutline,
          'line-width': 2,
        },
      });

      setReady(true);
    });

    // ---- hover ---------------------------------------------------------------------------
    const clearHover = () => {
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(
          { source: SOURCE.districts, id: hoveredIdRef.current },
          { hover: false },
        );
        hoveredIdRef.current = null;
      }
      setHoverInfo(null);
      map.getCanvas().style.cursor = '';
    };

    map.on('mousemove', LAYER.districtFill, (e: MapLayerMouseEvent) => {
      if (mapModeRef.current !== 'district') return; // districts are inert in State mode
      // With a scope active, the first hit may be a dimmed out-of-scope district lying on
      // top; take the topmost in-scope feature instead so the scope is genuinely focused.
      const f = e.features?.find((hit) => inScope(hit.properties?.stateId));
      if (!f) {
        clearHover();
        return;
      }
      const props = f.properties as { districtId: string; districtName: string; stateName: string; administered: boolean };
      const id = props.districtId;

      if (hoveredIdRef.current !== id) {
        if (hoveredIdRef.current !== null) {
          map.setFeatureState({ source: SOURCE.districts, id: hoveredIdRef.current }, { hover: false });
        }
        hoveredIdRef.current = id;
        map.setFeatureState({ source: SOURCE.districts, id }, { hover: true });
        setHoverInfo({
          // Prefer the official/latest LGD name, consistent with search and the panel.
          districtName: officialDistrictName(props.districtId, props.districtName),
          stateName: props.stateName,
          // Canonical-id lookup into the precomputed aggregates. Absent id → no records → both null
          // (→ "Data not available"); never a name match, so reconciled ids (incl. Mirpur/Muzaffarabad)
          // resolve correctly.
          datasets: hoverDataRef.current.get(id) ?? { speechHours: null, textTokens: null },
        });
        map.getCanvas().style.cursor = 'pointer';
      }

      // Position via the DOM directly — putting mouse coordinates in React state would
      // re-render the tooltip on every pointer move.
      if (tooltipRef.current) {
        tooltipRef.current.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
      }
    });

    map.on('mouseleave', LAYER.districtFill, clearHover);

    // ---- state hover (State mode only) ---------------------------------------------------
    const clearStateHover = () => {
      if (hoveredStateIdRef.current !== null) {
        map.setFeatureState({ source: SOURCE.states, id: hoveredStateIdRef.current }, { hover: false });
        hoveredStateIdRef.current = null;
      }
      setHoverInfo(null);
      map.getCanvas().style.cursor = '';
    };

    map.on('mousemove', LAYER.stateFill, (e: MapLayerMouseEvent) => {
      if (mapModeRef.current !== 'state') return;
      const f = e.features?.[0];
      if (!f) {
        clearStateHover();
        return;
      }
      const props = f.properties as { stateId: string; stateName?: string };
      const id = String(props.stateId);
      if (hoveredStateIdRef.current !== id) {
        if (hoveredStateIdRef.current !== null) {
          map.setFeatureState({ source: SOURCE.states, id: hoveredStateIdRef.current }, { hover: false });
        }
        hoveredStateIdRef.current = id;
        map.setFeatureState({ source: SOURCE.states, id }, { hover: true });
        // Reuse the tooltip: the state name is the primary line, no secondary line.
        setHoverInfo({ districtName: props.stateName ?? id, stateName: '' });
        map.getCanvas().style.cursor = 'pointer';
      }
      if (tooltipRef.current) {
        tooltipRef.current.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
      }
    });

    map.on('mouseleave', LAYER.stateFill, clearStateHover);

    // ---- click ---------------------------------------------------------------------------
    // One handler for the whole map:
    //  · Alt/Option-click selects the State/UT under the cursor (drill to state). Because the
    //    country is fully tiled by district polygons there is no pixel that is "state but not
    //    district", so a plain click cannot mean both — alt-click is the deterministic
    //    disambiguation, leaving plain-click = district untouched. See docs/report.
    //  · Plain click selects the district (origin 'map', camera stays put), or clears the
    //    selection when the click misses every in-scope district.
    map.on('click', (e: MapMouseEvent) => {
      // State mode: a plain click selects the State/UT under the cursor (districts are inert).
      if (mapModeRef.current === 'state') {
        const under = map.queryRenderedFeatures(e.point, { layers: [LAYER.stateFill] });
        const stateId = (under[0]?.properties as { stateId?: string } | undefined)?.stateId;
        if (stateId) onSelectStateRef.current(String(stateId));
        return;
      }
      if (e.originalEvent.altKey) {
        const under = map.queryRenderedFeatures(e.point, { layers: [LAYER.districtFill] });
        const stateId = (under[0]?.properties as { stateId?: string } | undefined)?.stateId;
        if (stateId) onSelectStateRef.current(stateId);
        return;
      }
      const hits = map
        .queryRenderedFeatures(e.point, { layers: [LAYER.districtFill] })
        // Out-of-scope districts stay visible for geographic context but are not selectable.
        .filter((hit) => inScope(hit.properties?.stateId));
      const id = (hits[0]?.properties as { districtId?: string } | undefined)?.districtId ?? null;
      // Origin 'map' — the user clicked something already on screen, so the camera stays
      // put. Only non-map selections navigate.
      selectDistrictRef.current(id, 'map');
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Built once. `dataset` is loaded before this component mounts and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- reflect the canonical selection onto the map -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (selectedIdRef.current && selectedIdRef.current !== selectedDistrictId) {
      map.setFeatureState(
        { source: SOURCE.districts, id: selectedIdRef.current },
        { selected: false },
      );
    }
    selectedIdRef.current = selectedDistrictId;

    if (selectedDistrictId) {
      map.setFeatureState({ source: SOURCE.districts, id: selectedDistrictId }, { selected: true });
    }

    map.setFilter(LAYER.districtSelected, [
      '==',
      ['get', 'districtId'],
      selectedDistrictId ?? '__none__',
    ]);
  }, [selectedDistrictId, ready]);

  // ---- Map mode: toggle layer visibility + district interaction, and make state outlines --
  // prominent in State mode. The single source of truth is `mapMode`; the map handlers read it
  // through `mapModeRef`. No source is touched and the map is never recreated — only layout
  // visibility and two paint properties change, so the switch is instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const districtVis = mapMode === 'district' ? 'visible' : 'none';
    const stateVis = mapMode === 'state' ? 'visible' : 'none';
    for (const id of [LAYER.districtFill, LAYER.districtOutline, LAYER.districtSelected]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', districtVis);
    }
    if (map.getLayer(LAYER.stateFill)) map.setLayoutProperty(LAYER.stateFill, 'visibility', stateVis);
    if (map.getLayer(LAYER.stateOutline)) {
      map.setPaintProperty(
        LAYER.stateOutline,
        'line-color',
        mapMode === 'state' ? MAP_COLORS.stateOutlineStrong : MAP_COLORS.stateOutline,
      );
      map.setPaintProperty(
        LAYER.stateOutline,
        'line-width',
        mapMode === 'state'
          ? ['interpolate', ['linear'], ['zoom'], 3, 1.2, 8, 3.2]
          : ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1.8],
      );
    }
    // Clear the hover state that belongs to the mode we just left, so no stale tint/tooltip lingers.
    if (mapMode !== 'state' && hoveredStateIdRef.current !== null) {
      map.setFeatureState({ source: SOURCE.states, id: hoveredStateIdRef.current }, { hover: false });
      hoveredStateIdRef.current = null;
      setHoverInfo(null);
    }
    if (mapMode !== 'district' && hoveredIdRef.current !== null) {
      map.setFeatureState({ source: SOURCE.districts, id: hoveredIdRef.current }, { hover: false });
      hoveredIdRef.current = null;
      setHoverInfo(null);
    }
  }, [mapMode, ready]);

  // ---- State/UT scope: dim out-of-scope districts, outline the scoped state ---------------
  // Applied entirely at the MapLibre layer with paint expressions and a layer filter. The
  // GeoJSON source is never re-set and no geometry is removed from React state, so feature
  // ids, hover, selection and zoomToDistrict all keep working on the full 785 features.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const scoped = stateFilter !== '';
    const isInScope: ExpressionSpecification = ['==', ['get', 'stateId'], stateFilter];

    map.setPaintProperty(
      LAYER.districtFill,
      'fill-opacity',
      scoped ? ['case', isInScope, 1, OUT_OF_SCOPE_FILL_OPACITY] : 1,
    );
    map.setPaintProperty(
      LAYER.districtOutline,
      'line-opacity',
      scoped ? ['case', isInScope, 0.9, OUT_OF_SCOPE_LINE_OPACITY] : 0.9,
    );
    map.setFilter(LAYER.stateHighlight, ['==', ['get', 'stateId'], stateFilter || '__none__']);
  }, [stateFilter, ready]);

  // ---- Heatmap: colour districts via a `heatClass` feature-state ---------------------------
  // Purely visual and independent of the selection/scope feature-states, so hover, selection,
  // zoom and scope all keep working. The GeoJSON source is never touched → no MapLibre reinit.
  const heatIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const next = heatmap ?? new Map<string, HeatmapClass>();
    // Clear districts that were coloured but no longer are (metric change / heatmap off).
    for (const id of heatIdsRef.current) {
      if (!next.has(id)) map.setFeatureState({ source: SOURCE.districts, id }, { heatClass: null });
    }
    const nextIds = new Set<string>();
    for (const [id, cls] of next) {
      map.setFeatureState({ source: SOURCE.districts, id }, { heatClass: cls });
      nextIds.add(id);
    }
    heatIdsRef.current = nextIds;
  }, [heatmap, ready]);

  // ---- NO-DATA fill: neutral grey while the heatmap is active, orange base otherwise -----------
  // Only the fallback colour of the district-fill `case` expression changes; selection > hover >
  // heat-class priority (and every other layer) is untouched. Districts without a `heatClass`
  // feature-state fall through to this fallback, so "no data" reads as grey during a heatmap and
  // reverts to the orange base the moment the heatmap is cleared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const noData = heatActive ? MAP_COLORS.heatNoData : MAP_COLORS.districtFill;
    map.setPaintProperty(LAYER.districtFill, 'fill-color', [
      'case',
      ['boolean', ['feature-state', 'selected'], false], MAP_COLORS.selectedFill,
      ['boolean', ['feature-state', 'hover'], false], MAP_COLORS.hoverFill,
      ['==', ['feature-state', 'heatClass'], 'high'], MAP_COLORS.heatHigh,
      ['==', ['feature-state', 'heatClass'], 'medium'], MAP_COLORS.heatMedium,
      ['==', ['feature-state', 'heatClass'], 'low'], MAP_COLORS.heatLow,
      noData,
    ]);
  }, [heatActive, ready]);

  // Frame the scope when it changes. Skipped on first paint so the initial India fit from
  // the map constructor is not immediately re-run.
  const didMountScope = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!didMountScope.current) {
      didMountScope.current = true;
      return;
    }
    zoomToStateScope(stateFilter);
  }, [stateFilter, ready, zoomToStateScope]);

  // ---- re-frame the State/UT when a district is closed but the state stays selected -------
  // Reuses the existing state camera. In district-only mode (no scope) closing does not move
  // the camera, exactly as before this phase.
  const prevSelectedRef = useRef(selectedDistrictId);
  useEffect(() => {
    if (!ready) return;
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selectedDistrictId;
    if (was && !selectedDistrictId && stateFilterRef.current) {
      zoomToStateScope(stateFilterRef.current);
    }
  }, [selectedDistrictId, ready, zoomToStateScope]);

  // ---- navigate to the selection, when the selection asked for it ------------------------
  // Keyed on `selectionSeq` rather than `selectedDistrictId` so that re-selecting the same
  // district from search re-frames it after the user has panned away.
  useEffect(() => {
    if (!ready) return;
    if (selectionOrigin === 'map') return; // clicking an on-screen district must not move the camera
    zoomToDistrict(selectedDistrictId);
    // Deliberately excludes selectedDistrictId: seq already changes on every selection, and
    // including it would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSeq, ready, zoomToDistrict]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      <div
        ref={tooltipRef}
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute top-0 left-0 z-10 will-change-transform ${
          hoverInfo ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {hoverInfo && (
          <div className="max-w-64 rounded-md border border-ink-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
            <p className="text-sm font-semibold text-brand-800">{hoverInfo.districtName}</p>
            {hoverInfo.stateName && <p className="text-xs text-ink-500">{hoverInfo.stateName}</p>}
            {hoverInfo.datasets && (
              <div className="mt-1.5 space-y-1 border-t border-ink-100 pt-1.5">
                <div>
                  <p className="text-[10px] font-semibold tracking-wide text-flame-600 uppercase">Speech data</p>
                  <p className="text-xs text-ink-800">
                    {hoverMetricLabel(hoverInfo.datasets.speechHours, 'hours')}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold tracking-wide text-flame-600 uppercase">Text data</p>
                  <p className="text-xs text-ink-800">
                    {hoverMetricLabel(hoverInfo.datasets.textTokens, 'tokens')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-ink-50">
          <p className="text-sm text-ink-500">Rendering map…</p>
        </div>
      )}
    </div>
  );
}
