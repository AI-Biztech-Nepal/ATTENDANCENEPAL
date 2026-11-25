'use client';

import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatAdDate } from '@/lib/calendar';
import { RELATION_FROM, RELATION_LABEL, RELATION_ONE, feedbackCount, giverWords, ratingWord, summariseReport, type FeedbackItem } from '@/lib/colleagueFeedback';
import { averageText, formWord, summariseRatings } from '@/lib/feedbackKpi';
import type { FeedbackRead, MyCustomerForm } from '@/lib/useFeedback';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/** The rating as a round number with its word under it, the same number the form gave it with. */
function RatingBadge({ rating }: { rating: number | null }) {
  return (
    <div className="flex w-[64px] shrink-0 flex-col items-center gap-1" aria-label={rating == null ? 'No rating' : `Rating ${rating} of 5, ${ratingWord(rating)}`} role="img">
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full border border-teal-700 bg-teal-700 text-lg font-extrabold tabular-nums text-white">
        {rating ?? '–'}
      </span>
      <span aria-hidden="true" className="text-center text-[11.5px] font-bold leading-tight text-teal-700">
        {rating == null ? '' : ratingWord(rating)}
      </span>
    </div>
  );
}

/** Who gave a piece of colleague feedback: their name and what kind of colleague they are, or just the kind when the name is not
 * on file. Shared by the report below and the colleague report pop-up. */
export function GiverLabel({ item }: { item: FeedbackItem }) {
  if (!item.giver_name) return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-extrabold text-slate-700">{RELATION_FROM[item.relation]}</span>;
  return (
    <>
      <span className="text-[13.5px] font-extrabold text-ink">{item.giver_name}</span>
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-bold text-slate-700">{RELATION_ONE[item.relation]}</span>
    </>
  );
}

/** Why the names could not be read; the feedback is still shown without them. */
export function NamesProblem({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="m-0 bg-amber-50 px-5 py-2.5 text-[13px] font-semibold text-amber-900 sm:px-7">
      {text}
    </p>
  );
}

/**
 * The feedback colleagues gave a person, laid out as a report about them: how much and how it averaged from each kind of colleague,
 * then every piece of feedback with its rating, who gave it, the day and the comment. With `onRemove` (an admin's page) each piece
 * has a Remove button. Used on the
 * employee's own Feedback page and on an admin's Colleague reviews tab for the person whose page it is. `actions` are the buttons
 * for the report (Give feedback, who is C-level).
 */
