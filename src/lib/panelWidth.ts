/**
 * Persisted UI preference for the district panel's docked width.
 *
 * This is a UI preference ONLY and is kept entirely separate from district data
 * persistence — different key, different module. It stores a single number (pixels).
 */

const STORAGE_KEY = 'indias-map.panelWidth.v1';

export const PANEL_MIN_WIDTH = 320;
export const DEFAULT_PANEL_WIDTH = 360;

/** Maximum docked width: 60% of the viewport, never below the minimum. */
export function panelMaxWidth(viewportWidth: number): number {
  return Math.max(PANEL_MIN_WIDTH, Math.round(viewportWidth * 0.6));
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = panelMaxWidth(viewportWidth);
  return Math.min(Math.max(Math.round(width), PANEL_MIN_WIDTH), max);
}

/** Restore the saved width, or null when absent/invalid/unavailable. */
export function loadPanelWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function savePanelWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    /* preference is best-effort; ignore storage failures */
  }
}
