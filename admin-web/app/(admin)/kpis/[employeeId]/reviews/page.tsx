'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/leaveBalance';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { nepalTodayIso } from '@/lib/shift';
import { weekdayName } from '@/lib/taskSchedule';
import { otherCalendarSpan, parseMonthParam } from '@/lib/kpi';
import { useMonthInUrl } from '@/lib/useMonthInUrl';
import { useReviewsToGive } from '@/lib/useReviewsToGive';
import {
  DEFAULT_PEER_LIMIT,
  RELATION_AS,
  RELATION_LABEL,
  buildAssignments,
  describeAssignments,
  givenStatus,
  overlaps,
  roundProgress,
  stillToGive,
  type ColleagueReview,
  type ReviewGiver,
  type ReviewPerson,
  type ReviewRound,
  type ReviewToGive,
} from '@/lib/colleagueReviews';
import MonthStepper from '@/components/kpi/MonthStepper';
import GiveFeedbackDialog from '@/components/kpi/GiveFeedbackDialog';
import ReviewRulesDialog from '@/components/kpi/ReviewRulesDialog';
import { useConfirm } from '@/components/ConfirmDialog';

const SHOWN = 8;
const CHUNK = 500;

// Colleague reviews: once a month the company asks colleagues for feedback on each other (peers, the manager, the
// C-level executive, training and compliance). On one person's page this shows how far the reviews about them have
// got and who still owes them. The month's round (start it, close it) and the rules for who is asked are for the
// whole company and are here too. Employees give their feedback on their own portal; an admin or HR account
// that is chosen as a giver gives it here, under "For you to give". The person reviewed never sees who said what.
export default function ColleagueReviewsPage() {
  // useSearchParams needs a Suspense boundary, like the other pages that read the address.
  return (
    <Suspense fallback={null}>
      <ReviewsSection />
    </Suspense>
  );
}