export function FeedbackReport({ title, periodLabel, read, subject, actions, onRemove, removing = null }: {
  title: string;
  periodLabel: string;
  read: FeedbackRead;
  /** Who the report is about, for the empty and the privacy sentences ("you", or a name). */
  subject: { you: boolean; name: string };
  actions?: React.ReactNode;
  /** Remove a piece of feedback (asks first, on the page). Without it there is no Remove button. */
  onRemove?: (item: FeedbackItem) => void;
  /** The piece being removed right now, whose button waits. */
  removing?: string | null;
}) {
  const { system } = useCalendarSystem();
  const report = summariseReport(read.items);
  const who = subject.you ? 'you' : subject.name;
  return (
    <section aria-labelledby="fr-title" className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
        <div className="min-w-0 flex-[1_1_320px]">
          <h2 id="fr-title" className="m-0 text-[17px] font-extrabold text-ink">
            {title}
          </h2>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-slate-600">
            {read.loading ? 'Loading…' : `${periodLabel} · ${feedbackCount(report.count)}`}
          </p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>

      {read.error && (
        <p role="alert" className="m-0 border-t border-slate-200 px-5 py-4 text-sm font-semibold text-critical-text sm:px-7">
          {read.error}
        </p>
      )}

      {!read.error && !read.loading && (
        <>
          <ul aria-label="Feedback by kind of colleague" className="m-0 grid list-none grid-cols-2 gap-px border-y border-slate-200 bg-slate-200 p-0 lg:grid-cols-4">
            {report.roles.map(r => (
              <li key={r.relation} className="flex flex-col gap-0.5 bg-white px-5 py-3.5 sm:px-7 lg:px-5">
                <span className="text-[12.5px] font-bold text-slate-700">{RELATION_LABEL[r.relation]}</span>
                <span className="text-[26px] font-extrabold leading-tight tabular-nums text-ink">
                  {r.average == null ? <span aria-label="No feedback">–</span> : r.average.toFixed(1)}
                  {r.average != null && <span className="text-[13px] font-semibold text-slate-600"> / 5</span>}
                </span>
                <span className="text-[12px] text-slate-600">{r.count === 0 ? 'No feedback' : `${r.count} ${r.count === 1 ? 'review' : 'reviews'}`}</span>
              </li>
            ))}
          </ul>

          {read.items.length > 0 && <NamesProblem text={read.namesError} />}
          {read.items.length === 0 ? (
            <p className="m-0 px-5 py-8 text-center text-sm text-slate-600 sm:px-7">
              Nobody has given {who} feedback in {periodLabel} yet.
            </p>
          ) : (
            <ol aria-label={`What colleagues said in ${periodLabel}`} className="m-0 list-none p-0">
              {read.items.map(item => (
                <li key={item.id} className="flex gap-4 border-b border-slate-100 px-5 py-4 last:border-0 sm:px-7">
                  <RatingBadge rating={item.rating} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                      <GiverLabel item={item} />
                      <span>{formatAdDate(item.given_on, system)}</span>
                    </div>
                    {item.comment ? <p className="m-0 mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink">{item.comment}</p> : <p className="m-0 mt-1.5 text-sm italic text-slate-500">No comment.</p>}
                  </div>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(item)}
                      disabled={removing !== null}
                      aria-label={`Remove the feedback from ${giverWords(item)} on ${formatAdDate(item.given_on, system)}`}
                      className="-my-1 min-h-[44px] shrink-0 self-start rounded-[10px] border border-critical/40 bg-white px-3.5 text-[13px] font-extrabold text-critical-text hover:bg-critical-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-critical disabled:opacity-50"
                    >
                      {removing === item.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The customer forms typed in about the signed-in person, to read. There is nothing to edit here: the forms are typed in and
 * changed by the admin only.
 */
export function CustomerFormsReport({ periodLabel, forms, loading, error, namesError }: { periodLabel: string; forms: MyCustomerForm[]; loading: boolean; error: string; namesError: string }) {
  const { system } = useCalendarSystem();
  const summary = summariseRatings(forms.map(f => f.rating));
  return (
    <section aria-labelledby="cf-title" className={`${CARD} overflow-hidden`}>
      <div className="px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
        <h2 id="cf-title" className="m-0 text-[17px] font-extrabold text-ink">
          Feedback from customers
        </h2>
        <p className="m-0 mt-1 text-[13px] leading-relaxed text-slate-600">
          {loading ? 'Loading…' : `${periodLabel} · ${forms.length} ${formWord(forms.length)}${summary ? ` · average ${averageText(summary.average)} out of 5` : ''}`}
        </p>
      </div>

      {error && (
        <p role="alert" className="m-0 border-t border-slate-200 px-5 py-4 text-sm font-semibold text-critical-text sm:px-7">
          {error}
        </p>
      )}

      {!error && !loading && (
        <>
          {forms.length === 0 ? (
            <p className="m-0 border-t border-slate-200 px-5 py-8 text-center text-sm text-slate-600 sm:px-7">No customer forms have been typed in for you in {periodLabel} yet.</p>
          ) : (
            <>
              <NamesProblem text={namesError} />
              <ol aria-label={`Customer forms in ${periodLabel}`} className="m-0 list-none border-t border-slate-200 p-0">
                {forms.map(f => (
                  <li key={f.id} className="flex gap-4 border-b border-slate-100 px-5 py-4 last:border-0 sm:px-7">
                    <RatingBadge rating={f.rating} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                        {f.guest_name && <span className="text-[13.5px] font-extrabold text-ink">{f.guest_name}</span>}
                        <span className="font-bold text-slate-700">{formatAdDate(f.given_on, system)}</span>
                        {f.reference && <span>{f.reference}</span>}
                        {f.recommend != null && <span>Would recommend: {f.recommend} out of 10</span>}
                      </div>
                      {f.comment ? <p className="m-0 mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink">{f.comment}</p> : <p className="m-0 mt-1.5 text-sm italic text-slate-500">No comment.</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
