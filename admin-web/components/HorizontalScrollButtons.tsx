'use client';

import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** A small floating ‹ › pill fixed to the bottom-right of the viewport,
 * scrolling `targetRef`'s container horizontally by `step` px per click. Stays
 * put regardless of how far down the page you've scrolled — the whole point
 * is being reachable from any row of a wide table without dragging the
 * native scrollbar or scrolling back up to a header-mounted control. One of
 * these per visible scrollable table; if a page renders more than one at
 * once, give each a distinct `className` offset so they don't overlap. */
export default function HorizontalScrollButtons({
  targetRef,
  step = 300,
  className = '',
}: {
  targetRef: RefObject<HTMLElement>;
  step?: number;
  className?: string;
}) {
  // Portaled to <body>: the table cards that host this use backdrop-blur,
  // and any backdrop-filter/transform ancestor becomes the containing block
  // for `position: fixed` — which pinned the pill to the table instead of the
  // viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function scroll(dir: number) {
    targetRef.current?.scrollBy({ left: dir * step, behavior: 'smooth' });
  }
  if (!mounted) return null;
  return createPortal(
    <div className={`pointer-events-none fixed bottom-6 right-6 z-40 flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-lg print:hidden ${className}`}>
      <button
        type="button"
        onClick={() => scroll(-1)}
        title="Scroll left"
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold text-slate-500 hover:bg-slate-100 hover:text-accent"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => scroll(1)}
        title="Scroll right"
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold text-slate-500 hover:bg-slate-100 hover:text-accent"
      >
        ›
      </button>
    </div>,
    document.body
  );
}
