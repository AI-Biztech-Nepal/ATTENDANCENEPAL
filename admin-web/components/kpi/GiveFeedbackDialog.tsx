'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RATING_WORDS, validateGive, COMMENT_MAX, type ReviewRelation, type ReviewToGive } from '@/lib/colleagueReviews';
import { Question, circleClasses } from '@/components/kpi/FormParts';

/** How the giver is described in the sentence above the question. */
const GIVING_AS: Record<ReviewRelation, string> = {
  peer: 'a peer',
  manager: 'the manager',
  c_level: 'a C-level executive',
  training: 'training and compliance',
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Gives colleague feedback, one person after another, on a form built like the customer review form (numbered questions in
 * boxes, round numbers with a word under each): 1. a rating from 1 to 5, 2. an optional comment. `items` is the
 * list to walk through (the dialog keeps its own copy), `start` is where to begin. "Send" saves and moves on to the
 * next person; "Skip for now" moves on without saving. The person reviewed is never told who gave it. Used on the
 * employee portal and on the admin Colleague reviews page.
 */
export default function GiveFeedbackDialog({ items, start = 0, onClose, onChanged }: {
  items: ReviewToGive[];
  start?: number;
  onClose: () => void;
  /** Something was saved: the list behind the dialog should be read again. */
  onChanged: () => void;
}) {
  const [list] = useState(items);
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), Math.max(list.length - 1, 0)));
  const item = list[index];
  const [rating, setRating] = useState<number | null>(item?.rating ?? null);
  const [comment, setComment] = useState(item?.comment ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) closeRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving]);

  if (!item) return null;
  const next = list[index + 1];
  const isLast = !next;

  function go(to: number) {
    const target = list[to];
    setIndex(to);
    setRating(target?.rating ?? null);
    setComment(target?.comment ?? '');
    setError('');
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const problem = validateGive(rating, comment);
    if (problem) return setError(problem);
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('give_colleague_review', { p_review_id: item.review_id, p_rating: rating, p_comment: comment.trim() || null });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    onChanged();
    if (isLast) onClose();
    else go(index + 1);
  }

  function skip() {
    if (isLast) onClose();
    else go(index + 1);
  }

  const name = firstName(item.subject_name);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center" onClick={() => !saving && onClose()}>
      <form
        noValidate
        onSubmit={send}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="give-feedback-title"
        className="my-auto w-full max-w-[560px] rounded-xl bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-center justify-between gap-3 text-[13px] font-bold text-slate-600">
          <span>Feedback · {item.round_title}</span>
          <span>
            {index + 1} of {list.length}
          </span>
        </div>
        <div role="img" aria-label={`Step ${index + 1} of ${list.length}`} className="mt-2 flex gap-1">
          {list.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-accent' : 'bg-slate-200'}`} />
          ))}
        </div>

        <h2 id="give-feedback-title" className="mb-1.5 mt-5 text-[22px] font-extrabold tracking-tight text-ink">
          Feedback for {item.subject_name}
        </h2>
        <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-slate-600">
          You are giving this as <b className="text-ink">{GIVING_AS[item.relation]}</b>. Management reads your comment. {name} never sees your name.
        </p>

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
          <button type="button" onClick={skip} disabled={saving} className="min-h-[44px] px-1 text-sm font-bold text-slate-600 hover:text-ink disabled:opacity-50">
            {isLast ? 'Close' : 'Skip for now'}
          </button>
          <button type="submit" disabled={saving} className="min-h-[44px] rounded-[10px] bg-accent px-6 text-sm font-extrabold text-white hover:bg-accent/90 disabled:opacity-60">
            {saving ? 'Sending…' : isLast ? 'Send' : `Send and go to ${firstName(next.subject_name)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
