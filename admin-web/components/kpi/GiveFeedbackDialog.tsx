'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isMissingTable } from '@/lib/kpiLoad';
import { removeFeedback } from '@/lib/useFeedback';
import { useConfirm } from '@/components/ConfirmDialog';
import { COMMENT_MAX, RATING_WORDS, firstName, validateGive, type Colleague, type GivenFeedback } from '@/lib/colleagueFeedback';
import { Question, circleClasses } from '@/components/kpi/FormParts';

const FIELD = 'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * The colleague feedback form, built like the customer review form: who it is for, then numbered questions in boxes (1. a rating
 * from 1 to 5 with a word under each round number, 2. an optional comment). Anyone who works in the company can give it to anyone
 * else, from an employee's own page or from an admin's. Sending feedback to someone who already has some from you this month
 * replaces it, and the form says so; it can also be taken back (deleted). The person and management see who gave it.
 */
export default function GiveFeedbackDialog({ colleagues, given, subjectId = '', onClose, onSent, onRemoved }: {
  /** Everyone feedback can be given to (feedback_colleagues()). */
  colleagues: Colleague[];
  /** What the signed-in person already gave this month (feedback_i_gave()). */
  given: GivenFeedback[];
  /** Who the form opens on, when it is opened from that person's page. */
  subjectId?: string;
  onClose: () => void;
  /** The feedback was saved: with the name of the person it was for. */
  onSent: (name: string) => void;
  /** This month's feedback to someone was taken back: with the name of the person it was for. */
  onRemoved: (name: string) => void;
}) {
  const start = colleagues.some(c => c.id === subjectId) ? subjectId : '';
  const before = useMemo(() => given.find(g => g.subject_id === start), [given, start]);
  const [who, setWho] = useState(start);
  const [rating, setRating] = useState<number | null>(before?.rating ?? null);
  const [comment, setComment] = useState(before?.comment ?? '');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();
  // While "Take it back?" is being asked, Escape belongs to that question, not to this form.
  const asking = useRef(false);
  const busy = saving || removing;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy && !asking.current) closeRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const person = colleagues.find(c => c.id === who);
  const earlier = given.find(g => g.subject_id === who);
  const name = person ? firstName(person.name) : 'them';

  // Choosing someone shows what you already sent them this month, so you can change it; someone new starts empty.
  function choose(id: string) {
    setWho(id);
    const prior = given.find(g => g.subject_id === id);
    setRating(prior?.rating ?? null);
    setComment(prior?.comment ?? '');
    setError('');
  }

  // Take back what you gave this person this month: it is deleted, and you may give them feedback again.
  async function takeBack() {
    if (!earlier || busy) return;
    asking.current = true;
    const sure = await confirm(`Take back the feedback you gave ${person?.name ?? 'them'} this month? It is deleted for good.`, {
      title: 'Take back your feedback?',
      confirmLabel: 'Take it back',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    asking.current = false;
    if (!sure) return;
    setRemoving(true);
    setError('');
    const problem = await removeFeedback(earlier.id);
    setRemoving(false);
    if (problem) return setError(problem);
    onRemoved(person?.name ?? '');
    onClose();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = validateGive(who, rating, comment);
    if (problem) return setError(problem);
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('give_colleague_feedback', { p_subject_id: who, p_rating: rating, p_comment: comment.trim() || null });
    setSaving(false);
    if (rpcError) return setError(isMissingTable(rpcError) ? 'Colleague feedback is not set up in the database yet: run the migration 20261123140000_colleague_feedback.sql.' : rpcError.message);
    onSent(person?.name ?? '');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center" onClick={() => !busy && onClose()}>
      <form
        noValidate
        onSubmit={send}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="give-feedback-title"
        className="my-auto w-full max-w-[560px] rounded-xl bg-white p-5 shadow-2xl sm:p-7"
      >
        <h2 id="give-feedback-title" className="m-0 text-[22px] font-extrabold tracking-tight text-ink">
          {person ? `Feedback for ${person.name}` : 'Give feedback'}
        </h2>
        <p className="mb-4 mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{person ? name : 'The person'} and management see your name with this feedback.</p>

        <div className="mb-3.5">
          <label htmlFor="give-feedback-who" className="mb-1.5 block text-xs font-bold text-slate-700">
            Who is it for?
          </label>
          <select id="give-feedback-who" value={who} onChange={e => choose(e.target.value)} className={FIELD}>
            <option value="">Select a colleague…</option>
            {colleagues.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.department ? ` · ${c.department}` : ''}
              </option>
            ))}
          </select>
          {earlier && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
              <p className="m-0 text-xs font-semibold text-slate-600">You already gave {name} feedback this month. Sending again replaces it.</p>
              <button
                type="button"
                onClick={takeBack}
                disabled={busy}
                className="min-h-[44px] px-1 text-[13px] font-extrabold text-critical-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-critical disabled:opacity-50"
              >
                {removing ? 'Taking it back…' : 'Take it back'}
              </button>
            </div>
          )}
        </div>

        <Question n={1} id="give-feedback-q1" title={`Overall, how was working with ${name} this month?`} range="Rating, 1 to 5">
          <fieldset aria-labelledby="give-feedback-q1" className="m-0 border-0 p-0">
            <div className="grid grid-cols-5 gap-1.5">
              {RATING_WORDS.map((word, i) => {
                const n = i + 1;
                const on = rating === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setRating(n);
                      setError('');
                    }}
                    className="group flex min-h-[72px] flex-col items-center gap-1 rounded-[10px] px-0.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className={circleClasses(on, 'h-11 w-11 text-lg')}>{n}</span>
                    <span className={`text-center text-[11.5px] leading-tight ${on ? 'font-extrabold text-teal-700' : 'text-slate-600'}`}>{word}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Question>

        <Question n={2} htmlFor="give-feedback-note" title="Anything to add?" range="Comment (optional)">
          <textarea
            id="give-feedback-note"
            rows={4}
            maxLength={COMMENT_MAX}
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="w-full resize-y rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-sm leading-normal text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p className="m-0 mt-1.5 text-xs text-slate-600">What went well, and what could be better. Be specific and kind.</p>
        </Question>

        {error && (
          <p role="alert" className="m-0 mb-3 text-sm font-semibold text-critical-text">
            {error}
          </p>
        )}

        <p className="m-0 mb-4 text-center text-[12.5px] text-slate-600">Thank you for taking the time to give honest feedback.</p>

        <div className="flex items-center justify-between gap-2.5">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-[44px] px-1 text-sm font-bold text-slate-600 hover:text-ink disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="min-h-[44px] rounded-[10px] bg-accent px-6 text-sm font-extrabold text-white hover:bg-accent/90 disabled:opacity-60">
            {saving ? 'Sending…' : earlier ? 'Send again' : 'Send feedback'}
          </button>
        </div>
      </form>
    </div>
  );
}
