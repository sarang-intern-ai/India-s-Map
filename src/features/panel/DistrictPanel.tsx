import { useCallback, useEffect, useRef } from 'react';
import { useSelection } from '../../state/selection.tsx';
import type { DistrictStatus } from '../../data/schema.ts';
import { Section } from './Section.tsx';
import { FieldTable } from './FieldTable.tsx';
import { administrativeFields } from './fields.ts';
import { officialDistrictName } from '../../data/districtNames.ts';
import { DistrictTreeEditor } from './DistrictTreeEditor.tsx';
import { DistrictDatasets } from './DistrictDatasets.tsx';
import { DatasetSourceBar } from './DatasetSourceBar.tsx';
import { CRSDataList } from './CRSDataList.tsx';
import { YouTubeDataList } from './YouTubeDataList.tsx';

const STATUS_COPY: Record<
  DistrictStatus,
  { label: string; tone: string; note: string }
> = {
  active: {
    label: 'Active',
    tone: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    note: 'Present in the current LGD register.',
  },
  dissolved: {
    label: 'Dissolved',
    tone: 'border-rose-300 bg-rose-50 text-rose-800',
    note: 'A boundary exists but the district is no longer in the LGD register.',
  },
  no_boundary_published: {
    label: 'No boundary published',
    tone: 'border-amber-300 bg-amber-50 text-amber-800',
    note: 'The district exists administratively, but no open boundary has been published. None is fabricated here.',
  },
  unreconciled: {
    label: 'Unreconciled',
    tone: 'border-ink-300 bg-ink-100 text-ink-700',
    note: 'The administrative register has not been loaded, so this district’s current status is not yet confirmed rather than assumed.',
  },
};

export type DistrictPanelVariant = 'docked' | 'overlay' | 'stacked';

