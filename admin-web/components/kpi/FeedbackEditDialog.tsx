'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useConfirm } from '@/components/ConfirmDialog';
import FeedbackFields, { type StaffOption } from '@/components/kpi/FeedbackFields';
import { draftFromRow, feedbackRow, needsGuestMigration, validateFeedback, type FeedbackDraft } from '@/lib/customerFeedback';
import { MIGRATION } from '@/lib/kpiLoad';
import { saveGuest } from '@/lib/guestDetails';
import type { CustomerFeedback } from '@/lib/types';
import { useKpiSettings } from '@/lib/useKpiSettings';

/** Change or delete a form that was typed in. Anyone with access to the page can fix a typing mistake: the
 * employee, the date and every answer can be changed. */
export default function FeedbackEditDialog({ row, staff, today, onClose, onChanged }: {
  row: CustomerFeedback;
  staff: StaffOption[];
  today: string;
  onClose: () => void;
  /** The form was saved or deleted: the list should be read again. */
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const { words } = useKpiSettings();
  const [draft, setDraft] = useState<FeedbackDraft>(() => draftFromRow(row));
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = validateFeedback(draft, today);
    if (problem) return setError(words.t(problem));
    setBusy('save');
    setError('');
    // .select() so a row the security rules hide (or one already deleted) is noticed instead of "saving" nothing.
    const { data, error: updateError } = await supabase.from('customer_feedback').update(feedbackRow(draft, !!row.visit_date)).eq('id', row.id).select('id');
    if (updateError) {
      setBusy(null);
      return setError(needsGuestMigration(updateError.message) ? `Guest details are not set up in the database yet: run the migration ${MIGRATION.guests}.` : `Could not save: ${updateError.message}`);
    }
    if (!data || data.length === 0) {
      setBusy(null);
      return setError('That form could not be changed. It may already have been deleted.');
    }
    // The guest's name, phone and email are kept in their own table: saved, or removed when all three boxes were emptied.
    const guestError = await saveGuest(draft, row.id, !row.guest);
    setBusy(null);
    if (guestError) return setError(needsGuestMigration(guestError) ? `The form was changed, but guest details are not set up in the database yet: run the migration ${MIGRATION.guests}.` : `The form was changed, but the guest's details were not: ${guestError}`);
    onChanged();
  }

  async function remove() {
    if (busy) return;
    const who = staff.find(s => s.id === row.employee_id)?.name ?? 'this employee';
    if (!(await confirm(words.t(`Delete this customer form for ${who}? It will no longer count toward their KPIs. This cannot be undone.`), { title: 'Delete form', confirmLabel: 'Delete', tone: 'danger' }))) return;
    setBusy('delete');
    setError('');
    const { data, error: deleteError } = await supabase.from('customer_feedback').delete().eq('id', row.id).select('id');
    setBusy(null);
    if (deleteError) return setError(`Could not delete: ${deleteError.message}`);
    if (!data || data.length === 0) return setError('That form could not be deleted. It may already be gone.');
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center" onClick={() => !busy && onClose()}>
      <form
        noValidate
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={words.t('Edit a customer form')}
        className="my-auto w-full max-w-[560px] rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 className="m-0 text-lg font-extrabold text-ink">{words.t('Edit a customer form')}</h2>
        <p className="m-0 mb-4 mt-1 text-[13px] text-slate-600">Change what was typed in, or delete the form if it should not count.</p>
        <FeedbackFields draft={draft} onChange={setDraft} staff={staff} idPrefix="edit-feedback" />
        {error && (
          <p role="alert" className="m-0 mb-3 text-sm font-semibold text-critical-text">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            className="min-h-[44px] rounded-[10px] px-3 text-sm font-bold text-critical-text hover:bg-critical-bg disabled:opacity-50"
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete form'}
          </button>
          <div className="flex gap-2.5">
            <button type="button" onClick={onClose} disabled={busy !== null} className="min-h-[44px] rounded-[10px] px-5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={busy !== null} className="min-h-[44px] rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60">
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
