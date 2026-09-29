import { useRef, type RefObject } from 'react';
import {
  STATE_PANEL_MIN_HEIGHT,
  clampStateHeight,
} from '../../lib/stateDistrictSplit.ts';

const KEY_STEP = 24;

/**
 * Horizontal draggable divider between the StatePanel (top) and the DistrictPanel (bottom) in
 * the stacked right-side explorer. It is the height analogue of PanelResizer: pointer-based
 * with pointer capture (so the drag survives the cursor leaving the handle), plus keyboard
 * support via arrow / Home / End.
 *
 * Dragging up shrinks the StatePanel; dragging down grows it. Only the internal height split
 * changes here — the map, the MapLibre instance and the panel width are never touched.
 */
export function PanelStackResizer({
  columnRef,
  stateHeight,
  maxStateHeight,
  onResize,
  onCommit,
  onNudge,
  onJump,
}: {
  columnRef: RefObject<HTMLElement | null>;
  /** Current StatePanel height in px (for the accessible value). */
  stateHeight: number;
  /** Largest StatePanel height the current column allows (for the accessible max). */
  maxStateHeight: number;
  /** Absolute live update during a pointer drag. */
  onResize: (statePx: number) => void;
  /** Persist the final split after a drag. */
  onCommit: () => void;
  /** Relative keyboard adjustment (persists). Uses a functional update so held keys never stall. */
  onNudge: (deltaPx: number) => void;
  /** Jump to an edge (persists). */
  onJump: (edge: 'min' | 'max') => void;
}) {
  const dragging = useRef(false);

  const heightFromPointer = (clientY: number) => {
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // The StatePanel sits flush with the column's top edge; its height is the gap from that
    // edge down to the pointer.
    onResize(clampStateHeight(clientY - rect.top, rect.height));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer to capture (e.g. synthetic events) */
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) heightFromPointer(e.clientY);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    onCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        onNudge(-KEY_STEP); // shrink the StatePanel
        break;
      case 'ArrowDown':
        e.preventDefault();
        onNudge(KEY_STEP); // grow the StatePanel
        break;
      case 'Home':
        e.preventDefault();
        onJump('min');
        break;
      case 'End':
        e.preventDefault();
        onJump('max');
        break;
      default:
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize state and district panels"
      aria-valuemin={STATE_PANEL_MIN_HEIGHT}
      aria-valuemax={Math.round(maxStateHeight)}
      aria-valuenow={Math.round(stateHeight)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className="group relative z-10 flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center bg-ink-200 hover:bg-accent-400 focus:bg-accent-500 focus:outline-none"
    >
      {/* Wider invisible hit area so the thin bar is easy to grab. */}
      <span aria-hidden="true" className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
      {/* Grip dots, shown on hover/focus. */}
      <span
        aria-hidden="true"
        className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        <span className="h-0.5 w-0.5 rounded-full bg-white" />
        <span className="h-0.5 w-0.5 rounded-full bg-white" />
        <span className="h-0.5 w-0.5 rounded-full bg-white" />
      </span>
    </div>
  );
}
