import type { ValueType } from '../../data/districtDataTree.ts';

/**
 * The input control for a value node, chosen by its {@link ValueType}. Emits a string for
 * every type except boolean (which emits a boolean) — validation/coercion to the persisted
 * typed value happens in districtDataTree.
 */
export function ValueEditor({
  valueType,
  value,
  onChange,
  invalid,
  describedBy,
  inputId,
}: {
  valueType: ValueType;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
  invalid?: boolean;
  describedBy?: string;
  inputId: string;
}) {
  const border = invalid
    ? 'border-rose-400 focus:ring-rose-200'
    : 'border-ink-300 focus:border-accent-600 focus:ring-accent-200';
  const base = `w-full rounded border bg-white px-2 py-1 text-sm text-ink-900 focus:ring-2 focus:outline-none ${border}`;

  if (valueType === 'boolean') {
    const on = value === true;
    return (
      <label className="flex items-center gap-2 py-1 text-sm text-ink-700">
        <input
          id={inputId}
          type="checkbox"
          checked={on}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-200"
        />
        {on ? 'Yes' : 'No'}
      </label>
    );
  }

  const str = typeof value === 'string' ? value : '';
  const common = {
    id: inputId,
    value: str,
    'aria-invalid': invalid ? (true as const) : undefined,
    'aria-describedby': describedBy,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
  };

  switch (valueType) {
    case 'number':
      return <input {...common} type="text" inputMode="decimal" placeholder="Number" className={`tabular text-right ${base}`} />;
    case 'percentage':
      return (
        <div className="relative">
          <input {...common} type="text" inputMode="decimal" placeholder="0–100" className={`tabular pr-6 text-right ${base}`} />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-ink-400">%</span>
        </div>
      );
    case 'currency':
      return (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-ink-400">₹</span>
          <input {...common} type="text" inputMode="decimal" placeholder="Amount" className={`tabular pl-5 text-right ${base}`} />
        </div>
      );
    case 'date':
      return <input {...common} type="date" className={`tabular ${base}`} />;
    case 'url':
      return <input {...common} type="url" placeholder="https://…" className={base} />;
    case 'text':
    default:
      return <input {...common} type="text" placeholder="Value" className={base} />;
  }
}
