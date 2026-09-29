import { useRef, type RefObject } from 'react';
import { PANEL_MIN_WIDTH, clampPanelWidth, panelMaxWidth } from '../../lib/panelWidth.ts';

const KEY_STEP = 24;

/**
 * Draggable divider between the map and the docked district panel.
 *
 * Pointer-based (with pointer capture, so the drag survives the cursor leaving the handle),
 * plus keyboard support via arrow / Home / End. Dragging left widens the panel (the panel
 * sits on the right); dragging right narrows it.
 *
 * Resizing changes the panel's width in React state only. The map is never touched here —
 * its flex sibling simply gets narrower/wider and the map's own ResizeObserver reflows it,
 * so the MapLibre instance is preserved.
 */
export function PanelResizer({
  containerRef,
  width,
  onResize,
  onCommit,
  onNudge,
  onJump,
}: {
  containerRef: RefObject<HTMLElement | null>;
  width: number;
  /** Absolute live update during a pointer drag. */
  onResize: (width: number) => void;
  /** Persist the final width after a drag. */
  onCommit: () => void;
  /** Relative keyboard adjustment (persists). Uses a functional update so held keys never stall. */
  onNudge: (deltaPx: number) => void;
  /** Jump to an edge (persists). */
  onJump: (edge: 'min' | 'max') => void;
}) {
  const dragging = useRef(false);

  const widthFromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Panel is flush with the container's right edge; its width is the gap from the
    // pointer to that edge.
    onResize(clampPanelWidth(rect.right - clientX, window.innerWidth));
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
    document.body.style.cursor = 'col-resize';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) widthFromPointer(e.clientX);
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
      case 'ArrowLeft':
        e.preventDefault();
        onNudge(KEY_STEP); // widen the panel
        break;
      case 'ArrowRight':
        e.preventDefault();
        onNudge(-KEY_STEP); // narrow the panel
        break;
      case 'Home':
        e.preventDefault();
        onJump('max');
        break;
      case 'End':
        e.preventDefault();
        onJump('min');
        break;
      default:
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize district panel"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={panelMaxWidth(window.innerWidth)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className="group relative z-10 flex w-1.5 shrink-0 cursor-col-resize touch-none items-center justify-center bg-ink-200 hover:bg-accent-400 focus:bg-accent-500 focus:outline-none"
    >
      {/* Wider invisible hit area so the thin bar is easy to grab. */}
      <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
      {/* Grip dots, shown on hover/focus. */}
      <span
        aria-hidden="true"
        className="flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        <span className="h-0.5 w-0.5 rounded-full bg-white" />
        <span className="h-0.5 w-0.5 rounded-full bg-white" />
        <span className="h-0.5 w-0.5 rounded-full bg-white" />
      </span>
    </div>
  );
}
