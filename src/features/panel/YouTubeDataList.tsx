import { useState } from 'react';
import { YouTubeChannelCard, type YouTubeChannel } from './YouTubeChannelCard.tsx';

/**
 * The "YOUTUBE DATA" expandable for the selected district — the same shape and behaviour as
 * {@link CRSDataList}: a collapsible section whose channels each expand independently, with several
 * open at once, and a search once the list is long.
 *
 * There is NO YouTube data source yet (no Excel/Word/CSV, no PostgreSQL table). So `channels` is
 * always empty here and the section shows "No YouTube data available." When a real source is added
 * later, populate `channels` (e.g. from `/api/youtube/district/:districtId`, kept fully separate
 * from CRS) — the list, expand behaviour, and card layout already work with zero UI changes.
 *
 * Kept completely separate from CRS: its own component, its own state, and (later) its own source
 * and aggregate, so YouTube totals never mix with CRS station counts.
 */
export function YouTubeDataList({ districtId: _districtId }: { districtId: string }) {
  // No source yet — intentionally empty. A future source fills this (see the module comment).
  const channels: YouTubeChannel[] = [];

  const [sectionOpen, setSectionOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id); // opening one never closes another (independent state)
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtered = q ? channels.filter((c) => c.channelName.toLowerCase().includes(q)) : channels;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-ink-200 bg-white shadow-card">
      <button
        type="button"
        onClick={() => setSectionOpen((o) => !o)}
        aria-expanded={sectionOpen}
        className="flex w-full items-center gap-2 border-b border-ink-200 bg-flame-50 px-3 py-2 text-left transition hover:bg-flame-100 focus:ring-2 focus:ring-accent-200 focus:outline-none"
      >
        <span aria-hidden="true" className="text-[10px] text-flame-600">{sectionOpen ? '▼' : '▸'}</span>
        <span className="flex-1 text-[11px] font-semibold tracking-wider text-flame-600 uppercase">YouTube data</span>
        {channels.length > 0 && <span className="tabular text-[11px] text-ink-400">{channels.length}</span>}
      </button>

      {sectionOpen && (
        <div className="p-2">
          {channels.length > 5 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels…"
              autoComplete="off"
              spellCheck={false}
              className="mb-2 w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs text-ink-900 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none"
            />
          )}
          {channels.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-ink-400">No YouTube data available.</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.map((c) => (
                <YouTubeChannelCard key={c.id} channel={c} open={openIds.has(c.id)} onToggle={() => toggle(c.id)} />
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-ink-400">No channel matches “{query.trim()}”.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
