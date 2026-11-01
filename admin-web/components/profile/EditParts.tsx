'use client';

/** The bar at the end of the edit form: how many changes are unsaved, and Save / Discard.
 * It sits in the page after the last section — it does not follow you as you scroll. */
export function EditActionBar({
  changed,
  changedLabels,
  saving,
  onDiscard,
}: {
  changed: number;
  changedLabels: string[];
  saving: boolean;
  onDiscard: () => void;
}) {
  const summary = changedLabels.slice(0, 3).join(', ') + (changedLabels.length > 3 ? ` and ${changedLabels.length - 3} more` : '');
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3.5 rounded-2xl border border-slate-200 bg-white px-[18px] py-3.5">
      <p role="status" className={`flex min-w-[240px] flex-1 flex-wrap items-center gap-2 text-[13px] font-bold ${changed > 0 ? 'text-warning-text' : 'text-slate-500'}`}>
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
