'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A read-only spreadsheet, laid out like Excel: column letters (A, B, C ...), row numbers, thin grid lines, the first row as the
// bold heading row, a cell you can select (by clicking it or with the arrow keys) and a formula bar that shows the selected
// cell's whole text. Only the rows on screen are drawn, so a file of 20,000 rows scrolls as smoothly as one of 20.
// Used for the file being imported (KPIs > Import) and for an earlier import opened from the history.

export type SheetColumn = {
  /** The heading, shown in the first row. */
  header: string;
  width: number;
  align?: 'left' | 'right';
  /** A column that is not used: its text is greyed. */
  muted?: boolean;
  /** Something to show between the column letters and the first row, such as the "Use it for" box. */
  top?: React.ReactNode;
};

/** A row that is left out: 'skip' is shaded amber, 'alert' (something to do about it) rose. */
export type RowTone = 'skip' | 'alert' | null | undefined;

export const ROW_H = 30;
export const LETTER_H = 26;
export const TOP_H = 54;
export const NUM_W = 54;
const OVERSCAN = 6;

/** The column's letter as Excel names it: A to Z, then AA, AB ... */
export function colLetter(index: number): string {
  let s = '';
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

type Selected = { row: number; col: number };

export default function Sheet({ label, columns, rows, tone, note, loading = false, maxHeight = 'min(62vh, 620px)' }: {
  /** What the sheet is, for screen readers. */
  label: string;
  columns: SheetColumn[];
  /** The rows under the heading row, as text. */
  rows: string[][];
  /** Whether a row is left out, by its position in `rows`. */
  tone?: (index: number) => RowTone;
  /** What to say about a row in the formula bar when one of its cells is selected. */
  note?: (index: number) => string | undefined;
  loading?: boolean;
  maxHeight?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(640);
  // row 0 is the heading row (Excel's row 1); row n is rows[n - 1] (Excel's row n + 1)
  const [sel, setSel] = useState<Selected>({ row: 0, col: 0 });

  const hasTop = columns.some(c => c.top);
  const headH = LETTER_H + (hasTop ? TOP_H : 0) + ROW_H;
  const widths = columns.map(c => c.width);
  const tableW = NUM_W + widths.reduce((a, b) => a + b, 0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setViewH(el.clientHeight || 640);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A selection that no longer exists (fewer rows or columns than before) goes back to the first cell.
  useEffect(() => {
    setSel(s => (s.row > rows.length || s.col >= columns.length ? { row: 0, col: 0 } : s));
  }, [rows.length, columns.length]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  function reveal(row: number, col: number) {
    const el = box.current;
    if (!el) return;
    if (row > 0) {
      const top = headH + (row - 1) * ROW_H;
      if (top < el.scrollTop + headH) el.scrollTop = top - headH;
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    }
    const left = NUM_W + widths.slice(0, col).reduce((a, b) => a + b, 0);
    const right = left + widths[col];
    if (left < el.scrollLeft + NUM_W) el.scrollLeft = left - NUM_W;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Arrow keys inside a box in the heading (the "Use it for" list) belong to that box.
    if (e.target !== e.currentTarget) return;
    const lastRow = rows.length;
    const page = Math.max(1, Math.floor((viewH - headH) / ROW_H) - 1);
    let { row, col } = sel;
    switch (e.key) {
      case 'ArrowDown':
        row = Math.min(lastRow, row + 1);
        break;
      case 'ArrowUp':
        row = Math.max(0, row - 1);
        break;
      case 'ArrowRight':
        col = Math.min(columns.length - 1, col + 1);
        break;
      case 'ArrowLeft':
        col = Math.max(0, col - 1);
        break;
      case 'PageDown':
        row = Math.min(lastRow, row + page);
        break;
      case 'PageUp':
        row = Math.max(0, row - page);
        break;
      case 'Home':
        col = 0;
        if (e.ctrlKey) row = 0;
        break;
      case 'End':
        col = columns.length - 1;
        if (e.ctrlKey) row = lastRow;
        break;
      default:
        return;
    }
    e.preventDefault();
    setSel({ row, col });
    reveal(row, col);
  }

  const value = columns[sel.col] ? (sel.row === 0 ? columns[sel.col].header : rows[sel.row - 1]?.[sel.col] ?? '') : '';
  const rowNote = sel.row > 0 ? note?.(sel.row - 1) : undefined;
  const cellName = `${colLetter(sel.col)}${sel.row + 1}`;

  const letterCell = 'sticky border-b border-r border-slate-300 bg-slate-100 text-center text-xs font-semibold text-slate-600';
  const numCell = 'sticky left-0 border-b border-r border-slate-300 bg-slate-100 text-center text-xs font-medium tabular-nums text-slate-600';

  return (
    <div>
      <div className="flex items-stretch border-b border-slate-300 bg-white text-[13px]">
        <div aria-label="Selected cell" className="flex w-[84px] shrink-0 items-center justify-center border-r border-slate-300 bg-slate-50 py-1.5 font-semibold tabular-nums text-slate-700">
          {cellName}
        </div>
        <div aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center border-r border-slate-300 text-xs font-bold italic text-slate-500">
          fx
        </div>
        <div aria-live="polite" aria-label="Cell contents" className="min-w-0 flex-1 truncate px-3 py-1.5 text-slate-800">
          {value}
        </div>
        {rowNote && (
          <div aria-label="About this row" className="hidden shrink-0 items-center border-l border-slate-300 px-3 text-xs font-semibold text-slate-600 sm:flex">
            {rowNote}
          </div>
        )}
      </div>

      <div
        ref={box}
        tabIndex={0}
        role="group"
        aria-label={label}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        style={{ maxHeight }}
        className="relative overflow-auto bg-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <table role="grid" aria-label={label} aria-rowcount={rows.length + 1} aria-colcount={columns.length} style={{ minWidth: tableW, width: '100%', tableLayout: 'fixed' }} className="border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col style={{ width: NUM_W }} />
            {columns.map((c, i) => (
              <col key={i} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: LETTER_H }}>
              <th aria-hidden="true" style={{ top: 0 }} className={`${letterCell} left-0 z-30`}>
                <svg viewBox="0 0 12 12" width={10} height={10} className="mx-auto text-slate-400" aria-hidden="true">
                  <path d="M12 0v12H0z" fill="currentColor" />
                </svg>
              </th>
              {columns.map((_, i) => (
                <th key={i} aria-hidden="true" style={{ top: 0 }} className={`${letterCell} z-20 ${sel.col === i ? '!bg-teal-100 !text-teal-900' : ''}`}>
                  {colLetter(i)}
                </th>
              ))}
            </tr>
            {hasTop && (
              <tr style={{ height: TOP_H }}>
                <th scope="row" style={{ top: LETTER_H }} className="sticky left-0 z-30 border-b border-r border-slate-300 bg-slate-100" />
                {columns.map((c, i) => (
                  <th key={i} scope="col" style={{ top: LETTER_H }} className="sticky z-20 border-b border-r border-slate-300 bg-slate-50 p-1.5 text-left align-middle font-normal">
                    {c.top}
                  </th>
                ))}
              </tr>
            )}
            <tr style={{ height: ROW_H }} aria-rowindex={1}>
              <th scope="row" style={{ top: LETTER_H + (hasTop ? TOP_H : 0) }} className={`${numCell} z-30 ${sel.row === 0 ? '!bg-teal-100 !text-teal-900' : ''}`}>
                1
              </th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  onClick={() => setSel({ row: 0, col: i })}
                  aria-selected={sel.row === 0 && sel.col === i}
                  style={{ top: LETTER_H + (hasTop ? TOP_H : 0) }}
                  className={`sticky z-20 box-border cursor-cell overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-slate-300 bg-slate-50 px-2.5 ${c.align === 'right' ? 'text-right' : 'text-left'} font-bold ${c.muted ? 'text-slate-400' : 'text-ink'} ${
                    sel.row === 0 && sel.col === i ? 'outline outline-2 -outline-offset-2 outline-teal-700' : ''
                  }`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr aria-hidden="true" style={{ height: first * ROW_H }}>
                <td colSpan={columns.length + 1} className="p-0" />
              </tr>
            )}
            {rows.slice(first, last).map((cells, k) => {
              const i = first + k;
              const t = tone?.(i);
              return (
                <tr key={i} aria-rowindex={i + 2} data-tone={t ?? undefined} style={{ height: ROW_H }}>
                  <th scope="row" className={`${numCell} z-10 ${t === 'alert' ? '!bg-rose-100 !text-rose-900' : t === 'skip' ? '!bg-amber-100 !text-amber-900' : ''} ${sel.row === i + 1 ? '!bg-teal-100 !text-teal-900' : ''}`}>
                    {i + 2}
                  </th>
                  {columns.map((c, j) => {
                    const on = sel.row === i + 1 && sel.col === j;
                    return (
                      <td
                        key={j}
                        role="gridcell"
                        aria-selected={on}
                        onClick={() => setSel({ row: i + 1, col: j })}
                        className={`box-border cursor-cell overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-slate-200 px-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${
                          t === 'alert' ? 'bg-rose-50 text-rose-900' : t === 'skip' ? 'bg-amber-50 text-slate-500' : c.muted ? 'text-slate-400' : 'text-slate-800'
                        } ${on ? 'relative z-[1] outline outline-2 -outline-offset-2 outline-teal-700' : ''}`}
                      >
                        {cells[j]}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {last < rows.length && (
              <tr aria-hidden="true" style={{ height: (rows.length - last) * ROW_H }}>
                <td colSpan={columns.length + 1} className="p-0" />
              </tr>
            )}
            {rows.length === 0 && (
              <tr style={{ height: ROW_H * 2 }}>
                <td colSpan={columns.length + 1} className="px-3 text-sm text-slate-600">
                  {loading ? 'Loading…' : 'No rows.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
