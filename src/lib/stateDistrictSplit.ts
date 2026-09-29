/**
 * Persisted UI preference for the vertical split between the StatePanel (top) and the
 * DistrictPanel (bottom) when both are open in the stacked right-side explorer.
 *
 * This is a UI preference ONLY, kept entirely separate from district data and from the
 * horizontal panel-WIDTH preference — different key, different module. It stores a single
 * normalized fraction (the StatePanel's share of the usable height), which survives viewport
 * and panel-width changes better than an absolute pixel value.
 */

const STORAGE_KEY = 'indias-map.stateDistrictSplit.v1';

/** Height of the draggable divider between the two panels, in px. */
export const PANEL_STACK_RESIZER_PX = 8;

export const STATE_PANEL_MIN_HEIGHT = 220;
export const DISTRICT_PANEL_MIN_HEIGHT = 260;

/** Default split when nothing is persisted: StatePanel ≈ 45%, DistrictPanel ≈ 55%. */
export const DEFAULT_STATE_FRACTION = 0.45;

/** Column height available to the two panels once the divider's own height is removed. */
export function usableHeight(totalPx: number): number {
  return Math.max(0, totalPx - PANEL_STACK_RESIZER_PX);
}

/**
 * Clamp a desired StatePanel height so neither panel drops below its minimum. When the column
 * is too short to honour both minimums, the StatePanel minimum wins and the DistrictPanel
 * takes whatever remains — the divider can never make either panel vanish.
 */
export function clampStateHeight(desiredPx: number, totalPx: number): number {
  const usable = usableHeight(totalPx);
  const max = Math.max(STATE_PANEL_MIN_HEIGHT, usable - DISTRICT_PANEL_MIN_HEIGHT);
  return Math.min(Math.max(Math.round(desiredPx), STATE_PANEL_MIN_HEIGHT), max);
}

/** Resolve a stored fraction to a clamped StatePanel pixel height for the current column. */
export function stateHeightFromFraction(fraction: number, totalPx: number): number {
  return clampStateHeight(fraction * usableHeight(totalPx), totalPx);
}

/** Convert a StatePanel pixel height back to a fraction of the usable height, for persistence. */
export function fractionFromStateHeight(statePx: number, totalPx: number): number {
  const usable = usableHeight(totalPx);
  return usable > 0 ? statePx / usable : DEFAULT_STATE_FRACTION;
}

/** Restore the saved fraction, or null when absent/invalid/unavailable. */
export function loadStateFraction(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
  } catch {
    return null;
  }
}

export function saveStateFraction(fraction: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(fraction));
  } catch {
    /* preference is best-effort; ignore storage failures */
  }
}
