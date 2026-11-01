'use client';

import Avatar from '@/components/Avatar';

/** The bar over (and under) the edit form: what is being edited, how many changes are unsaved, and Save / Discard. */
export function EditActionBar({
  position,
  name,
  photoUrl,
  changed,
  changedLabels,
  saving,
  onDiscard,
}: {
  position: 'top' | 'bottom';
  name: string;
  photoUrl: string | null | undefined;
  changed: number;
  changedLabels: string[];
  saving: boolean;
  onDiscard: () => void;
}) {
  const summary = changedLabels.slice(0, 3).join(', ') + (changedLabels.length > 3 ? ` and ${changedLabels.length - 3} more` : '');
  const top = position === 'top';
  return (
    <div
      className={`z-30 flex flex-wrap items-center gap-3.5 rounded-2xl border border-slate-200 bg-white px-[18px] py-3.5 ${
        // The page content has its own padding (16 / 24 / 32 px) and sticky offsets start inside it, so these
        // negative offsets bring the bars back to about 8–12 px from the edge of the scrolling area.
        top
          ? 'sticky -top-2 mb-5 shadow-[0_6px_18px_rgba(15,23,42,0.08)] sm:-top-4 lg:-top-6'
          : 'sticky -bottom-1 mt-5 shadow-[0_-6px_18px_rgba(15,23,42,0.08)] sm:-bottom-3 lg:-bottom-5'
      }`}
    >
      {top && <Avatar name={name} photoUrl={photoUrl} className="h-11 w-11 text-sm" />}
      <div className="min-w-[240px] flex-1">
        {top && <p className="text-base font-extrabold text-ink">Editing {name}</p>}
        <p role={top ? 'status' : undefined} className={`flex flex-wrap items-center gap-2 text-[13px] font-bold ${changed > 0 ? 'text-warning-text' : 'text-slate-500'}`}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${changed > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} />
          {changed > 0 ? (
            <>
              {changed} unsaved change{changed === 1 ? '' : 's'}
              <span className="font-semibold text-slate-500">· {summary}</span>
            </>
          ) : (
            'No changes yet'
          )}
        </p>
      </div>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="h-[42px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-ink hover:bg-slate-50 disabled:opacity-60"
        >
          {changed > 0 ? 'Discard changes' : 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={saving || changed === 0}
          className="h-[42px] rounded-xl bg-accent px-4 text-sm font-extrabold text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

export type NavSection = { id: string; label: string; state: 'done' | 'todo'; note: string };

/** The list of sections beside the edit form — jump to one, and see which still need attention. */
export function EditSectionNav({ sections, active, onJump }: { sections: NavSection[]; active: string; onJump: (id: string) => void }) {
  return (
    <nav aria-label="Sections of this form" className="w-full shrink-0 self-start rounded-2xl border border-slate-200 bg-white p-3.5 lg:sticky lg:top-[62px] lg:w-60">
      <p className="px-2.5 pb-2.5 pt-0.5 text-[11px] font-extrabold tracking-[0.08em] text-slate-500">ON THIS PAGE</p>
      <div className="flex flex-col gap-0.5">
        {sections.map(s => {
          const on = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onJump(s.id)}
              aria-current={on ? 'true' : undefined}
              className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm font-extrabold ${on ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {s.state === 'done' ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good-bg text-good-text" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                </span>
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning-bg text-xs font-extrabold text-warning-text" aria-hidden="true">
                  !
                </span>
              )}
              <span className="min-w-0 flex-1">{s.label}</span>
              <span className={`text-xs font-bold ${s.state === 'done' ? 'text-slate-500' : 'text-warning-text'}`}>{s.note}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 border-t border-slate-200 px-2.5 pt-3 text-xs font-semibold text-slate-500">
        Nothing is saved until you press <strong className="font-extrabold text-ink">Save changes</strong>.
      </p>
    </nav>
  );
}
