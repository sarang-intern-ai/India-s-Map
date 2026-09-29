import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDatasetRecords } from '../../state/datasetRecords.tsx';
import { CRSRecordCard, type CrsRow } from './CRSRecordCard.tsx';
import { CRSEditForm } from './CRSEditForm.tsx';
import { crsCreate, crsUpdate, crsDelete, crsSpeechUpdate, crsSpeechVersion, type CrsEditBody, type CrsMutationResult, type SpeechEditBody } from '../../data/crsApi.ts';
import { buildSpeechLookup, matchSpeech, type SpeechMeta } from '../../data/crsSpeechJoin.ts';

/**
 * The "CRS DATA" expandable for the selected district — the detailed Community Radio station list
 * plus full add / edit / delete, wired to the write-back API. Every mutation flows UI → API → Excel
 * workbook → existing sync → PostgreSQL → version → refresh; the frontend never writes the database
 * directly. The workbook version returned on the list (X-CRS-Version) is sent back as the optimistic
 * concurrency token, so a write that would clobber a newer external Excel edit is rejected (409).
 *
 * Re-fetches when the backend data version changes (an external Excel edit shows up automatically),
 * and immediately after a local mutation (the API has already reconciled it). Only rendered for the
 * PostgreSQL source — the CRS detail + write-back are a backend feature.
 */
