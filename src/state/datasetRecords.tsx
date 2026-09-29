import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadDatasetRecords, type DatasetBundle } from '../data/loadDatasetRecords.ts';
import {
  buildDistrictAggregates,
  buildStateAggregates,
  type DatasetAggregate,
} from '../data/aggregateDatasetRecords.ts';
import {
  providerForSource,
  resolveConfiguredSource,
  sourceKind,
  sourceLabel,
  type ActiveSource,
  type SourceKind,
} from '../data/datasetSource.ts';
import { readWorkbookSheetNames } from '../data/excelProvider.ts';

/**
 * Loads the external dataset bundle and shares it. The bundle is source-agnostic: demo CSV,
 * Google Sheets, or Excel — chosen by configuration (env) or a user action (uploading a
 * workbook), never by the UI branching on source type.
 *
 * A refresh or a source switch replaces only the in-memory bundle. Selection lives in a separate
 * context, so `selectedStateId` / `selectedDistrictId` are preserved automatically, the user's
 * localStorage tree is untouched, and MapLibre is never reinitialized. External records are
 * read-only and never persisted.
 */

type Status = 'loading' | 'ready' | 'error' | 'needs-sheet';

/** Lightweight backend data version (from GET /api/datasets/version). `version` changes iff the
 *  served data changed — the frontend polls this cheaply and refreshes only when it moves. */
export type SyncInfo = {
  version: string;
  lastUpdated: string | null;
  status: string | null;
  lastSyncedAt: string | null;
};

/** Source-level failures that should surface as an isolated error state (with Retry). */
const FATAL_CODES = new Set([
  'source_unavailable',
  'invalid_response',
  'invalid_file',
  'no_worksheet',
  'missing_worksheet',
  'multiple_sheets',
  'missing_columns',
  'empty_source',
  'provider_failed',
]);

export type DatasetRecordsApi = {
  status: Status;
  /** Last successfully loaded bundle; kept across a failed refresh so panels don't blank out. */
  bundle: DatasetBundle | null;
  /** districtId → derived aggregates. Recomputed only when the bundle changes (not per render). */
  districtAggregates: ReadonlyMap<string, DatasetAggregate[]>;
  /** stateId → derived aggregates (totals summed from the districts). */
  stateAggregates: ReadonlyMap<string, DatasetAggregate[]>;
  error: string | null;
  sourceLabel: string;
  sourceKind: SourceKind;
  lastLoadedAt: number | null;
  /** True when a Google Sheets CSV URL is configured in env. */
  googleConfigured: boolean;
  /** Set when an uploaded workbook has multiple sheets and none is chosen yet. */
  availableSheets: string[] | null;
  /** Non-null when a requested external source fell back to the demo dataset. */
  note: string | null;
  /** Backend sync/version info (postgres source only) — powers the "data updated / last synced" UI
   *  and drives automatic refresh when the served data changes. */
  syncInfo: SyncInfo | null;
  /** The API base ("/api") when the source is PostgreSQL, else null — lets district-scoped detail
   *  views (e.g. CRS DATA) fetch from the same backend. */
  apiBase: string | null;
  refresh: () => void;
  retry: () => void;
  loadExcelFile: (file: File) => void;
  chooseSheet: (name: string) => void;
};

const DatasetRecordsContext = createContext<DatasetRecordsApi | null>(null);

const EMPTY_AGGREGATES: ReadonlyMap<string, DatasetAggregate[]> = new Map();

