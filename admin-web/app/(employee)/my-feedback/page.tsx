'use client';

import { useMemo, useState } from 'react';
import { usePageTitle } from '@/lib/pageTitle';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatAdDate } from '@/lib/calendar';
import { weekdayName } from '@/lib/taskSchedule';
import { useReviewsToGive } from '@/lib/useReviewsToGive';
import { RELATION_AS, type ReviewToGive } from '@/lib/colleagueReviews';
import { PageBody } from '@/components/employee/parts';
import GiveFeedbackDialog from '@/components/kpi/GiveFeedbackDialog';

// The colleague feedback this person is asked to give this month: peers, the manager, the C-level executive or
// training and compliance, whichever they have been chosen as. Their name is never shown to the person they review.
export default function MyFeedbackPage() {
  usePageTitle('Feedback');
  const { system } = useCalendarSystem();
  const { items, error, reload, loading } = useReviewsToGive();
  const [giving, setGiving] = useState<{ items: ReviewToGive[]; start: number } | null>(null);

  const all = items ?? [];
  const pending = useMemo(() => all.filter(i => !i.given_at), [all]);
  const rounds = new Set(all.map(i => i.round_id)).size;
  const roundTitle = all[0]?.round_title ?? '';
  const due = (d: string | null) => (d ? ` · please give by ${weekdayName(d)} ${formatAdDate(d, system)}` : '');

  return (
    <PageBody>
      <section aria-labelledby="feedback-heading" className="rounded-xl border border-slate-200 bg-white px-6 pb-2 pt-5 shadow-sm">
        <h2 id="feedback-heading" className="m-0 text-[17px] font-extrabold text-ink">
          Feedback to give
        </h2>
        <p className="m-0 mb-2 mt-1 text-[13px] leading-normal text-slate-600">
          {loading
            ? 'Loading…'
            : all.length === 0
              ? 'Nobody is waiting for your feedback right now.'
              : pending.length === 0
                ? `You have given all your feedback for ${roundTitle}. Thank you. You can still change it until the round closes.`
                : `${pending.length} ${pending.length === 1 ? 'colleague is' : 'colleagues are'} waiting for your feedback for ${roundTitle}. Your name is not shown to them.`}
        </p>

        {error && (
          <p role="alert" className="m-0 mb-2 text-sm font-semibold text-critical-text">
            Could not load your feedback list: {error}
          </p>
        )}

        {all.map(it => (
          <div key={it.review_id} className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-slate-200 py-3.5">
            <div className="min-w-[200px] flex-1">
              <div className="text-sm font-bold text-ink">{it.subject_name}</div>
              <div className="mt-0.5 text-[12.5px] text-slate-600">
                {RELATION_AS[it.relation]}
                {rounds > 1 ? ` · ${it.round_title}` : ''}
                {it.given_at ? ' · given' : due(it.due_on)}
              </div>
            </div>
            <button
              type="button"
              aria-label={`${it.given_at ? 'Change' : 'Give'} feedback for ${it.subject_name}`}
              onClick={() => {
                if (it.given_at) setGiving({ items: [it], start: 0 });
                else setGiving({ items: pending, start: pending.findIndex(p => p.review_id === it.review_id) });
              }}
              className="min-h-[40px] rounded-lg border border-accent bg-white px-[18px] text-[13px] font-extrabold text-accent hover:bg-accent/10"
            >
              {it.given_at ? 'Change' : 'Give feedback'}
            </button>
          </div>
        ))}
      </section>

      {giving && <GiveFeedbackDialog items={giving.items} start={giving.start} onClose={() => setGiving(null)} onChanged={reload} />}
    </PageBody>
  );
}
