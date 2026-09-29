import type { DatasetRecord } from './datasetRecords.ts';

/**
 * Pure heatmap transformation layer. Given the external (PostgreSQL/API-derived) DatasetRecords, a
 * selected metric (datasetType + subType) and a mode, it produces a discrete 3-class choropleth:
 * per-district LOW / MEDIUM / HIGH classes plus the real unit and thresholds for the legend.
 *
 * No MapLibre, no React, no I/O — thresholds are computed here, never inside map event handlers.
 * It never mixes units (a metric's classes come only from that metric's own numeric distribution),
 * never treats "missing" as 0 (districts without a value are simply absent from `classByDistrictId`
 * → the map leaves them at the neutral base), and never uses non-numeric values.
 */

export type HeatmapClass = 'low' | 'medium' | 'high';
export type HeatmapMode = 'off' | 'state' | 'district';

/** A datasetType and the numeric subtypes available under it (with their real unit). */
export type MetricOption = { datasetType: string; subTypes: { subType: string; unit: string }[] };

export type Thresholds = {
  lowMax: number;
  mediumMax: number;
  /** How the thresholds were derived — surfaced so the choice is transparent/replaceable. */
  method: 'percentile' | 'even' | 'single' | 'manual' | 'demo';
  integer: boolean;
};

/**
 * PROVISIONAL DEMO thresholds, keyed by unit. Placeholders so the heatmap UI can be demonstrated
 * before real domain datasets/thresholds exist — these are NOT official cut-offs (the legend labels
 * them "Demo thresholds"). Each entry is { low, high }: value < low → LOW, low ≤ value ≤ high →
 * MEDIUM, value > high → HIGH. Units not listed fall back to the data-driven percentile thresholds,
 * so the layer stays fully data-driven and picks up real values automatically once datasets are
 * connected later.
 */
export const DEMO_THRESHOLDS: Record<string, { low: number; high: number }> = {
  hours: { low: 50, high: 150 },
  words: { low: 100_000, high: 500_000 },
  documents: { low: 50, high: 150 },
  posts: { low: 50_000, high: 150_000 },
  stations: { low: 3, high: 6 },
};

function demoThresholdFor(unit: string): { low: number; high: number } | null {
  return DEMO_THRESHOLDS[unit.trim().toLowerCase()] ?? null;
}

