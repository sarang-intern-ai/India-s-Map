import { useState } from 'react';
import type { CrsEditBody } from '../../data/crsApi.ts';
import type { SpeechMeta } from '../../data/crsSpeechJoin.ts';
import { CRSEditForm } from './CRSEditForm.tsx';

const HOURS_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * One Community Radio station. Collapsed shows only its name (lightweight — many may be listed);
 * expanded shows its attributes and, when editing is enabled, Edit / Delete actions. Each card owns
 * only local UI state (edit-form open, delete-confirm); `open`/`onToggle` are lifted to the list so
 * several cards can be open at once (see {@link CRSDataList}). Persistence goes through the list's
 * handlers → API → Excel → sync.
 */
export type CrsRow = {
  id: string;
  sNo: number | null;
  crsName: string;
  organization: string | null;
  location: string | null;
  language: string | null;
  hours: number | null;
};

/** Blank source values render as "Not available" — never invented, never 0/Unknown/N/A. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="px-3 py-1.5">
      <dt className="text-[10px] font-medium tracking-wide text-ink-400 uppercase">{label}</dt>
      <dd className={`text-xs ${value ? 'text-ink-800' : 'text-ink-400 italic'}`}>
        {value ?? 'Not available'}
      </dd>
    </div>
  );
}

export function CRSRecordCard({
  record,
  speech,
  open,
  onToggle,
  districtName,
  onSave,
  onDelete,
  busy,
  error,
}: {
  record: CrsRow;
  /** Matched Speech-hours metadata (Location / Language/s / hours) from the crs-speech source, or
   *  null when no matching Speech record exists. Enriches the DISPLAY only — the edit form still
   *  operates on this card's authoritative CRS(data).xlsx values. */
  speech?: SpeechMeta | null;
  open: boolean;
  onToggle: () => void;
  /** When set, editing is enabled (PostgreSQL source). */
  districtName?: string;
  /** Save routes each field to its owning source (see CRSDataList.onSave); the card passes its own
   *  record + matched Speech metadata so the diff is against the current JOINED values. */
  onSave?: (record: CrsRow, speech: SpeechMeta | null, fields: CrsEditBody) => Promise<boolean>;
  onDelete?: (sourceKey: string) => Promise<boolean>;
  busy?: boolean;
  error?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const canEdit = !!onSave && !!onDelete && !!districtName;

  // Displayed values: prefer the Speech source for Location / Language / Hours when a matching
  // Speech record exists and the field is populated; otherwise fall back to the CRS-source value.
  // (missing ≠ zero: hours uses an explicit null check, never a falsy check.)
  const displayLocation = speech?.location ?? record.location;
  const displayLanguage = speech?.language ?? record.language;
  const displayHours = speech && speech.hours != null ? speech.hours : record.hours;

  const handleSave = async (fields: CrsEditBody) => {
    if (!onSave) return;
    const ok = await onSave(record, speech ?? null, fields);
    if (ok) setEditing(false);
  };
  const handleDelete = async () => {
    if (!onDelete) return;
    const ok = await onDelete(record.id);
    if (ok) setConfirming(false);
  };

  return (
    <div className="overflow-hidden rounded-md border border-ink-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-ink-50 focus:ring-2 focus:ring-accent-200 focus:outline-none"
      >
        <span aria-hidden="true" className="text-[10px] text-ink-400">{open ? '▼' : '▸'}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{record.crsName}</span>
        {record.sNo != null && <span className="tabular shrink-0 text-[11px] text-ink-400">#{record.sNo}</span>}
      </button>
      {open && !editing && (
        <>
          <dl className="divide-y divide-ink-100 border-t border-ink-100 bg-ink-50/40">
            <Field label="Name of Organization" value={record.organization} />
            <Field label="Location of CRS" value={displayLocation} />
            <Field label="Language" value={displayLanguage} />
            <Field label="No. of Hours" value={displayHours != null ? `${HOURS_FMT.format(displayHours)} hours` : null} />
          </dl>
          {canEdit && (
            <div className="border-t border-ink-100 bg-white px-2.5 py-1.5">
              {!confirming ? (
                <div className="flex items-center justify-end gap-1.5">
                  <button type="button" onClick={() => setEditing(true)}
                    className="rounded-md border border-ink-300 bg-white px-2 py-1 text-[11px] font-medium text-ink-700 transition hover:bg-ink-50 focus:ring-2 focus:ring-accent-200 focus:outline-none">
                    Edit
                  </button>
                  <button type="button" onClick={() => setConfirming(true)}
                    className="rounded-md border border-rose-300 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-50 focus:ring-2 focus:ring-rose-200 focus:outline-none">
                    Delete
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-ink-600">Delete “{record.crsName}” from the workbook? This cannot be undone.</p>
                  {error && <p className="text-[11px] text-rose-600">{error}</p>}
                  <div className="flex items-center justify-end gap-1.5">
                    <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                      className="rounded-md border border-ink-300 bg-white px-2 py-1 text-[11px] font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50">
                      Cancel
                    </button>
                    <button type="button" onClick={handleDelete} disabled={busy}
                      className="rounded-md border border-rose-600 bg-rose-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {busy ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {open && editing && canEdit && (
        <div className="border-t border-ink-100 p-2">
          <CRSEditForm
            mode="edit"
            districtName={districtName!}
            initial={{
              crsName: record.crsName,
              organization: record.organization ?? '',
              // Pre-fill with the JOINED display values so the form shows what the card shows.
              location: displayLocation ?? '',
              language: displayLanguage ?? '',
              hours: displayHours != null ? String(displayHours) : '',
            }}
            busy={!!busy}
            error={error ?? null}
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
