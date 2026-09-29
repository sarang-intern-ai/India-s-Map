import type { Field, FieldValue } from './fields.ts';

/**
 * Reusable read-only renderer for a list of {@link Field}s.
 *
 * This is deliberately dumb: it takes resolved fields and lays them out as a description
 * list. A future editable table would be a sibling component consuming the same `Field[]`,
 * so replacing read-only display with editing is a swap here, not a rewrite of the panel.
 */
function ValueText({ value }: { value: FieldValue }) {
  if (value.kind === 'unavailable') {
    return <span className="text-ink-400 italic">{value.text}</span>;
  }
  const mono = value.kind === 'code' || value.kind === 'measure';
  return (
    <span className={`text-ink-900 ${mono ? 'tabular font-medium' : ''}`}>{value.text}</span>
  );
}

export function FieldTable({ fields }: { fields: Field[] }) {
  return (
    <dl className="divide-y divide-ink-100">
      {fields.map((field) => (
        <div key={field.key} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="shrink-0 text-xs text-ink-500">{field.label}</dt>
          <dd className="min-w-0 text-right text-sm">
            <ValueText value={field.value} />
            {field.hint && (
              <span className="mt-0.5 block text-[11px] leading-tight text-ink-400">
                {field.hint}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