export function DatasetRecordsProvider({
  districtToState,
  children,
}: {
  /** Canonical districtId → stateId from the geographic hierarchy — the only join for state rollups. */
  districtToState: ReadonlyMap<string, string>;
  children: React.ReactNode;
}) {
  const resolved = useMemo(resolveConfiguredSource, []);
  // The id universe (for unknown-id diagnostics) is exactly the districts in the hierarchy.
  const districtIds = useMemo(() => new Set(districtToState.keys()), [districtToState]);

  const [source, setSource] = useState<ActiveSource>(resolved.source);
  const [nonce, setNonce] = useState(0); // bumped by refresh/retry to re-run the same source
  const [status, setStatus] = useState<Status>('loading');
  const [bundle, setBundle] = useState<DatasetBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  // A multi-sheet upload parked until the user picks a worksheet.
  const [pending, setPending] = useState<{ data: ArrayBuffer; fileName: string; sheets: string[] } | null>(
    null,
  );

  useEffect(() => {
    // A parked multi-sheet upload is a manual step, not a load — don't fetch.
    if (pending) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    loadDatasetRecords([providerForSource(source)], districtIds)
      .then((b) => {
        if (cancelled) return;
        for (const d of b.diagnostics) {
          const line = `[datasets] ${d.code}: ${d.message}`;
          if (d.level === 'error') console.error(line);
          else console.warn(line);
        }
        const fatal =
          b.records.length === 0
            ? b.diagnostics.find((d) => d.level === 'error' && FATAL_CODES.has(d.code))
            : undefined;
        if (fatal) {
          // Keep the last good bundle visible; surface the error with Retry in the source bar.
          setError(fatal.message);
          setStatus('error');
          return;
        }
        setBundle(b);
        setLastLoadedAt(Date.now());
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [source, districtIds, nonce, pending]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const retry = refresh;

  const loadExcelFile = useCallback((file: File) => {
    setError(null);
    file
      .arrayBuffer()
      .then(async (data) => {
        let sheets: string[];
        try {
          sheets = await readWorkbookSheetNames(data);
        } catch (e: unknown) {
          setPending(null);
          setError(`Could not read "${file.name}" — not a valid .xlsx file? ${e instanceof Error ? e.message : String(e)}`);
          setStatus('error');
          return;
        }
        if (sheets.length === 0) {
          setPending(null);
          setError(`"${file.name}" contains no worksheets.`);
          setStatus('error');
          return;
        }
        if (sheets.length === 1) {
          setPending(null);
          setSource({ kind: 'excel-file', data, fileName: file.name, sheetName: sheets[0] });
        } else {
          // Ask which worksheet; never guess.
          setPending({ data, fileName: file.name, sheets });
          setStatus('needs-sheet');
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
  }, []);

  const chooseSheet = useCallback(
    (name: string) => {
      if (!pending) return;
      setSource({ kind: 'excel-file', data: pending.data, fileName: pending.fileName, sheetName: name });
      setPending(null);
    },
    [pending],
  );

  // ── Automatic refresh (postgres source only) ────────────────────────────────────────────────
  // Poll the cheap version endpoint; when the backend's data version changes (a sync applied new
  // data), trigger the existing refresh — which reloads records and rebuilds aggregates while
  // preserving selection and the user tree, and never reinitializes MapLibre. This is a poll, not
  // true real-time: a change appears within one poll interval (default 45s).
  const apiBase = source.kind === 'postgres' ? source.base : null;
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const lastVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!apiBase) {
      setSyncInfo(null);
      lastVersionRef.current = null;
      return;
    }
    const pollMs = Number(import.meta.env.VITE_DATASET_POLL_MS ?? 45000);
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiBase}/datasets/version`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const info = (await res.json()) as SyncInfo;
        if (stopped) return;
        setSyncInfo(info);
        if (lastVersionRef.current === null) {
          lastVersionRef.current = info.version; // seed; don't refresh on first sight
        } else if (info.version && info.version !== lastVersionRef.current) {
          lastVersionRef.current = info.version;
          refresh();
        }
      } catch {
        /* transient network error — keep polling */
      }
    };
    void tick();
    const id = window.setInterval(tick, Number.isFinite(pollMs) && pollMs >= 5000 ? pollMs : 45000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [apiBase, refresh]);

  // Aggregation runs only when the bundle changes (a load or a refresh), never per render.
  // A refresh replaces `bundle`, so both maps rebuild together and no stale aggregate survives.
  const districtAggregates = useMemo(
    () => (bundle ? buildDistrictAggregates(bundle.records) : EMPTY_AGGREGATES),
    [bundle],
  );
  const stateAggregates = useMemo(
    () => buildStateAggregates(districtAggregates, districtToState),
    [districtAggregates, districtToState],
  );

  const api: DatasetRecordsApi = {
    status,
    bundle,
    districtAggregates,
    stateAggregates,
    error,
    sourceLabel: pending ? `Excel: ${pending.fileName}` : sourceLabel(source),
    sourceKind: pending ? 'excel' : sourceKind(source),
    lastLoadedAt,
    googleConfigured: resolved.googleConfigured,
    availableSheets: pending?.sheets ?? null,
    note: source.kind === 'local' ? resolved.note ?? null : null,
    syncInfo,
    apiBase,
    refresh,
    retry,
    loadExcelFile,
    chooseSheet,
  };

  return <DatasetRecordsContext.Provider value={api}>{children}</DatasetRecordsContext.Provider>;
}

export function useDatasetRecords(): DatasetRecordsApi {
  const ctx = useContext(DatasetRecordsContext);
  if (ctx === null) {
    throw new Error('useDatasetRecords must be used within a DatasetRecordsProvider');
  }
  return ctx;
}