export type HeatmapResult = {
  datasetType: string;
  subType: string;
  unit: string;
  thresholds: Thresholds;
  legend: { low: string; medium: string; high: string };
  /** districtId → class. Districts absent here are NO-DATA and stay at the base map appearance. */
  classByDistrictId: Map<string, HeatmapClass>;
  counts: { low: number; medium: number; high: number; noData: number };
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The metrics (datasetType → numeric subtypes) actually present. Optionally scoped to a set of
 * districtIds (a state's districts). First-seen order; only subtypes with ≥1 numeric value appear.
 */
export function availableMetrics(records: DatasetRecord[], scope?: ReadonlySet<string>): MetricOption[] {
  const order: string[] = [];
  const byType = new Map<string, { order: string[]; units: Map<string, string> }>();
  for (const r of records) {
    if (scope && !scope.has(r.districtId)) continue;
    if (!isNum(r.value)) continue;
    let t = byType.get(r.datasetType);
    if (!t) {
      t = { order: [], units: new Map() };
      byType.set(r.datasetType, t);
      order.push(r.datasetType);
    }
    if (!t.units.has(r.subType)) {
      t.units.set(r.subType, r.unit);
      t.order.push(r.subType);
    }
  }
  return order.map((datasetType) => {
    const t = byType.get(datasetType)!;
    return { datasetType, subTypes: t.order.map((subType) => ({ subType, unit: t.units.get(subType) ?? '' })) };
  });
}

function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0]!;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Default thresholds derived from the metric's own distribution:
 *  - ≥ 5 observations → robust tertiles (P33 / P66),
 *  - 2–4 observations → an even split of the [min, max] range (percentiles are unstable),
 *  - all-equal or a single observation → a single band ('single').
 * For integer metrics the band edges are floored so the legend reads as clean integer ranges.
 * `override` lets an explicit domain threshold replace this later without touching callers.
 *
 * While provisional DEMO thresholds exist for the metric's `unit`, they take precedence over the
 * distribution-derived defaults (but not over an explicit `override`) — see DEMO_THRESHOLDS.
 */
function computeThresholds(
  values: number[],
  unit: string,
  override?: { lowMax: number; mediumMax: number },
): Thresholds {
  const integer = values.every((v) => Number.isInteger(v));
  if (override) {
    return { lowMax: override.lowMax, mediumMax: override.mediumMax, method: 'manual', integer };
  }
  const demo = demoThresholdFor(unit);
  if (demo) {
    // lowMax = lower boundary, mediumMax = upper boundary; classOf uses strict-less at the lower
    // edge for the demo method so `value < low → LOW` holds for fractional values too.
    return { lowMax: demo.low, mediumMax: demo.high, method: 'demo', integer };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;

  let lowMax: number;
  let mediumMax: number;
  let method: Thresholds['method'];
  if (n < 2 || min === max) {
    // One band: everything lands in MEDIUM (value ≤ mediumMax, value > lowMax is false).
    lowMax = min - 1;
    mediumMax = max;
    method = 'single';
  } else if (n >= 5) {
    lowMax = percentile(sorted, 1 / 3);
    mediumMax = percentile(sorted, 2 / 3);
    method = 'percentile';
  } else {
    lowMax = min + (max - min) / 3;
    mediumMax = min + (2 * (max - min)) / 3;
    method = 'even';
  }

  if (integer && method !== 'single') {
    lowMax = Math.floor(lowMax);
    mediumMax = Math.floor(mediumMax);
    if (mediumMax <= lowMax) mediumMax = lowMax + 1;
  }
  return { lowMax, mediumMax, method, integer };
}

function classOf(value: number, t: Thresholds): HeatmapClass {
  if (t.method === 'demo') {
    // lowMax/mediumMax are boundaries: value < low → LOW, low ≤ value ≤ high → MEDIUM, else HIGH.
    if (value < t.lowMax) return 'low';
    if (value <= t.mediumMax) return 'medium';
    return 'high';
  }
  if (value <= t.lowMax) return 'low';
  if (value <= t.mediumMax) return 'medium';
  return 'high';
}

const fmt = (n: number, integer: boolean) =>
  integer ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function legendText(values: number[], t: Thresholds): HeatmapResult['legend'] {
  if (t.method === 'demo') {
    // Boundaries are whole numbers; show the spec ranges verbatim ("< 50", "50–150", "> 150").
    const lo = Math.round(t.lowMax).toLocaleString('en-US');
    const hi = Math.round(t.mediumMax).toLocaleString('en-US');
    return { low: `< ${lo}`, medium: `${lo}–${hi}`, high: `> ${hi}` };
  }
  const min = values.length ? Math.min(...values) : 0;
  if (t.method === 'single') {
    const v = fmt(t.mediumMax, t.integer);
    return { low: '—', medium: v, high: '—' };
  }
  if (t.integer) {
    return {
      low: `${fmt(min, true)}–${fmt(t.lowMax, true)}`,
      medium: `${fmt(t.lowMax + 1, true)}–${fmt(t.mediumMax, true)}`,
      high: `${fmt(t.mediumMax + 1, true)}+`,
    };
  }
  return {
    low: `≤ ${fmt(t.lowMax, false)}`,
    medium: `≤ ${fmt(t.mediumMax, false)}`,
    high: `> ${fmt(t.mediumMax, false)}`,
  };
}

/**
 * Build the choropleth for a metric. `mode: 'district'` colours each district in `stateId` by its
 * own value; `mode: 'state'` colours every district by its STATE's summed value (so states read as
 * uniform blocks while district/state boundaries stay visible above). Returns null when the metric
 * has no numeric data in the relevant scope.
 */
export function buildHeatmap(params: {
  records: DatasetRecord[];
  mode: 'state' | 'district';
  metric: { datasetType: string; subType: string };
  /** '' = all-India (state mode). For district mode, the selected state to scope to. */
  stateId: string;
  districtToState: ReadonlyMap<string, string>;
  thresholdOverride?: { lowMax: number; mediumMax: number };
}): HeatmapResult | null {
  const { records, mode, metric, stateId, districtToState, thresholdOverride } = params;

  const metricRecords = records.filter(
    (r) => r.datasetType === metric.datasetType && r.subType === metric.subType && isNum(r.value),
  );
  if (metricRecords.length === 0) return null;
  const unit = metricRecords[0]!.unit;

  const classByDistrictId = new Map<string, HeatmapClass>();
  let values: number[];

  if (mode === 'district') {
    const scope = stateId
      ? new Set([...districtToState].filter(([, s]) => s === stateId).map(([d]) => d))
      : null;
    const byDistrict = new Map<string, number>();
    for (const r of metricRecords) {
      if (scope && !scope.has(r.districtId)) continue;
      byDistrict.set(r.districtId, (byDistrict.get(r.districtId) ?? 0) + (r.value as number));
    }
    if (byDistrict.size === 0) return null;
    values = [...byDistrict.values()];
    const t = computeThresholds(values, unit, thresholdOverride);
    for (const [districtId, v] of byDistrict) classByDistrictId.set(districtId, classOf(v, t));
    const scopeSize = scope ? scope.size : districtToState.size;
    return finalize(metric, unit, t, values, classByDistrictId, scopeSize);
  }

  // state mode — sum per state, then paint every district of a state with its class.
  const byState = new Map<string, number>();
  for (const r of metricRecords) {
    const s = districtToState.get(r.districtId);
    if (s === undefined) continue;
    byState.set(s, (byState.get(s) ?? 0) + (r.value as number));
  }
  if (byState.size === 0) return null;
  values = [...byState.values()];
  const t = computeThresholds(values, unit, thresholdOverride);
  const stateClass = new Map<string, HeatmapClass>();
  for (const [s, v] of byState) stateClass.set(s, classOf(v, t));
  for (const [districtId, s] of districtToState) {
    const c = stateClass.get(s);
    if (c) classByDistrictId.set(districtId, c);
  }
  return finalize(metric, unit, t, values, classByDistrictId, districtToState.size);
}

function finalize(
  metric: { datasetType: string; subType: string },
  unit: string,
  thresholds: Thresholds,
  values: number[],
  classByDistrictId: Map<string, HeatmapClass>,
  scopeSize: number,
): HeatmapResult {
  let low = 0, medium = 0, high = 0;
  for (const c of classByDistrictId.values()) {
    if (c === 'low') low++;
    else if (c === 'medium') medium++;
    else high++;
  }
  return {
    datasetType: metric.datasetType,
    subType: metric.subType,
    unit,
    thresholds,
    legend: legendText(values, thresholds),
    classByDistrictId,
    counts: { low, medium, high, noData: Math.max(0, scopeSize - classByDistrictId.size) },
  };
}
