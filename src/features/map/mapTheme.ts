/**
 * Map palette. No basemap and no glyph server — the map is our own verified geometry on a
 * plain canvas, so nothing underneath can contradict the boundary we publish
 * (docs/DECISIONS.md D-009) and there is no external request and no API token.
 *
 * Fills stay light so future choropleth values have room to read against them.
 */
export const MAP_COLORS = {
  canvas: '#f3f6f9',
  // India's territory is orange. The district fill tiles the country, so it carries the orange;
  // the india-outline fill sits underneath as a lighter shade for the few gaps and so out-of-scope
  // dimming still reads. Everything outside the boundary stays the neutral `canvas`.
  indiaFill: '#F8D2B4',
  districtFill: '#F4B183',
  districtFillDimmed: '#F8D2B4',
  districtOutline: '#ffffff',
  stateOutline: '#a7b0c0',
  /** Prominent state outline used in State map mode (districts hidden) so states read clearly. */
  stateOutlineStrong: '#475569',
  /** Translucent hover/interaction tint for whole states in State map mode (primary blue). */
  stateHoverFill: '#1e73be',
  hoverFill: '#bcd7f0',
  selectedFill: '#1e73be',
  selectedOutline: '#ffffff',
  /** Outline drawn around the State/UT currently scoped by the filter (deep primary blue). */
  stateHighlight: '#07579e',
  /**
   * Discrete 3-class choropleth palette — traffic-light signal colours for the provisional DEMO
   * thresholds: LOW = green, MEDIUM = yellow, HIGH = red. Deliberately distinct from the blue
   * hover/selection. White district outlines stay visible on every step.
   */
  heatLow: '#43a047', // green — LOW
  heatMedium: '#f5c518', // yellow — MEDIUM
  heatHigh: '#e53935', // red — HIGH
  /**
   * NO-DATA fill shown only while the heatmap is active: a neutral cool grey so "no signal" reads
   * clearly apart from the green/yellow/red signals. When the heatmap is off, districts revert to
   * the orange `districtFill` base.
   */
  heatNoData: '#c7ccd4',
} as const;

/** Opacity applied to districts outside the active State/UT scope. */
export const OUT_OF_SCOPE_FILL_OPACITY = 0.3;
export const OUT_OF_SCOPE_LINE_OPACITY = 0.25;

export const LAYER = {
  indiaFill: 'india-area-fill',
  districtFill: 'district-fill',
  districtOutline: 'district-outline',
  districtSelected: 'district-selected-outline',
  /** Transparent per-state fill: the hover/click interaction surface used in State map mode. */
  stateFill: 'state-fill',
  stateOutline: 'state-outline',
  stateHighlight: 'state-highlight',
} as const;

/**
 * Map view mode — the single source of truth for layer visibility and interaction gating.
 *  - 'state'    : only India geography + prominent state boundaries; districts hidden/inert.
 *  - 'district' : the full district map (fill, outline, hover, click, selection) — original behaviour.
 */
export type MapMode = 'state' | 'district';

export const SOURCE = {
  india: 'india',
  districts: 'districts',
  states: 'states',
} as const;

/** Padding around India when fitting the initial view, in px. */
export const FIT_PADDING = { top: 32, right: 32, bottom: 32, left: 32 };
