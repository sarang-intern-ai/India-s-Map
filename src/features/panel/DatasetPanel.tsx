import type { DatasetValue } from '../../data/datasetRecords.ts';
import type { DatasetAggregate } from '../../data/aggregateDatasetRecords.ts';

/**
 * Renders ONE dataset type (e.g. "Speech") from a {@link DatasetAggregate} — unit-aware totals
 * plus, in the district view, the atomic subType rows grouped by unit. Entirely generic: it is
 * handed a datasetType and its aggregate and knows nothing about which types exist. A brand-new
 * type in the source ("Video", "Social Media") flows through here with no code change.
 *
 * Two views, one component:
 *  - `showSubcategories` (district): per unit → a **Total** line then each subType record.
 *  - totals-only (state): just the per-unit totals; the subType breakdown lives in the districts.
 */

/** Group with grouping separators — display only, never a unit conversion. */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Present a value: numbers grouped, booleans as Yes/No, text verbatim. Formatting only. */
function formatValue(value: DatasetValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function TotalRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 bg-ink-50/60 px-3 py-1.5">
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="shrink-0 text-right text-sm">
        <span className="tabular font-semibold text-ink-900">{formatNumber(value)}</span>
        {unit && <span className="ml-1 text-ink-500">{unit}</span>}
      </dd>
    </div>
  );
}

export function DatasetPanel({
  aggregate,
  showSubcategories = true,
  hideSubtypeRows = false,
}: {
  aggregate: DatasetAggregate;
  showSubcategories?: boolean;
  /**
   * District view only: render each unit's header + TOTAL but omit the per-subType rows. Used for
   * the Speech section, whose per-station detail is presented (and joined with Speech hours) in the
   * CRS DATA cards below — so Speech reads as a district SUMMARY (HOURS TOTAL / STATIONS TOTAL).
   */
  hideSubtypeRows?: boolean;
}) {
  const { datasetType, totalsByUnit, duplicateSubTypes } = aggregate;
  const dup = new Set(duplicateSubTypes);
  const multiUnit = totalsByUnit.length > 1;

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-card">
      <div className="border-b border-ink-200 bg-flame-50 px-3 py-2">
        <h4 className="text-[11px] font-semibold tracking-wider text-flame-600 uppercase">
          {datasetType}
        </h4>
      </div>

      {!showSubcategories ? (
        // State view: unit-aware totals only.
        totalsByUnit.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-ink-400">No numeric total (non-numeric data — see districts).</p>
        ) : (
          <dl>
            {totalsByUnit.map((t) => (
              <TotalRow key={t.unit || '∅'} label={multiUnit ? capitalize(t.unit) || 'Total' : 'Total'} value={t.value} unit={t.unit} />
            ))}
          </dl>
        )
      ) : (
        // District view: per unit → Total, then that unit's subType records.
        <DistrictBody aggregate={aggregate} dup={dup} hideSubtypeRows={hideSubtypeRows} />
      )}
    </div>
  );
}

/** District rendering: preserve first-seen unit order; a Total line heads each unit's records. */
function DistrictBody({ aggregate, dup, hideSubtypeRows = false }: { aggregate: DatasetAggregate; dup: Set<string>; hideSubtypeRows?: boolean }) {
  const { totalsByUnit, records } = aggregate;
  const totalFor = (unit: string) => totalsByUnit.find((t) => t.unit === unit)?.value;

  // In summary mode, drive the layout off the unit TOTALS (so every unit shows even if its subtype
  // rows are hidden); otherwise group the subtype records by unit in first-seen order.
  const unitOrder: string[] = [];
  const byUnit = new Map<string, typeof records>();
  if (hideSubtypeRows) {
    for (const t of totalsByUnit) unitOrder.push(t.unit);
  } else {
    for (const r of records) {
      const bucket = byUnit.get(r.unit);
      if (bucket) bucket.push(r);
      else {
        byUnit.set(r.unit, [r]);
        unitOrder.push(r.unit);
      }
    }
  }
  // Show the unit header when there is more than one unit, or always in summary mode (so a
  // single-unit Speech summary still reads "HOURS / TOTAL …").
  const showUnitHeader = unitOrder.length > 1 || hideSubtypeRows;

  return (
    <div className="divide-y divide-ink-100">
      {unitOrder.map((unit) => {
        const total = totalFor(unit);
        const recs = byUnit.get(unit) ?? [];
        return (
          <div key={unit || '∅'}>
            {showUnitHeader && unit && (
              <p className="px-3 pt-1.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">
                {capitalize(unit)}
              </p>
            )}
            {total !== undefined && <TotalRow label="Total" value={total} unit={unit} />}
            {!hideSubtypeRows && (
            <dl className="divide-y divide-ink-100">
              {recs.map((r, i) => (
                <div key={`${r.subType}-${i}`} className="flex items-baseline justify-between gap-4 px-3 py-2">
                  <dt className="min-w-0 text-sm text-ink-700">
                    {r.subType}
                    {dup.has(r.subType) && (
                      <span
                        className="ml-1.5 align-middle text-[10px] font-medium text-amber-600"
                        title="This subcategory appears more than once for this district. Both rows are shown; it is excluded from the total until resolved."
                      >
                        (duplicate — excluded from total)
                      </span>
                    )}
                  </dt>
                  <dd className="shrink-0 text-right text-sm">
                    <span className="tabular font-medium text-ink-900">{formatValue(r.value)}</span>
                    {r.unit && <span className="ml-1 text-ink-500">{r.unit}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
