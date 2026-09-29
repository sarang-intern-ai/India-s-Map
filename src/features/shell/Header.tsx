import type { Manifest } from '../../data/schema.ts';

export function Header({ manifest }: { manifest: Manifest }) {
  const partial = manifest.reconciliation.mode === 'partial';

  return (
    <header className="flex shrink-0 items-center justify-between gap-6 border-b border-ink-200 bg-white px-5 py-3">
      <div className="min-w-0">
        <h1 className="text-base leading-tight font-semibold tracking-tight text-brand-800">
          India&rsquo;s Map
        </h1>
        <p className="truncate text-xs text-ink-500">
          {manifest.counts.districtFeatures} districts across {manifest.counts.states} states and{' '}
          {manifest.counts.unionTerritories} union territories, from Local Government Directory
          boundaries.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {partial && (
          <span
            title={manifest.reconciliation.note}
            className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800"
          >
            Provisional dataset
          </span>
        )}
        <span className="tabular rounded-full border border-ink-200 bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-600">
          {manifest.vintage}
        </span>
      </div>
    </header>
  );
}
