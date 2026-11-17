import type { ReactNode } from 'react';

/** The compact section card the admin's Records / Documents / Exit tabs use, so an employee's
 * own profile reads like the page HR sees. (The Overview tab uses ProfileCard instead.) */
export function Card({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** "+ Add" / "Edit" in the corner of a card, or a link inside a row. */
export const LINK_BTN = 'shrink-0 py-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-50 disabled:hover:no-underline';
export const DANGER_BTN = 'shrink-0 py-1.5 text-xs font-medium text-critical hover:underline disabled:opacity-50 disabled:hover:no-underline';

/** A small caps heading inside a card. */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-slate-400">{children}</p>;
}

/** Shown when a list couldn't be read at all (as opposed to being empty). */
export function Unavailable() {
  return (
    <p role="status" className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-text">
      This isn&apos;t available right now. Ask your admin or HR.
    </p>
  );
}