export function CRSDataList({ districtId, districtName }: { districtId: string; districtName: string }) {
  const { apiBase, syncInfo, refresh, bundle } = useDatasetRecords();
  const [speechVersion, setSpeechVersion] = useState<string | null>(null);

  // Per-district Speech-hours metadata (Location / Language/s / hours) from the crs-speech source,
  // used to ENRICH the authoritative CRS station cards. Recomputed only when the bundle changes (an
  // Excel edit → version bump → bundle refresh), so edits to Speech Data (Hrs) / Language/s / Location
  // reach the cards automatically. Pure in-memory lookup — no extra fetch per district.
  const speechLookup = useMemo(
    () => buildSpeechLookup(bundle?.records ?? [], districtId),
    [bundle, districtId],
  );
  const [records, setRecords] = useState<CrsRow[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!apiBase) return;
    const res = await fetch(`${apiBase}/crs/district/${encodeURIComponent(districtId)}`, { cache: 'no-store' });
    const v = res.headers.get('X-CRS-Version');
    if (v) setVersion(v);
    const d = res.ok ? await res.json() : [];
    setRecords(Array.isArray(d) ? (d as CrsRow[]) : []);
    setSpeechVersion(await crsSpeechVersion(apiBase)); // separate concurrency token for the Speech workbook
  }, [apiBase, districtId]);

  useEffect(() => {
    if (!apiBase) { setRecords(null); return; }
    let cancelled = false;
    fetch(`${apiBase}/crs/district/${encodeURIComponent(districtId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const v = r.headers.get('X-CRS-Version');
        if (!cancelled && v) setVersion(v);
        return r.ok ? r.json() : [];
      })
      .then((d) => { if (!cancelled) setRecords(Array.isArray(d) ? (d as CrsRow[]) : []); })
      .catch(() => { if (!cancelled) setRecords([]); });
    crsSpeechVersion(apiBase).then((v) => { if (!cancelled) setSpeechVersion(v); });
    return () => { cancelled = true; };
    // Re-fetch on district change and whenever the backend data version moves (auto-refresh).
  }, [apiBase, districtId, syncInfo?.version]);

  // Apply a mutation result: on success reconcile the rest of the UI (aggregates/counts) and reload
  // the list; on failure surface a clear message and keep the current data intact.
  const applyResult = useCallback(async (r: CrsMutationResult, okMsg: string): Promise<boolean> => {
    if (!r.ok) {
      setOpError(r.error);
      if (r.code === 'conflict') await reload(); // pull the newer workbook state so a retry is clean
      return false;
    }
    setOpError(null);
    setNotice(r.sync.status === 'pending' ? 'Saved to workbook — syncing…' : okMsg);
    refresh(); // rebuild the bundle → district/state aggregates + the joined CRS view (speech metadata)
    await reload(); // refresh the CRS station list + both workbook version tokens
    return true;
  }, [reload, refresh]);

  const onAdd = useCallback(async (fields: CrsEditBody): Promise<boolean> => {
    if (!apiBase) return false;
    setBusy(true); setOpError(null);
    try {
      const r = await crsCreate(apiBase, { districtId, crsName: fields.crsName ?? '', organization: fields.organization,
        location: fields.location, language: fields.language, hours: fields.hours }, version);
      const ok = await applyResult(r, 'CRS added.');
      if (ok) setAdding(false);
      return ok;
    } finally { setBusy(false); }
  }, [apiBase, districtId, version, applyResult]);

  /**
   * Save a CRS card edit, routing each field to the SOURCE THAT OWNS IT:
   *  · Location / Language/s / No. of Hours → the Speech workbook (when a matching Speech record
   *    exists); otherwise they fall back to CRS(data).xlsx (a station with no Speech row).
   *  · Name of CRS / Organization → CRS(data).xlsx (the authoritative station source).
   * Only changed fields are written (diffed against the current JOINED display values), so a hours
   * edit never rewrites the CRS source and vice-versa. On success the join is rebuilt from the
   * refreshed bundle — every surface updates without reopening the card.
   */
  const onSave = useCallback(async (record: CrsRow, speech: SpeechMeta | null, fields: CrsEditBody): Promise<boolean> => {
    if (!apiBase) return false;
    const eq = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
    const curLoc = speech?.location ?? record.location;
    const curLang = speech?.language ?? record.language;
    const curHours = speech && speech.hours != null ? speech.hours : record.hours;

    const speechFields: SpeechEditBody = {};
    if (!eq(fields.location, curLoc)) speechFields.location = fields.location ?? null;
    if (!eq(fields.language, curLang)) speechFields.language = fields.language ?? null;
    if (!eq(fields.hours, curHours)) speechFields.hours = fields.hours ?? null;
    const crsFields: CrsEditBody = {};
    if (!eq(fields.crsName, record.crsName)) crsFields.crsName = fields.crsName;
    if (!eq(fields.organization, record.organization)) crsFields.organization = fields.organization ?? null;

    let anySpeech = Object.keys(speechFields).length > 0;
    // No Speech row to own these fields → write them to the CRS source instead (unchanged behaviour).
    if (anySpeech && !speech) { Object.assign(crsFields, speechFields); anySpeech = false; }
    const anyCrs = Object.keys(crsFields).length > 0;
    if (!anySpeech && !anyCrs) return true; // nothing changed

    setBusy(true); setOpError(null);
    try {
      if (anySpeech) {
        const r = await crsSpeechUpdate(apiBase, { districtId, crsName: record.crsName, organization: record.organization }, speechFields, speechVersion);
        if (!(await applyResult(r, 'CRS updated.'))) return false;
      }
      if (anyCrs) {
        const r = await crsUpdate(apiBase, record.id, crsFields, version);
        if (!(await applyResult(r, 'CRS updated.'))) return false;
      }
      return true;
    } finally { setBusy(false); }
  }, [apiBase, districtId, version, speechVersion, applyResult]);

  const onDelete = useCallback(async (sourceKey: string): Promise<boolean> => {
    if (!apiBase) return false;
    setBusy(true); setOpError(null);
    try { return await applyResult(await crsDelete(apiBase, sourceKey, version), 'CRS deleted.'); }
    finally { setBusy(false); }
  }, [apiBase, version, applyResult]);

  // Clear the transient success notice shortly after it appears.
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
    return () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); };
  }, [notice]);

  if (!apiBase) return null; // CRS detail + write-back is a PostgreSQL-source feature
  const list = records ?? [];

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id); // independent open state
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((r) => [r.crsName, r.organization, r.location].some((v) => (v ?? '').toLowerCase().includes(q)))
    : list;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-ink-200 bg-white shadow-card">
      <button
        type="button"
        onClick={() => setSectionOpen((o) => !o)}
        aria-expanded={sectionOpen}
        className="flex w-full items-center gap-2 border-b border-ink-200 bg-flame-50 px-3 py-2 text-left transition hover:bg-flame-100 focus:ring-2 focus:ring-accent-200 focus:outline-none"
      >
        <span aria-hidden="true" className="text-[10px] text-flame-600">{sectionOpen ? '▼' : '▸'}</span>
        <span className="flex-1 text-[11px] font-semibold tracking-wider text-flame-600 uppercase">CRS data</span>
        <span className="tabular text-[11px] text-ink-400">{list.length}</span>
      </button>

      {sectionOpen && (
        <div className="p-2">
          {list.length > 5 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search CRS…"
              autoComplete="off"
              spellCheck={false}
              className="mb-2 w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs text-ink-900 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-200 focus:outline-none"
            />
          )}

          {notice && <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">{notice}</p>}

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.map((r) => (
              <CRSRecordCard
                key={r.id}
                record={r}
                speech={matchSpeech(speechLookup, r.crsName, r.organization)}
                open={openIds.has(r.id)}
                onToggle={() => toggle(r.id)}
                districtName={districtName}
                onSave={onSave}
                onDelete={onDelete}
                busy={busy}
                error={opError}
              />
            ))}
            {list.length === 0 && !adding && (
              <p className="px-2 py-3 text-center text-xs text-ink-400">No CRS stations yet for this district.</p>
            )}
            {list.length > 0 && filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-ink-400">No CRS match “{query.trim()}”.</p>
            )}
          </div>

          {adding ? (
            <div className="mt-2">
              <CRSEditForm mode="add" districtName={districtName} busy={busy} error={opError} onSubmit={onAdd} onCancel={() => { setAdding(false); setOpError(null); }} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAdding(true); setOpError(null); }}
              className="mt-2 w-full rounded-md border border-dashed border-ink-300 bg-white px-2 py-1.5 text-[11px] font-medium text-ink-600 transition hover:border-accent-400 hover:bg-accent-50 hover:text-accent-800 focus:ring-2 focus:ring-accent-200 focus:outline-none"
            >
              + Add CRS
            </button>
          )}
        </div>
      )}
    </div>
  );
}
