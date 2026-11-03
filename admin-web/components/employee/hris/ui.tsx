import type { ReactNode } from 'react';

/** The employee pages' card look (the same as My Profile's own cards). */
export const CARD = 'rounded-2xl border border-slate-200 bg-white p-4 lg:rounded-[20px] lg:p-6';
export const CARD_TITLE = 'text-base font-extrabold lg:text-xl lg:leading-6';

export function Card({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={CARD_TITLE}>{title}</h2>
          {note && <p className="mt-1 text-[13px] font-semibold text-slate-600">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A small caps heading inside a card. */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-5 border-t border-slate-100 pt-4 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#586474]">{children}</h3>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[13px] text-slate-600">{children}</p>;
}

/** Shown when a list couldn't be read at all (as opposed to being empty). */
export function Unavailable() {
  return (
    <p role="status" className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] font-semibold text-slate-600">
      This isn&apos;t available right now. Ask your admin or HR.
    </p>
  );
}
