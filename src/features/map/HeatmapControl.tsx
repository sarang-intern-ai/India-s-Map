import { MAP_COLORS } from './mapTheme.ts';
import type { HeatmapMode, HeatmapResult, MetricOption } from '../../data/heatmap.ts';

/**
 * The map heatmap control (overlay, top-left) + legend. Presentational only — the Explorer owns the
 * heatmap state and computes the result; this renders the mode toggle, the data-driven metric
 * selector (dataset type → subtype, from the actual available metrics), and the 3-class legend with
 * the real unit and computed thresholds. It never touches the map, selection or scope.
 */
function Btn({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition focus:ring-2 focus:ring-accent-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-accent-600 bg-accent-100 text-accent-900'
          : 'border-ink-300 bg-white text-ink-700 hover:border-ink-400 hover:bg-ink-50'
      }`}
    >
      {children}
    </button>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: color }} />;
}

export function HeatmapControl({
  mode,
  onModeChange,
  stateSelected,
  metrics,
  metric,
  onMetricChange,
  result,
}: {
  mode: HeatmapMode;
  onModeChange: (m: HeatmapMode) => void;
  stateSelected: boolean;
  metrics: MetricOption[];
  metric: { datasetType: string; subType: string } | null;
  onMetricChange: (m: { datasetType: string; subType: string }) => void;
  result: HeatmapResult | null;
}) {
  const selectedType = metrics.find((m) => m.datasetType === metric?.datasetType) ?? null;

  return (
    <div className="pointer-events-auto absolute top-16 left-3 z-10 w-60 rounded-lg border border-ink-200 bg-white/95 p-2 text-ink-900 shadow-lg backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Heatmap</span>
        {mode !== 'off' && (
          <button
            type="button"
            onClick={() => onModeChange('off')}
            className="text-[11px] font-medium text-accent-700 hover:text-accent-900 focus:outline-none"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <Btn active={mode === 'off'} onClick={() => onModeChange('off')}>Off</Btn>
        <Btn active={mode === 'state'} onClick={() => onModeChange('state')}>State-wise</Btn>
        <Btn
          active={mode === 'district'}
          disabled={!stateSelected}
          onClick={() => onModeChange('district')}
          title={stateSelected ? undefined : 'Select a State/UT first'}
        >
          District-wise
        </Btn>
      </div>

      {mode !== 'off' && (
        <div className="mt-2 space-y-1.5">
          {metrics.length === 0 ? (
            <p className="text-[11px] text-ink-400">No numeric metrics available for this scope.</p>
          ) : (
            <>
              <div>
                <div className="mb-0.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">Dataset</div>
                <div className="flex flex-wrap gap-1">
                  {metrics.map((m) => (
                    <Btn
                      key={m.datasetType}
                      active={metric?.datasetType === m.datasetType}
                      onClick={() => onMetricChange({ datasetType: m.datasetType, subType: m.subTypes[0]!.subType })}
                    >
                      {m.datasetType}
                    </Btn>
                  ))}
                </div>
              </div>
              {selectedType && (
                <div>
                  <div className="mb-0.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">Metric</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedType.subTypes.map((s) => (
                      <Btn
                        key={s.subType}
                        active={metric?.subType === s.subType}
                        onClick={() => onMetricChange({ datasetType: selectedType.datasetType, subType: s.subType })}
                      >
                        {s.subType}
                      </Btn>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode !== 'off' && (
        <div className="mt-2 border-t border-ink-100 pt-2">
          {result ? (
            <>
              <div className="mb-1 text-[10px] font-medium tracking-wide text-ink-500">
                {result.subType} — {result.unit || 'value'}
              </div>
              <ul className="space-y-0.5 text-[11px] text-ink-700">
                <li className="flex items-center gap-1.5"><Swatch color={MAP_COLORS.heatLow} /> Low <span className="tabular ml-auto text-ink-500">{result.legend.low}</span></li>
                <li className="flex items-center gap-1.5"><Swatch color={MAP_COLORS.heatMedium} /> Medium <span className="tabular ml-auto text-ink-500">{result.legend.medium}</span></li>
                <li className="flex items-center gap-1.5"><Swatch color={MAP_COLORS.heatHigh} /> High <span className="tabular ml-auto text-ink-500">{result.legend.high}</span></li>
                <li className="flex items-center gap-1.5"><Swatch color={MAP_COLORS.heatNoData} /> No data <span className="tabular ml-auto text-ink-400">{result.counts.noData}</span></li>
              </ul>
              {result.thresholds.method === 'demo' && (
                <p className="mt-1.5 text-[10px] leading-tight text-amber-700" title="Placeholder cut-offs for previewing the UI — not official domain thresholds.">
                  Demo thresholds — provisional, for preview only.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-ink-400">
              {metric ? 'No data for this metric in the current scope.' : 'Pick a metric to colour the map.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