function ReviewsSection() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const today = useMemo(nepalTodayIso, []);

  const [anchor, setAnchor] = useState(() => parseMonthParam(params.get('date')) ?? todayAnchor());
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);
  useMonthInUrl(start);

  const [people, setPeople] = useState<ReviewPerson[]>([]);
  const [peerLimit, setPeerLimit] = useState(DEFAULT_PEER_LIMIT);
  const [givers, setGivers] = useState<ReviewGiver[]>([]);
  const [rounds, setRounds] = useState<ReviewRound[] | null>(null);
  const [reviews, setReviews] = useState<ColleagueReview[] | null>(null);
  const [me, setMe] = useState<{ companyId: string | null; employeeId: string | null }>({ companyId: null, employeeId: null });
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<'start' | 'close' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [giving, setGiving] = useState<{ items: ReviewToGive[]; start: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const mine = useReviewsToGive(String(reloadKey));

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from('profiles').select('company_id, employee_id').eq('id', auth.user.id).single();
      if (live) setMe({ companyId: (data?.company_id as string | null) ?? null, employeeId: (data?.employee_id as string | null) ?? null });
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from('employees').select('id, name, department, status, reporting_to'),
      supabase.from('review_settings').select('peer_limit').limit(1),
      supabase.from('review_givers').select('employee_id, relation'),
      supabase.from('review_rounds').select('*').order('period_start', { ascending: false }),
    ]).then(([emp, settings, giv, rnd]) => {
      if (!live) return;
      const failed = emp.error ?? rnd.error;
      if (failed) {
        setLoadError(`Could not load the reviews: ${failed.message}`);
        setRounds([]);
        return;
      }
      setLoadError('');
      setPeople(((emp.data as ReviewPerson[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      setPeerLimit(((settings.data as { peer_limit: number }[] | null) ?? [])[0]?.peer_limit ?? DEFAULT_PEER_LIMIT);
      setGivers((giv.data as ReviewGiver[] | null) ?? []);
      setRounds((rnd.data as ReviewRound[] | null) ?? []);
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  // The round for the month on screen: exactly this month's days. Another round that overlaps them (started in the
  // other calendar) is noted, and blocks starting a second one.
  const round = useMemo(() => (rounds ?? []).find(r => r.period_start === start && r.period_end === end) ?? null, [rounds, start, end]);
  const clash = useMemo(() => (round ? null : ((rounds ?? []).find(r => overlaps(r, { period_start: start, period_end: end })) ?? null)), [rounds, round, start, end]);

  useEffect(() => {
    if (!round) {
      setReviews([]);
      return;
    }
    let live = true;
    setReviews(null);
    fetchAll<ColleagueReview>((a, b) =>
      supabase.from('colleague_reviews').select('id, round_id, subject_id, reviewer_id, relation, rating, given_at').eq('round_id', round.id).order('id', { ascending: true }).range(a, b)
    ).then(rows => {
      if (live) setReviews(rows);
    });
    return () => {
      live = false;
    };
  }, [round, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const nameOf = useCallback((id: string) => people.find(p => p.id === id)?.name ?? 'Someone who has left', [people]);
  const dayText = (d: string) => `${weekdayName(d)} ${formatAdDate(d, system)}`;

  // This person's part of the round: the reviews about them.
  const personName = people.find(p => p.id === employeeId)?.name ?? 'this person';
  const about = useMemo(() => (reviews ?? []).filter(r => r.subject_id === employeeId), [reviews, employeeId]);
  const progress = roundProgress(about);
  const pct = progress.total > 0 ? Math.round((progress.given / progress.total) * 100) : 0;
  const lines = useMemo(() => stillToGive(about, nameOf, nameOf), [about, nameOf]);
  const shownLines = showAll ? lines : lines.slice(0, SHOWN);
  const myItems = (mine.items ?? []).filter(i => round && i.round_id === round.id);

  async function ask() {
    setActionError('');
    const list = buildAssignments(people, givers, peerLimit, (rounds ?? []).length);
    const d = describeAssignments(list);
    if (d.total === 0) {
      setActionError('There is nobody to ask yet. Choose who gives feedback below, and set a department and "Reports to" on the employees\' profiles.');
      return;
    }
    const ok = await confirm(
      `This asks ${d.givers} ${d.givers === 1 ? 'person' : 'people'} for ${d.total} reviews for ${label}: ${d.byRelation.peer} from peers, ${d.byRelation.manager} from managers, ${d.byRelation.c_level} from C-level and ${d.byRelation.training} from training and compliance.`,
      { title: 'Ask for feedback', confirmLabel: 'Ask for feedback' }
    );
    if (!ok) return;
    setBusy('start');
    const created = await supabase.from('review_rounds').insert({ title: label, period_start: start, period_end: end, due_on: end }).select('id');
    const roundId = (created.data as { id: string }[] | null)?.[0]?.id;
    if (created.error || !roundId) {
      setBusy(null);
      setActionError(`Could not start the round: ${created.error?.message ?? 'no round was created'}`);
      return;
    }
    for (let i = 0; i < list.length; i += CHUNK) {
      const added = await supabase.from('colleague_reviews').insert(list.slice(i, i + CHUNK).map(a => ({ round_id: roundId, ...a })));
      if (added.error) {
        // Take the half-started round back, so there is never a round with only some of its reviews.
        await supabase.from('review_rounds').delete().eq('id', roundId);
        setBusy(null);
        setActionError(`Could not start the round: ${added.error.message}`);
        return;
      }
    }
    setBusy(null);
    reload();
  }

  async function closeRound() {
    if (!round) return;
    setActionError('');
    const ok = await confirm(
      `Close the ${round.title} round? Feedback that has not been given yet can no longer be given. What was given stays.`,
      { title: 'Close round', confirmLabel: 'Close round', tone: 'danger' }
    );
    if (!ok) return;
    setBusy('close');
    const done = await supabase.from('review_rounds').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', round.id).select('id');
    setBusy(null);
    if (done.error || !(done.data as unknown[] | null)?.length) {
      setActionError(`Could not close the round: ${done.error?.message ?? 'it was not found'}`);
      return;
    }
    reload();
  }

  function giveNow(reviewerId: string, relation: string) {
    const items = myItems.filter(i => i.relation === relation && !i.given_at);
    if (reviewerId === me.employeeId && items.length > 0) setGiving({ items, start: 0 });
  }

  const roleList = (rel: 'c_level' | 'training') => {
    const names = givers.filter(g => g.relation === rel).map(g => nameOf(g.employee_id)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return names.length > 0 ? `Chosen people: ${names.join(', ')}` : 'Nobody chosen yet';
  };

  const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
  const TH = 'py-[11px] text-xs font-extrabold uppercase tracking-wider text-slate-600';
  const notStarted = start > today;
  const open = round?.status === 'open';

  return (
    <div className="flex flex-col gap-5">
      {loadError && (
        <p role="alert" className="m-0 rounded-xl border border-critical/30 bg-critical-bg px-4 py-3 text-sm font-semibold text-critical-text">
          {loadError}
        </p>
      )}

      <section aria-labelledby="round-heading" className={`${CARD} px-7 py-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <div>
            <h2 id="round-heading" className="sr-only">
              {label} round
            </h2>
            <MonthStepper
              label={label}
              subtitle={round ? `${otherSpan ? `${otherSpan} · ` : ''}Started ${dayText(round.created_at.slice(0, 10))}` : otherSpan}
              onPrevious={() => {
                setAnchor(a => stepAnchor(system, a, -1));
                setShowAll(false);
              }}
              onNext={() => {
                setAnchor(a => stepAnchor(system, a, 1));
                setShowAll(false);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {!round && (
              <button
                type="button"
                onClick={ask}
                disabled={busy !== null || notStarted || !!clash || rounds === null}
                className="min-h-[44px] rounded-[10px] bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busy === 'start' ? 'Asking…' : 'Ask for feedback'}
              </button>
            )}
            {open && (
              <button
                type="button"
                onClick={closeRound}
                disabled={busy !== null}
                className="min-h-[44px] rounded-[10px] border border-teal-700 bg-white px-[18px] text-sm font-extrabold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
              >
                {busy === 'close' ? 'Closing…' : 'Close round'}
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <p role="alert" className="m-0 mt-3 text-sm font-semibold text-critical-text">
            {actionError}
          </p>
        )}

        {round ? (
          <>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
              <span className="text-[26px] font-extrabold tabular-nums text-ink">
                {reviews ? `${progress.given} of ${progress.total}` : '…'}
              </span>
              <span className="text-[13.5px] text-slate-600">
                reviews about {personName} given · {progress.waiting} still waiting · feedback is asked once a month
                {round.status === 'closed' ? ' · round closed' : round.due_on ? ` · please give by ${dayText(round.due_on)}` : ''}
              </span>
            </div>
            <div role="img" aria-label={`${progress.given} of ${progress.total} reviews given`} className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-teal-700" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="m-0 mt-3.5 text-[13.5px] leading-relaxed text-slate-600">
            {rounds === null
              ? 'Loading…'
              : clash
                ? `A round called "${clash.title}" (${dayText(clash.period_start)} to ${dayText(clash.period_end)}) already covers part of ${label}, so a second one cannot start. Go to its month to follow it.`
                : notStarted
                  ? `${label} has not started yet.`
                  : `No round for ${label} yet. Ask for feedback to start it: peers, managers and the people chosen below are asked, following the rules at the bottom of the page.`}
          </p>
        )}
      </section>

      {round && (
        <div className="flex flex-wrap items-start gap-5">
          <section aria-labelledby="still-heading" className={`${CARD} min-w-0 flex-[3_1_620px] overflow-hidden pt-5`}>
            <h2 id="still-heading" className="m-0 px-6 text-[17px] font-extrabold text-ink">
              {round.status === 'closed' ? 'Not given' : 'Still to give'}
            </h2>
            <p className="m-0 mb-3 mt-1 px-6 text-[13px] text-slate-600">Feedback about {personName}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50">
                    <th scope="col" className={`${TH} px-6`}>Giver</th>
                    <th scope="col" className={`${TH} px-3`}>Gives as</th>
                    <th scope="col" className={`${TH} px-3`}>Status</th>
                    <th scope="col" aria-label="Action" className={`${TH} px-6`} />
                  </tr>
                </thead>
                <tbody>
                  {reviews === null ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-600">Loading…</td>
                    </tr>
                  ) : lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-600">
                        {progress.total === 0 ? `This round asked for no reviews about ${personName}.` : 'Every review has been given.'}
                      </td>
                    </tr>
                  ) : (
                    shownLines.map(l => (
                      <tr key={`${l.reviewerId}|${l.relation}`} className="border-b border-slate-100 last:border-0">
                        <td className="px-6 py-[13px] text-[13.5px] font-bold text-ink">{nameOf(l.reviewerId)}</td>
                        <td className="px-3 py-[13px] text-[13px] text-slate-700">{RELATION_LABEL[l.relation]}</td>
                        <td className="px-3 py-[13px] text-[13px] text-slate-700">{givenStatus(l)}</td>
                        <td className="px-6 py-[13px] text-right">
                          {open && l.reviewerId === me.employeeId && (
                            <button type="button" onClick={() => giveNow(l.reviewerId, l.relation)} className="text-[12.5px] font-extrabold text-accent hover:underline">
                              Give now
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {lines.length > SHOWN && (
              <div className="flex items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-6 py-3 text-[12.5px] text-slate-600">
                Showing {shownLines.length} of {lines.length} ·
                <button type="button" onClick={() => setShowAll(s => !s)} className="font-bold text-accent hover:underline">
                  {showAll ? 'Show fewer' : 'See all'}
                </button>
              </div>
            )}
          </section>

          {myItems.length > 0 && (
            <section aria-labelledby="mine-heading" className={`${CARD} min-w-0 flex-[2_1_380px] px-6 pb-2 pt-5`}>
              <h2 id="mine-heading" className="m-0 text-[17px] font-extrabold text-ink">For you to give</h2>
              <p className="m-0 mb-2 mt-1 text-[13px] leading-normal text-slate-600">
                You are chosen to give feedback this month. Admin and HR accounts give it here; employees give theirs on their own Feedback page.
              </p>
              {myItems.map(it => (
                <div key={it.review_id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-slate-200 py-3">
                  <div className="min-w-[140px] flex-1">
                    <div className="text-sm font-bold text-ink">{it.subject_name}</div>
                    <div className="text-[12.5px] text-slate-600">
                      {RELATION_AS[it.relation]}
                      {it.given_at ? ' · given' : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGiving(it.given_at ? { items: [it], start: 0 } : { items: myItems.filter(x => !x.given_at), start: myItems.filter(x => !x.given_at).findIndex(x => x.review_id === it.review_id) })}
                    className="min-h-[40px] rounded-lg border border-teal-700 bg-white px-4 text-[13px] font-extrabold text-teal-700 hover:bg-teal-50"
                    aria-label={`${it.given_at ? 'Change' : 'Give'} feedback for ${it.subject_name}`}
                  >
                    {it.given_at ? 'Change' : 'Give feedback'}
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      <section aria-labelledby="rules-heading" className={`${CARD} overflow-hidden pt-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-7 pb-3">
          <div>
            <h2 id="rules-heading" className="m-0 text-[17px] font-extrabold text-ink">Who gives feedback to whom</h2>
            <p className="m-0 mt-1 text-[13px] text-slate-600">Set once. Each month&apos;s round follows these rules.</p>
          </div>
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            disabled={!me.companyId}
            className="min-h-[40px] rounded-lg border border-teal-700 bg-white px-4 text-[13px] font-extrabold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
          >
            Change
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50">
                <th scope="col" className={`${TH} w-[240px] px-7`}>Feedback from</th>
                <th scope="col" className={`${TH} px-3`}>Who gives it</th>
                <th scope="col" className={`${TH} w-[200px] px-3 pr-7`}>Giver&apos;s name</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Peers', `People in the same department, up to ${peerLimit} for each person`],
                ['Immediate manager', "The manager set on each person's profile (Reports to)"],
                ['C-level executive', roleList('c_level')],
                ['Training and compliance', roleList('training')],
              ].map(([feedbackFrom, who]) => (
                <tr key={feedbackFrom} className="border-b border-slate-100 last:border-0">
                  <td className="px-7 py-3.5 text-sm font-bold text-ink">{feedbackFrom}</td>
                  <td className="px-3 py-3.5 text-[13.5px] text-slate-700">{who}</td>
                  <td className="px-3 py-3.5 pr-7 text-[13.5px] text-slate-700">Hidden from the person</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rulesOpen && me.companyId && (
        <ReviewRulesDialog
          people={people}
          peerLimit={peerLimit}
          givers={givers}
          companyId={me.companyId}
          onClose={() => setRulesOpen(false)}
          onSaved={() => {
            setRulesOpen(false);
            reload();
          }}
        />
      )}

      {giving && <GiveFeedbackDialog items={giving.items} start={giving.start} onClose={() => setGiving(null)} onChanged={reload} />}
    </div>
  );
}
