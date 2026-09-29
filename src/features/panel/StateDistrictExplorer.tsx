import { useCallback, useEffect, useRef, useState } from 'react';
import type { DistrictRecord } from '../../data/schema.ts';
import type { StateOption } from '../../lib/search.ts';
import { useSelection } from '../../state/selection.tsx';
import { PanelStackResizer } from '../shell/PanelStackResizer.tsx';
import { DistrictPanel } from './DistrictPanel.tsx';
import { StatePanel } from './StatePanel.tsx';
import {
  DEFAULT_STATE_FRACTION,
  DISTRICT_PANEL_MIN_HEIGHT,
  STATE_PANEL_MIN_HEIGHT,
  clampStateHeight,
  fractionFromStateHeight,
  loadStateFraction,
  saveStateFraction,
  stateHeightFromFraction,
  usableHeight,
} from '../../lib/stateDistrictSplit.ts';

/**
 * The whole right-side region. It is a single shared layout — never unrelated absolute
 * elements — that renders one of four shapes from the two canonical facts (selected State/UT
 * and selected district):
 *
 *   neither         → nothing
 *   district only   → the existing DistrictPanel, unchanged (docked aside or mobile overlay)
 *   state only      → StatePanel filling the whole column
 *   state + district→ StatePanel / horizontal resizer / DistrictPanel, stacked
 *
 * The existing vertical divider controls this region's total WIDTH (via `width`); the internal
 * horizontal resizer controls only the State/District HEIGHT split. The MapLibre instance is
 * never touched by either.
 */
export function StateDistrictExplorer({
  variant,
  width,
  selectedStateId,
  states,
  districts,
  onCloseState,
}: {
  variant: 'docked' | 'overlay';
  width: number;
  /** '' when no State/UT is scoped. */
  selectedStateId: string;
  states: StateOption[];
  districts: DistrictRecord[];
  onCloseState: () => void;
}) {
  const { selectedDistrictId } = useSelection();
  const docked = variant === 'docked';

  const stateOpen = selectedStateId !== '';
  const districtOpen = selectedDistrictId !== null;
  const stateOption = states.find((s) => s.stateId === selectedStateId) ?? null;
  const both = stateOpen && districtOpen && stateOption !== null;

  // ---- height split (only meaningful when both panels are docked) ------------------------
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [columnHeight, setColumnHeight] = useState(0);
  const heightRef = useRef(0);
  heightRef.current = columnHeight;

  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const measure = () => setColumnHeight(el.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [stateOpen, both, docked]);

  const [stateFraction, setStateFraction] = useState(
    () => loadStateFraction() ?? DEFAULT_STATE_FRACTION,
  );
  const fractionRef = useRef(stateFraction);
  const draggingRef = useRef(false);
  useEffect(() => {
    fractionRef.current = stateFraction;
    if (!draggingRef.current) saveStateFraction(stateFraction);
  }, [stateFraction]);

  const stateHeightPx = stateHeightFromFraction(stateFraction, columnHeight);
  const maxStateHeight = Math.max(
    STATE_PANEL_MIN_HEIGHT,
    usableHeight(columnHeight) - DISTRICT_PANEL_MIN_HEIGHT,
  );

  const onResize = useCallback((px: number) => {
    draggingRef.current = true;
    const h = heightRef.current;
    setStateFraction(fractionFromStateHeight(clampStateHeight(px, h), h));
  }, []);
  const onCommit = useCallback(() => {
    draggingRef.current = false;
    saveStateFraction(fractionRef.current);
  }, []);
  const onNudge = useCallback((deltaPx: number) => {
    setStateFraction((f) => {
      const h = heightRef.current;
      const current = stateHeightFromFraction(f, h);
      return fractionFromStateHeight(clampStateHeight(current + deltaPx, h), h);
    });
  }, []);
  const onJump = useCallback((edge: 'min' | 'max') => {
    const h = heightRef.current;
    const target = edge === 'max' ? usableHeight(h) : STATE_PANEL_MIN_HEIGHT;
    setStateFraction(fractionFromStateHeight(clampStateHeight(target, h), h));
  }, []);

  if (!stateOpen && !districtOpen) return null;

  // District-only mode — the existing DistrictPanel, exactly as before this phase.
  if (!stateOpen) {
    return <DistrictPanel variant={variant} width={width} />;
  }

  // A State/UT is selected but the row is missing from the options (should not happen); fall
  // back to the district panel or nothing rather than rendering a broken header.
  if (!stateOption) {
    return districtOpen ? <DistrictPanel variant={variant} width={width} /> : null;
  }

  const statePanel = (
    <StatePanel
      state={stateOption}
      districts={districts}
      states={states}
      onClose={onCloseState}
    />
  );

  return (
    <div
      ref={columnRef}
      style={docked ? { width } : undefined}
      className={
        docked
          ? 'rp-panel panel-enter relative flex h-full min-h-0 shrink-0 flex-col border-l border-ink-200 bg-white'
          : 'rp-panel panel-enter absolute inset-y-0 right-0 z-30 flex w-full max-w-sm shrink-0 flex-col border-l border-ink-200 bg-white shadow-2xl'
      }
    >
      {both && docked ? (
        <>
          <div style={{ height: stateHeightPx }} className="min-h-0 shrink-0 overflow-hidden">
            {statePanel}
          </div>
          <PanelStackResizer
            columnRef={columnRef}
            stateHeight={stateHeightPx}
            maxStateHeight={maxStateHeight}
            onResize={onResize}
            onCommit={onCommit}
            onNudge={onNudge}
            onJump={onJump}
          />
          <div className="min-h-0 flex-1 overflow-hidden border-t border-ink-200">
            <DistrictPanel variant="stacked" width={width} />
          </div>
        </>
      ) : both && !docked ? (
        // Mobile overlay: stack both without the desktop split so neither gets cramped.
        <>
          <div className="min-h-0 flex-1 overflow-hidden border-b border-ink-200">{statePanel}</div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <DistrictPanel variant="stacked" width={width} />
          </div>
        </>
      ) : (
        // State-only mode: StatePanel fills the whole column; no horizontal divider.
        statePanel
      )}
    </div>
  );
}
