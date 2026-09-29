import { useRef } from 'react';
import { useDatasetRecords } from '../../state/datasetRecords.tsx';

/**
 * The external-datasets status + controls, shown once at the top of the External datasets
 * section (not per district). Reports where the data came from (Demo / Google Sheets / Excel),
 * when it was last loaded, and offers a manual Refresh, an Excel upload, a worksheet picker for
 * multi-sheet workbooks, and an isolated error state with Retry.
 *
 * It is source-agnostic UI: it shows a label the provider layer computed, never branching on the
 * source itself.
 */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatIso(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

export function DatasetSourceBar({ compact = false }: { compact?: boolean }) {
  const {
    status,
    sourceLabel,
    sourceKind,
    lastLoadedAt,
    googleConfigured,
    availableSheets,
    note,
    error,
    syncInfo,
    refresh,
    retry,
    loadExcelFile,
    chooseSheet,
  } = useDatasetRecords();
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="mb-2 rounded-md border border-ink-200 bg-white px-3 py-2 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs text-ink-700">
            <span className="text-ink-500">External dataset:</span>{' '}
            <span className="font-medium">{sourceLabel}</span>
            {sourceKind === 'local' && <span className="text-ink-400"> · using demo dataset</span>}
          </p>
          <p className="text-[11px] text-ink-400">
            {status === 'loading'
              ? 'Loading…'
              : lastLoadedAt
                ? `Last loaded ${formatTime(lastLoadedAt)}`
                : 'Not loaded yet'}
          </p>
          {/* Sync status (postgres source). Not "real-time" — data appears within a poll interval. */}
          {syncInfo &&
            (syncInfo.status === 'failed' ? (
              <p className="text-[11px] font-medium text-amber-700">
                Sync issue — serving last successful data
              </p>
            ) : (
              <p className="text-[11px] text-ink-400">
                Data updated {formatIso(syncInfo.lastUpdated)} · synced {formatIso(syncInfo.lastSyncedAt)}
              </p>
            ))}
        </div>
        {!compact && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={refresh}
              disabled={status === 'loading'}
              className="rounded-md border border-accent-600 bg-accent-600 px-2 py-1 text-xs font-medium text-white transition hover:border-accent-700 hover:bg-accent-700 focus:ring-2 focus:ring-accent-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refresh data
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 transition hover:border-ink-400 hover:bg-ink-50 focus:ring-2 focus:ring-accent-200 focus:outline-none"
            >
              Load Excel…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadExcelFile(f);
                e.target.value = ''; // allow re-selecting the same file
              }}
            />
          </div>
        )}
      </div>

      {note && <p className="mt-1.5 text-[11px] text-ink-500">{note}</p>}

      {!compact && !googleConfigured && (
        <p className="mt-1.5 text-[11px] text-ink-400">
          Google Sheets is not configured. Set <code>VITE_GOOGLE_SHEETS_CSV_URL</code> to a
          published CSV URL to use it.
        </p>
      )}

      {!compact && status === 'needs-sheet' && availableSheets && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
          <label className="block text-[11px] font-medium text-amber-800">
            This workbook has several worksheets — choose one:
            <select
              defaultValue=""
              onChange={(e) => e.target.value && chooseSheet(e.target.value)}
              className="mt-1 block w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-ink-800 focus:ring-2 focus:ring-accent-200 focus:outline-none"
            >
              <option value="" disabled>
                Select a worksheet…
              </option>
              {availableSheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!compact && status === 'error' && error && (
        <div className="mt-2 flex items-start justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-rose-800">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-800 transition hover:bg-rose-100 focus:ring-2 focus:ring-accent-200 focus:outline-none"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
