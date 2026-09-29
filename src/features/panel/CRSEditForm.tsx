import { useState } from 'react';
import type { CrsEditBody } from '../../data/crsApi.ts';

/**
 * Inline form for adding or editing a CRS. Shared by the "+ Add CRS" affordance and each record's
 * Edit action so the fields, validation and styling stay identical. It only collects and validates
 * input; persistence (API → Excel → sync) is the caller's responsibility. Name of CRS is required;
 * No. of Hours must be blank or a number ≥ 0. The canonical district is fixed by context (the open
 * district), so it is shown read-only and never free-typed.
 */
export type CrsFormValues = {
  crsName: string;
  organization: string;
  location: string;
  language: string;
  hours: string; // kept as string in the input; coerced on submit
};

const EMPTY: CrsFormValues = { crsName: '', organization: '', location: '', language: '', hours: '' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium tracking-wide text-ink-400 uppercase">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs text-ink-900 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none';

export function CRSEditForm({
  mode,
  districtName,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  districtName: string;
  initial?: Partial<CrsFormValues>;
  busy: boolean;
  error: string | null;
  /** Returns the changed/entered fields; caller maps to the API body. */
  onSubmit: (values: CrsEditBody) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<CrsFormValues>({ ...EMPTY, ...initial });
  const set = (k: keyof CrsFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const hoursInvalid = v.hours.trim() !== '' && !(Number.isFinite(Number(v.hours)) && Number(v.hours) >= 0);
  const canSubmit = v.crsName.trim() !== '' && !hoursInvalid && !busy;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      crsName: v.crsName.trim(),
      organization: v.organization.trim() || null,
      location: v.location.trim() || null,
      language: v.language.trim() || null,
      hours: v.hours.trim() === '' ? null : Number(v.hours),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-accent-200 bg-accent-50/40 p-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-600">
        {mode === 'add' ? 'Add CRS' : 'Edit CRS'} · <span className="font-normal text-ink-500">{districtName}</span>
      </p>
      <Row label="Name of CRS *">
        <input className={inputCls} value={v.crsName} onChange={set('crsName')} autoFocus placeholder="e.g. Radio ABC" spellCheck={false} />
      </Row>
      <Row label="Name of Organization">
        <input className={inputCls} value={v.organization} onChange={set('organization')} spellCheck={false} />
      </Row>
      <Row label="Location of CRS">
        <input className={inputCls} value={v.location} onChange={set('location')} spellCheck={false} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Language">
          <input className={inputCls} value={v.language} onChange={set('language')} placeholder="Not available" spellCheck={false} />
        </Row>
        <Row label="No. of Hours">
          <input className={inputCls} value={v.hours} onChange={set('hours')} inputMode="decimal" placeholder="blank = N/A" spellCheck={false} />
        </Row>
      </div>
      {hoursInvalid && <p className="text-[11px] text-rose-600">No. of Hours must be a number ≥ 0, or blank.</p>}
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button type="button" onClick={onCancel} disabled={busy}
          className="rounded-md border border-ink-300 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit}
          className="rounded-md border border-accent-600 bg-accent-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Saving…' : mode === 'add' ? 'Add' : 'Save'}
        </button>
      </div>
    </form>
  );
}
