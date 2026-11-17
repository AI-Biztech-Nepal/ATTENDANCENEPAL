'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const GAP = 10; // between the button and the panel
const MARGIN = 8; // kept clear of the screen edge

/**
 * A small panel that opens under a button (above it when there is no room) and floats over the
 * page. Editing something in a table cell with this never changes the cell, the row or the
 * table's width — the old way, swapping the cell for an input, made rows taller and slid the
 * whole table sideways.
 *
 * Portaled to <body>: the table cards use backdrop-blur, which would make `position: fixed`
 * relative to the card instead of the screen (same reason HorizontalScrollButtons is portaled).
 * Closes on Escape, a click anywhere else, or any scroll / resize (the panel would otherwise be
 * left floating away from its button).
 */
export default function AnchoredPopover({
  anchor,
  title,
  hint,
  onClose,
  width = 300,
  children,
}: {
  /** The button the panel belongs to. */
  anchor: HTMLElement;
  title: string;
  hint?: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [place, setPlace] = useState<{ top: number; left: number; width: number; caret: number; above: boolean } | null>(null);

  // Measure once the panel exists (hidden until then), then put it in place before it is painted.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const a = anchor.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - MARGIN * 2);
    const h = panel.offsetHeight;
    // Right edges line up (the cells that use this sit toward the right of the table), then stay on screen.
    const left = Math.max(MARGIN, Math.min(a.right - w + 14, window.innerWidth - w - MARGIN));
    const fitsBelow = a.bottom + GAP + h <= window.innerHeight - MARGIN;
    const fitsAbove = a.top - GAP - h >= MARGIN;
    const above = !fitsBelow && fitsAbove;
    const top = above ? a.top - GAP - h : Math.max(MARGIN, a.bottom + GAP);
    const caret = Math.max(16, Math.min(a.left + a.width / 2 - left - 6, w - 28));
    setPlace({ top, left, width: w, caret, above });
  }, [anchor, width]);

  // Focus the first box and select what is in it, so the next key typed replaces it. Only once the panel is
  // visible: a hidden element cannot take focus.
  useEffect(() => {
    if (!place) return;
    const input = panelRef.current?.querySelector<HTMLInputElement>('input');
    input?.focus({ preventScroll: true });
    input?.select();
  }, [place]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.contains(t)) return;
      closeRef.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current();
    }
    function onMove(e: Event) {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      closeRef.current();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      // Put the keyboard back where it was, unless the person already clicked into something else.
      if (anchor.isConnected && (!document.activeElement || document.activeElement === document.body)) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      style={{ position: 'fixed', top: place?.top ?? 0, left: place?.left ?? 0, width: place?.width ?? width, visibility: place ? 'visible' : 'hidden' }}
      className="z-40 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.18)]"
    >
      <span
        aria-hidden
        className={`absolute h-3 w-3 rotate-45 border-slate-200 bg-white ${place?.above ? '-bottom-[7px] border-b border-r' : '-top-[7px] border-l border-t'}`}
        style={{ left: place?.caret ?? 0 }}
      />
      <h3 className="text-sm font-extrabold text-ink">{title}</h3>
      {hint && <p className="mb-3 mt-1 text-xs font-medium leading-relaxed text-slate-500">{hint}</p>}
      {children}
    </div>,
    document.body
  );
}
