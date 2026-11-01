'use client';

import Avatar from '@/components/Avatar';

/** The bar over the edit form: what is being edited, how many changes are unsaved, and Save / Discard.
 * It stays pinned to the top of the scrolling area, so Save is always in reach. */
export function EditActionBar({
  name,
  photoUrl,
  changed,
  changedLabels,
  saving,
  onDiscard,
}: {
  name: string;
  photoUrl: string | null | undefined;
  changed: number;
  changedLabels: string[];
  saving: boolean;
  onDiscard: () => void;
}) {
  const summary = changedLabels.slice(0, 3).join(', ') + (changedLabels.length > 3 ? ` and ${changedLabels.length - 3} more` : '');
  return (
    // The page content has its own padding (16 / 24 / 32 px) and sticky offsets start inside it, so these
    // negative offsets bring the bar back to about 8 px from the top edge of the scrolling area.
    <div className="sticky -top-2 z-30 mb-5 flex flex-wrap items-center gap-3.5 rounded-2xl border border-slate-200 bg-white px-[18px] py-3.5 shadow-[0_6px_18px_rgba(15,23,42,0.08)] sm:-top-4 lg:-top-6">
      <Avatar name={name} photoUrl={photoUrl} className="h-11 w-11 text-sm" />
      <div className="min-w-[240px] flex-1">
        <p className="text-base font-extrabold text-ink">Editing {name}</p>
        <p role="status" className={`flex flex-wrap items-center gap-2 text-[13px] font-bold ${changed > 0 ? 'text-warning-text' : 'text-slate-500'}`}>
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