/** Shell shared by every panel state, so the close affordance and chrome stay consistent. */
function PanelShell({
  labelledBy,
  variant,
  width,
  onClose,
  closeRef,
  children,
}: {
  variant: DistrictPanelVariant;
  width: number;
  labelledBy?: string;
  onClose: () => void;
  closeRef: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  // Docked (desktop/tablet): a flex sibling whose width the divider controls.
  // Overlay (narrow screens): a full-height sheet over the map, width unchanged.
  // Stacked: fills its slot inside the StateDistrictExplorer column, which already provides
  // the width, border and background — so this variant adds none of its own.
  const docked = variant === 'docked';
  const stacked = variant === 'stacked';
  return (
    <aside
      role="complementary"
      aria-labelledby={labelledBy}
      style={docked ? { width } : undefined}
      className={
        stacked
          ? 'rp-panel relative flex h-full min-h-0 flex-col bg-white'
          : docked
            ? 'rp-panel panel-enter relative z-auto flex h-full shrink-0 flex-col border-l border-ink-200 bg-white'
            : 'rp-panel panel-enter absolute inset-y-0 right-0 z-30 flex w-full max-w-sm shrink-0 flex-col border-l border-ink-200 bg-white shadow-2xl'
      }
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close district details"
        className="absolute top-3 right-3 z-10 grid h-7 w-7 place-items-center rounded-md text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 focus:ring-2 focus:ring-accent-200 focus:outline-none"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ✕
        </span>
      </button>
      {children}
    </aside>
  );
}

export function DistrictPanel({
  variant,
  width,
}: {
  variant: DistrictPanelVariant;
  width: number;
}) {
  const {
    selectedDistrict,
    selectedDistrictId,
    selectionOrigin,
    clearSelection,
    pendingNavigation,
  } = useSelection();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const headingId = 'district-panel-heading';

  /**
   * Close and return focus to the map, so a keyboard user who closes the panel lands back
   * on the map they were exploring rather than on document.body. MapLibre gives its canvas
   * tabindex 0, so it is a valid focus target.
   */
  const close = useCallback(() => {
    clearSelection();
    (document.querySelector('.maplibregl-canvas') as HTMLElement | null)?.focus();
  }, [clearSelection]);

  /**
   * Move focus into the panel when it opens — except when the selection came from search,
   * where the combobox must keep focus so the user can immediately search again. That
   * exception was established in the search phase and is the more common flow.
   */
  useEffect(() => {
    if (selectedDistrictId && selectionOrigin !== 'search') closeRef.current?.focus();
  }, [selectedDistrictId, selectionOrigin]);

  /**
   * Escape closes the panel. The search combobox stops propagation of Escape while its
   * dropdown is open, so the first Escape there closes the dropdown and only a second
   * Escape reaches this handler — a sensible two-stage behaviour rather than a conflict.
   */
  useEffect(() => {
    if (!selectedDistrictId) return;
    const onKey = (e: KeyboardEvent) => {
      // When a confirmation dialog is up, it owns Escape (and stops propagation); don't
      // also act here.
      if (e.key === 'Escape' && !pendingNavigation) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDistrictId, close, pendingNavigation]);

  if (!selectedDistrictId) return null;

  // Selected on the map but absent from the hierarchy would mean the two published files
  // disagree. Report it plainly rather than rendering a blank or crashing on undefined.
  if (!selectedDistrict) {
    return (
      <PanelShell variant={variant} width={width} onClose={close} closeRef={closeRef}>
        <div className="p-4 pr-12">
          <p className="text-sm text-rose-700">
            District <span className="tabular font-medium">{selectedDistrictId}</span> is selected
            on the map but is missing from <code>hierarchy.json</code>. The two dataset files may
            be out of sync.
          </p>
        </div>
      </PanelShell>
    );
  }

  const d = selectedDistrict;
  const status = STATUS_COPY[d.status];
  const metaLine = d.administered ? `District · LGD ${d.districtId}` : 'District · unadministered territory';

  return (
    <PanelShell variant={variant} width={width} labelledBy={headingId} onClose={close} closeRef={closeRef}>
      {/* Sticky header stays visible while the body scrolls. */}
      <header className="sticky top-0 z-[1] border-b border-ink-200 bg-white/95 px-4 pt-3 pb-3 pr-12 backdrop-blur-sm">
        <h2
          id={headingId}
          className="text-xl leading-tight font-semibold tracking-tight text-brand-800"
        >
          {officialDistrictName(d.districtId, d.districtName)}
        </h2>
        <p className="mt-0.5 text-sm text-ink-600">{d.stateName}</p>
        <p className="tabular mt-1.5 text-[11px] font-medium tracking-wide text-ink-400">
          {metaLine}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Administrative information">
          <FieldTable fields={administrativeFields(d)} />
        </Section>

        <div className="border-t border-ink-100" />

        {/* External datasets — read-only, sourced from the sheet-driven provider. Rendered
            dynamically per districtId; kept architecturally separate from the user tree below.
            Keyed by districtId so nothing from a previous district can leak into this one. */}
        <Section title="External datasets">
          <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
            Read-only, joined to this district by its LGD id. The source is shown below and can be
            refreshed or switched to an Excel workbook without changing anything else.
          </p>
          {/* Source status/refresh/upload is global — not keyed by district. */}
          <DatasetSourceBar />
          {/* Distinct keys — these are siblings, both remounting on district change. */}
          <DistrictDatasets key={`ds-${d.districtId}`} districtId={d.districtId} />
          {/* Detailed Community Radio stations for this district (below the CR aggregate).
              Keyed by districtId so open/search state resets when the district changes. */}
          <CRSDataList key={`crs-${d.districtId}`} districtId={d.districtId} districtName={officialDistrictName(d.districtId, d.districtName)} />
          {/* YouTube channels for this district — UI only for now (no source yet); shows
              "No YouTube data available." Kept fully separate from CRS. */}
          <YouTubeDataList key={`yt-${d.districtId}`} districtId={d.districtId} />
        </Section>

        <div className="border-t border-ink-100" />

        <Section title="User data">
          <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
            Build your own nested data for this district — groups within groups, to any depth.
            Stored locally in this browser; separate from the external datasets above, and the
            source dataset is never changed.
          </p>
          {/* Keyed by districtId so switching districts remounts the editor with fresh state. */}
          <DistrictTreeEditor key={d.districtId} district={d} />
        </Section>

        <div className="border-t border-ink-100" />

        <Section title="Status">
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.tone}`}
          >
            {status.label}
          </span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{status.note}</p>

          {!d.administered && (
            <p className="mt-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
              This district lies in territory India claims but does not administer. The Local
              Government Directory assigns it no code, so its identifier is a documented fallback
              (<span className="tabular">{d.districtId}</span>) rather than an official LGD code.
            </p>
          )}
        </Section>

        {/* Reserved for later analytics. Labelled so it reads as intentional, not unfinished. */}
        <div className="border-t border-ink-100" />
        <Section title="Analytics">
          <p className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
            Charts and comparisons will appear here in a later version.
          </p>
        </Section>
      </div>
    </PanelShell>
  );
}
