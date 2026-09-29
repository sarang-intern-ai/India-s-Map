/**
 * One YouTube channel. Mirrors {@link CRSRecordCard}'s look and lifted open/close state (so several
 * channels can be open at once). Expanded shows ONLY No. of Hours and Language — nothing else.
 *
 * This is the presentation shape a real YouTube source will populate later; there is no data source
 * yet, so the list that renders these is empty for now.
 */
export type YouTubeChannel = {
  /** Stable identity (a future source will supply this, e.g. a reconciled record key). */
  id: string;
  channelName: string;
  hours: number | null;
  language: string | null;
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

export function YouTubeChannelCard({
  channel,
  open,
  onToggle,
}: {
  channel: YouTubeChannel;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-ink-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-ink-50 focus:ring-2 focus:ring-accent-200 focus:outline-none"
      >
        <span aria-hidden="true" className="text-[10px] text-ink-400">{open ? '▼' : '▸'}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{channel.channelName}</span>
      </button>
      {open && (
        <dl className="divide-y divide-ink-100 border-t border-ink-100 bg-ink-50/40">
          {/* ONLY these two attributes — no organization/location/contact. */}
          <Field label="No. of Hours" value={channel.hours != null ? `${channel.hours} hours` : null} />
          <Field label="Language" value={channel.language} />
        </dl>
      )}
    </div>
  );
}
