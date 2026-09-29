import type { MapMode } from './mapTheme.ts';

/**
 * Compact map-view toggle: [ State | District ]. Presentational only — the Explorer owns the
 * `mapMode` state and hands it here. Styled to match the light dashboard: white surface, light-grey
 * border, blue active segment. Kept small so it never dominates the map, and it lives in the map's
 * top-left control stack (above the heatmap control).
 */
export function MapModeControl({
  mode,
  onModeChange,
}: {
  mode: MapMode;
  onModeChange: (m: MapMode) => void;
}) {
  const Segment = ({ value, label, title }: { value: MapMode; label: string; title: string }) => {
    const active = mode === value;
    return (
      <button
        type="button"
        aria-pressed={active}
        title={title}
        onClick={() => onModeChange(value)}
        className={`rounded-md px-3 py-1 text-[12px] font-semibold transition focus:ring-2 focus:ring-accent-200 focus:outline-none ${
          active
            ? 'bg-accent-600 text-white shadow-sm'
            : 'bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-800'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="pointer-events-auto absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-ink-200 bg-white/95 p-1 shadow-md backdrop-blur-sm">
      <span className="px-1.5 text-[10px] font-semibold tracking-wider text-brand-700 uppercase">Map</span>
      <Segment value="state" label="State" title="Show only state boundaries" />
      <Segment value="district" label="District" title="Show the full district map" />
    </div>
  );
}
