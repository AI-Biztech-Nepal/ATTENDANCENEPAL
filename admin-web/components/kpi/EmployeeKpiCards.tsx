'use client';

import { attendanceRates, type AttendanceKpi, type KpiGroup } from '@/lib/kpi';
import { compare, compareServices, lowerFirst, type Change } from '@/lib/compareKpi';
import { isKpiOn, type KpiId, type KpiSettings } from '@/lib/kpiSettings';
import { numberText } from '@/lib/ownKpi';
import { serviceWord, type WeekBar } from '@/lib/serviceKpi';
import type { PersonServices } from '@/lib/useServiceKpi';
import { rebookingPct } from '@/lib/rebookingKpi';
import { hoursText, restOfDay, utilisation } from '@/lib/utilisationKpi';
import { averageText, feedbackState, formWord } from '@/lib/feedbackKpi';
import { npsState, scoreText, scoreWords, sharePct } from '@/lib/npsKpi';
import { PEER_MIN, RELATION_OF_KPI, reviewWord, roleState } from '@/lib/colleagueKpi';
import type { PersonColleagues } from '@/lib/useColleagueKpi';
import type { PersonFeedback } from '@/lib/useFeedbackKpi';
import Link from 'next/link';
import type { PersonRebooking } from '@/lib/useRebookingKpi';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { Bars, KPI_COLORS, Pie, Ring } from './KpiCharts';

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** What a card says when its numbers could not be read, so it never claims "nothing imported" or "no forms" for data that
 * is only out of reach. The note above the cards (LoadProblems) says why. */
const UNREAD = { title: 'Could not be read', text: 'The note above says why.' };

function Card({ eyebrow, name, className = '', footer, children }: {
  eyebrow: string;
  name: string;
  className?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={name} className={`flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="text-[11.5px] font-extrabold uppercase tracking-wider text-slate-600">{eyebrow}</div>
      <h2 className="m-0 mb-3 mt-0.5 text-[15px] font-extrabold text-ink">{name}</h2>
      <div className="flex-1">{children}</div>
      {footer && <div className="mt-auto pt-3 text-xs text-slate-600">{footer}</div>}
    </section>
  );
}

function LegendRow({ color, label, value, bordered = false }: { color: string; label: string; value: string; bordered?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-slate-700">
      <i className={`block h-3 w-3 shrink-0 rounded-[3px] ${bordered ? 'border border-slate-400' : ''}`} style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <b className="tabular-nums text-ink">{value}</b>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div>
      <div className="text-[30px] font-extrabold leading-[1.1] tabular-nums text-ink">{big}</div>
      <div className="mt-0.5 text-[12.5px] font-bold text-ink">{label}</div>
    </div>
  );
}

/** One line saying how a number moved since last month: a small arrow for the direction and the words that carry the same
 * meaning. The arrow is only for the eye, and neither it nor its colour says whether the change is good: that depends on
 * the KPI. Every card works its two numbers out from its own data (see lib/compareKpi.ts). */
function Compare({ change, label }: { change: Change; label?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {change.dir !== 'none' && (
        <svg aria-hidden="true" viewBox="0 0 24 24" width={10} height={10} fill="currentColor" className="shrink-0 text-slate-500">
          {change.dir === 'up' ? <path d="M12 5 21 19H3z" /> : change.dir === 'down' ? <path d="M12 19 3 5h18z" /> : <path d="M4 8h16v3H4zM4 14h16v3H4z" />}
        </svg>
      )}
      <span>
        {label ? (
          <>
            <b className="font-bold text-slate-700">{label}:</b> {lowerFirst(change.text)}
          </>
        ) : (
          change.text
        )}
      </span>
    </div>
  );
}

function Message({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 py-4 text-center">
      <div className="text-sm font-bold text-slate-700">{title}</div>
      {text && <div className="text-xs text-slate-600">{text}</div>}
    </div>
  );
}

/** A KPI the company added itself: the number typed in for this person for the month, as it was typed in, with a plain
 * comparison against last month's. There is nothing to chart: it is one number, so it is shown as one. Without a number
 * the card says so and offers to type it in. */
export function OwnKpiCard({ eyebrow, name, data, monthName, previousName, notStarted, typeInHref, className = '' }: {
  eyebrow: string;
  name: string;
  data: { loading: boolean; current: number | null; previous: number | null; error: string };
  /** The month on screen without its year ("November", "Mangsir"). */
  monthName: string;
  previousName: string;
  notStarted: boolean;
  /** Where "Type in the numbers" goes: the Your own KPIs section, on this KPI. */
  typeInHref: string;
  className?: string;
}) {
  let body: React.ReactNode;
  if (notStarted) body = <Message title="Nothing to show yet" text="This month has not started." />;
  else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (data.current == null) body = <Message title={`Nothing typed in for ${monthName}`} text="Type in this person's number for the month." />;
  else {
    body = (
      <div className="flex items-baseline gap-3">
        <div className="text-[34px] font-extrabold leading-[1.1] tabular-nums text-ink">{numberText(data.current)}</div>
        <div className="text-[12.5px] text-slate-600">typed in for {monthName}</div>
      </div>
    );
  }
  const footer =
    !notStarted && !data.loading && !data.error && data.current != null && data.previous != null ? (
      <Compare change={compare(data.current, data.previous, { name: previousName, unit: 'number' })} />
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
      {!notStarted && (
        <Link
          href={typeInHref}
          className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 self-start rounded-lg border border-teal-700 bg-white px-3.5 text-[12.5px] font-extrabold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Type in the numbers
        </Link>
      )}
    </Card>
  );
}

/** Attendance and punctuality: the month's working days as a pie of on time / late / absent, with the two
 * percentages beside it. The one KPI that is real so far; the others below wait for their input. */
export function AttendanceCard({ eyebrow, name, current, previous, previousName, loading, notStarted, className = '' }: {
  /** The group's name and the KPI's name, as this company set them (see visibleGroups). */
  eyebrow: string;
  name: string;
  current: AttendanceKpi | null;
  previous: AttendanceKpi | null;
  /** The month before, as it is written under the KPI ("October", "Kartik"). */
  previousName: string;
  loading: boolean;
  notStarted: boolean;
  className?: string;
}) {
  let body: React.ReactNode;
  if (loading || !current) body = <Message title="Loading…" />;
  else if (!current.tracked) body = <Message title="Not tracked" text="This person is excused from attendance." />;
  else if (current.expectedDays === 0) body = <Message title="Nothing to show yet" text={notStarted ? 'This month has not started.' : 'No working days yet this month.'} />;
  else {
    const rates = attendanceRates(current);
    const onTime = current.presentDays - current.lateDays;
    const absent = current.expectedDays - current.presentDays;
    body = (
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        <Pie
          size={168}
          label
          aria={`Of ${dayCount(current.expectedDays)} of work: ${onTime} on time, ${current.lateDays} late, ${absent} absent`}
          slices={[
            { value: onTime, color: KPI_COLORS.good },
            { value: current.lateDays, color: KPI_COLORS.warn },
            { value: absent, color: KPI_COLORS.bad },
          ]}
        />
        <div className="flex min-w-[170px] flex-1 flex-col gap-2.5">
          <LegendRow color={KPI_COLORS.good} label="On time" value={dayCount(onTime)} />
          <LegendRow color={KPI_COLORS.warn} label="Late" value={dayCount(current.lateDays)} />
          <LegendRow color={KPI_COLORS.bad} label="Absent" value={dayCount(absent)} />
          <p className="m-0 mt-1 text-xs leading-normal text-slate-600">
            Out of {dayCount(current.expectedDays)} of work. Leave, week-offs and holidays are not counted.
            {current.leaveDays > 0 && ` On leave: ${dayCount(current.leaveDays)}.`}
          </p>
        </div>
        <div className="flex flex-col gap-3.5">
          <Stat big={`${rates.present}%`} label="present" />
          <Stat big={rates.onTime == null ? '–' : `${rates.onTime}%`} label="on time" />
        </div>
      </div>
    );
  }

  let footer: React.ReactNode = null;
  if (!loading && previous?.tracked) {
    if (previous.expectedDays === 0) footer = `${previousName}: no working days`;
    else {
      const pr = attendanceRates(previous);
      const cr = current && current.tracked && current.expectedDays > 0 ? attendanceRates(current) : null;
      footer =
        cr && cr.present != null && pr.present != null ? (
          <div className="flex flex-col gap-1">
            <Compare label="Present" change={compare(cr.present, pr.present, { name: previousName, unit: 'points', shown: `${pr.present}%` })} />
            {cr.onTime != null && pr.onTime != null && <Compare label="On time" change={compare(cr.onTime, pr.onTime, { name: previousName, unit: 'points', shown: `${pr.onTime}%` })} />}
          </div>
        ) : (
          `${previousName}: ${pr.present}% present, ${pr.onTime == null ? '–' : `${pr.onTime}%`} on time`
        );
    }
  }
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
    </Card>
  );
}

/** Services performed: the month's total, and bars of how many in each week. The week that is still going is a pale
 * bar. Under it, the whole of last month. Empty states say what is missing instead of showing a misleading 0. */
export function ServicesCard({ eyebrow, name, data, bars, monthName, previousName, thisMonthSoFar, notStarted, className = '' }: {
  eyebrow: string;
  name: string;
  data: PersonServices;
  bars: WeekBar[];
  /** The month on screen without its year ("November", "Mangsir"). */
  monthName: string;
  previousName: string;
  /** The month on screen is the one going on now. */
  thisMonthSoFar: boolean;
  notStarted: boolean;
  className?: string;
}) {
  const total = data.dates.length;
  const partial = bars.some(b => b.partial);
  let body: React.ReactNode;
  if (notStarted) body = <Message title="Nothing to show yet" text="This month has not started." />;
  else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (!data.monthHasData) body = <Message title="No services imported for this month" text="Import your booking file in the Import section to fill this in." />;
  else {
    body = (
      <>
        <div className="-mt-1 mb-1 flex items-baseline gap-3">
          <div className="text-[34px] font-extrabold leading-[1.1] tabular-nums text-ink">{total}</div>
          <div className="text-[12.5px] text-slate-600">{thisMonthSoFar ? `${serviceWord(total)} this month so far` : `${serviceWord(total)} in ${monthName}`}</div>
        </div>
        {total > 0 ? (
          <Bars
            bars={bars}
            aria={`Services performed each week in ${monthName}: ${bars.map(b => `${b.label} ${b.value}`).join(', ')}. Total ${total}.${partial ? ' The last bar is the week so far.' : ''}`}
          />
        ) : (
          <p className="m-0 text-sm text-slate-600">No services performed in {monthName}.</p>
        )}
      </>
    );
  }
  const showPrevious = !notStarted && !data.loading && !data.error && data.monthHasData && data.previousTotal != null;
  const footer =
    (showPrevious && data.previousTotal != null) || (partial && total > 0) ? (
      <div className="flex flex-col gap-1">
        {showPrevious && data.previousTotal != null && <Compare change={compareServices(total, data.previousTotal, previousName, !thisMonthSoFar)} />}
        {partial && total > 0 && <div>The pale bar is the week so far.</div>}
      </div>
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
    </Card>
  );
}

/** Rebooking rate: a ring of the share of this person's customers who booked again, with the two numbers beside it.
 * Under it, last month's rate. The empty states say what is missing (nothing imported, no customer codes, no customers). */
export function RebookingCard({ eyebrow, name, data, windowDays, monthName, previousName, notStarted, className = '' }: {
  eyebrow: string;
  name: string;
  data: PersonRebooking;
  windowDays: number;
  /** The month on screen without its year ("November", "Mangsir"). */
  monthName: string;
  previousName: string;
  notStarted: boolean;
  className?: string;
}) {
  const { words } = useKpiSettings();
  const cur = data.current;
  let body: React.ReactNode;
  if (notStarted) body = <Message title="Nothing to show yet" text="This month has not started." />;
  else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (data.reason === 'none') body = <Message title="No services imported for this month" text="Import your booking file in the Import section to fill this in." />;
  else if (data.reason === 'nocodes') body = <Message title={words.t('No customer codes in the file')} text={words.t('Choose a "Customer code" column when you import, so we can tell who came back.')} />;
  else if (!cur) body = <Message title={words.t(`No customers served in ${monthName}`)} />;
  else {
    const pct = rebookingPct(cur) ?? 0;
    body = (
      <>
        <div className="flex justify-center">
          <Ring pct={pct} size={156} stroke={16} aria={`${pct} percent: ${cur.back} of ${cur.served} ${cur.served === 1 ? words.one : words.many} booked again`} big={`${pct}%`} small="booked again" />
        </div>
        <div className="mt-3.5 flex flex-col gap-2">
          <LegendRow color={KPI_COLORS.accent} label="Booked again" value={String(cur.back)} />
          <LegendRow color={KPI_COLORS.track} bordered label="Not yet" value={String(cur.served - cur.back)} />
        </div>
        <p className="m-0 mt-2.5 text-xs leading-normal text-slate-600">
          {words.t(`Out of ${cur.served} ${cur.served === 1 ? 'customer' : 'customers'} served. A customer counts as booked again if they come back within ${windowDays} days of a visit. Recent visits may still come back.`)}
        </p>
      </>
    );
  }
  const previousPct = data.previous ? rebookingPct(data.previous) : null;
  const currentPct = cur ? rebookingPct(cur) : null;
  const footer =
    !notStarted && !data.loading && !data.error && !data.reason && currentPct != null && previousPct != null ? (
      <Compare change={compare(currentPct, previousPct, { name: previousName, unit: 'points', shown: `${previousPct}%` })} />
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
    </Card>
  );
}

/** Hour utilisation per day: a ring of how much of the working day this person spends with customers, averaged over the
 * days they worked, with the hours beside it. Under it, last month. The empty states say what is missing. */
export function UtilisationCard({ eyebrow, name, data, presentDays, previousPresentDays, attendanceLoading, hoursPerDay, monthName, previousName, notStarted, className = '' }: {
  eyebrow: string;
  name: string;
  data: PersonServices;
  /** Days at work this month and last, from attendance (null for someone excused from attendance). */
  presentDays: number | null;
  previousPresentDays: number | null;
  attendanceLoading: boolean;
  /** The working day in hours (Settings). */
  hoursPerDay: number;
  monthName: string;
  previousName: string;
  notStarted: boolean;
  className?: string;
}) {
  const { words } = useKpiSettings();
  const cur = utilisation(data.time, presentDays, hoursPerDay);
  const prev = utilisation(data.previousTime, previousPresentDays, hoursPerDay);
  let body: React.ReactNode;
  if (notStarted) body = <Message title="Nothing to show yet" text="This month has not started." />;
  else if (data.loading || attendanceLoading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (data.timeReason === 'none') body = <Message title="No services imported for this month" text="Import your booking file in the Import section to fill this in." />;
  else if (data.timeReason === 'notime') body = <Message title="No time in the file" text='Choose a "Time with the customer" column when you import, so the hours can be worked out.' />;
  else if (!cur) body = <Message title={`No services with a time in ${monthName}`} />;
  else {
    body = (
      <>
        <div className="flex justify-center">
          <Ring pct={cur.pct} size={156} stroke={16} aria={`${cur.pct} percent: ${hoursText(cur.avgHours)} hours of a ${hoursText(cur.hoursPerDay)}-hour day with a ${words.one}`} big={`${cur.pct}%`} small={`${hoursText(cur.avgHours)} of ${hoursText(cur.hoursPerDay)} h`} />
        </div>
        <div className="mt-3.5 flex flex-col gap-2">
          <LegendRow color={KPI_COLORS.accent} label={`With a ${words.one}`} value={`${hoursText(cur.avgHours)} h a day`} />
          <LegendRow color={KPI_COLORS.track} bordered label="Rest of the day" value={`${hoursText(restOfDay(cur))} h`} />
        </div>
        <p className="m-0 mt-2.5 text-xs leading-normal text-slate-600">
          {words.t(`Time with customers, out of a ${hoursText(cur.hoursPerDay)}-hour working day, averaged over ${cur.days} ${cur.days === 1 ? 'day' : 'days'} worked.`)}
        </p>
      </>
    );
  }
  const footer =
    !notStarted && !data.loading && !attendanceLoading && !data.error && !data.timeReason && cur && prev ? (
      <Compare change={compare(cur.pct, prev.pct, { name: previousName, unit: 'points', shown: `${prev.pct}%` })} />
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
    </Card>
  );
}

/** Customer feedback: the average rating out of 5 with how many forms it comes from, and a bar for each rating. Held back
 * until the month has as many forms as Settings asks for. Always offers to type in a form. */
export function FeedbackCard({ eyebrow, name, data, minForms, monthName, previousName, notStarted, typeInHref, className = '' }: {
  eyebrow: string;
  name: string;
  data: PersonFeedback;
  /** Forms a month needs before the average shows (Settings). */
  minForms: number;
  monthName: string;
  previousName: string;
  notStarted: boolean;
  /** Where "Type in a form" goes: this person's Customer feedback section. */
  typeInHref: string;
  className?: string;
}) {
  const { words } = useKpiSettings();
  const state = feedbackState(data.current, minForms);
  let body: React.ReactNode;
  if (notStarted) body = <Message title="Nothing to show yet" text="This month has not started." />;
  else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (!data.monthHasForms) body = <Message title="No forms typed in for this month" text={words.t('Type in the paper forms customers filled in, in the Customer feedback section.')} />;
  else if (state.kind === 'none') body = <Message title={`No forms typed in for this employee in ${monthName}`} />;
  else if (state.kind === 'few') {
    body = <Message title="Not enough forms yet" text={`${state.count} of ${state.need} ${formWord(state.need)} typed in. The average shows once there are ${state.need}, so one or two forms do not stand for a whole month.`} />;
  } else {
    const s = state.summary;
    const top = Math.max(...s.byRating, 1);
    body = (
      <>
        <div className="flex items-baseline gap-1.5">
          <div className="text-[34px] font-extrabold leading-[1.1] tabular-nums text-ink">{averageText(s.average)}</div>
          <div className="text-[15px] font-semibold text-slate-600">/ 5</div>
          <div className="ml-1.5 text-[12.5px] text-slate-600">
            from {s.count} {formWord(s.count)}
          </div>
        </div>
        <div role="img" aria-label={`Ratings: ${[5, 4, 3, 2, 1].map(n => `${n} ${n === 1 ? 'star' : 'stars'} ${s.byRating[n - 1]}`).join(', ')}`} className="mt-3.5 flex flex-col gap-2">
          {[5, 4, 3, 2, 1].map(n => (
            <div key={n} className="flex items-center gap-2.5">
              <span className="w-[52px] whitespace-nowrap text-[12.5px] text-slate-700">
                {n} {n === 1 ? 'star' : 'stars'}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full" style={{ width: `${(s.byRating[n - 1] / top) * 100}%`, background: KPI_COLORS.accent }} />
              </div>
              <span className="w-[22px] text-right text-[12.5px] font-extrabold tabular-nums text-ink">{s.byRating[n - 1]}</span>
            </div>
          ))}
        </div>
      </>
    );
  }
  const previous = feedbackState(data.previous, minForms);
  const footer =
    !notStarted && !data.loading && state.kind === 'ok' && previous.kind === 'ok' ? (
      <Compare change={compare(state.summary.average, previous.summary.average, { name: previousName, unit: 'rating' })} />
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
      <Link
        href={typeInHref}
        className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 self-start rounded-lg border border-teal-700 bg-white px-3.5 text-[12.5px] font-extrabold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Type in a form
      </Link>
    </Card>
  );
}

/** NPS: a donut of who would recommend (9 or 10), who is neutral (7 or 8) and who is not likely (0 to 6), with the score in the
 * middle (from -100 to +100). Held back until the month has as many forms as Settings asks for. */
export function NpsCard({ eyebrow, name, data, minForms, monthName, previousName, notStarted, className = '' }: {
  eyebrow: string;
  name: string;
  data: PersonFeedback;
  /** Forms a month needs before the NPS shows (Settings). */
  minForms: number;
  monthName: string;
  previousName: string;
  notStarted: boolean;
  className?: string;
}) {
  const { words } = useKpiSettings();
  const state = npsState(data.nps, minForms);
  let body: React.ReactNode;
  if (notStarted) body = <Message title="Nothing to show yet" text="This month has not started." />;
  else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (!data.monthHasNps) {
    body = (
      <Message
        title={data.monthHasForms ? 'No recommend numbers typed in for this month' : 'No forms typed in for this month'}
        text={words.t('Type in the paper forms customers filled in, in the Customer feedback section.')}
      />
    );
  } else if (state.kind === 'none') body = <Message title={`No recommend numbers for this employee in ${monthName}`} />;
  else if (state.kind === 'few') {
    body = <Message title="Not enough forms yet" text={`${state.count} of ${state.need} ${formWord(state.need)} with a recommend number. The NPS shows once there are ${state.need}, so one or two forms do not stand for a whole month.`} />;
  } else {
    const s = state.summary;
    body = (
      <>
        <div className="flex justify-center">
          <Pie
            size={156}
            hole={52}
            gap={3}
            aria={`NPS ${scoreWords(s.score)}: ${s.promoters} would recommend, ${s.passives} neutral, ${s.detractors} not likely`}
            slices={[
              { value: s.promoters, color: KPI_COLORS.good },
              { value: s.passives, color: KPI_COLORS.warn },
              { value: s.detractors, color: KPI_COLORS.bad },
            ]}
          >
            <text x={78} y={80} textAnchor="middle" fontSize={28} fontWeight={800} fill="#0f172a">
              {scoreText(s.score)}
            </text>
            <text x={78} y={98} textAnchor="middle" fontSize={12} fill="#475569">
              NPS
            </text>
          </Pie>
        </div>
        <div className="mt-3.5 flex flex-col gap-2">
          <LegendRow color={KPI_COLORS.good} label="Would recommend" value={`${s.promoters} · ${sharePct(s.promoters, s.count)}%`} />
          <LegendRow color={KPI_COLORS.warn} label="Neutral" value={`${s.passives} · ${sharePct(s.passives, s.count)}%`} />
          <LegendRow color={KPI_COLORS.bad} label="Not likely" value={`${s.detractors} · ${sharePct(s.detractors, s.count)}%`} />
        </div>
        <p className="m-0 mt-2.5 text-xs leading-normal text-slate-600">
          Out of {s.count} {formWord(s.count)}: 9 or 10 would recommend, 7 or 8 are neutral, 0 to 6 are not likely. The NPS is the share who would recommend minus the share who are not likely.
        </p>
      </>
    );
  }
  const previous = npsState(data.npsPrevious, minForms);
  const footer =
    !notStarted && !data.loading && state.kind === 'ok' && previous.kind === 'ok' ? (
      <Compare change={compare(state.summary.score, previous.summary.score, { name: previousName, unit: 'points', shown: scoreText(previous.summary.score) })} />
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
    </Card>
  );
}

const COLLEAGUES: { id: KpiId; label: string }[] = [
  { id: 'peers', label: 'Feedback from peers' },
  { id: 'manager', label: 'Feedback from immediate manager' },
  { id: 'clevel', label: 'Feedback from C-level' },
  { id: 'training', label: 'Feedback from training and compliance' },
];

/** The four colleague-feedback KPIs on one scale of 0 to 5: the average rating from peers, from the manager, from the C-level
 * executive and from training and compliance, in the month's round of reviews. A role shows once enough reviews are in
 * (three from peers, one from each of the others). Under each, how many reviews it is and last month's average. */
export function ColleagueCard({ group, settings, data, previousName, notStarted, className = '' }: {
  group: KpiGroup;
  settings: KpiSettings;
  data: PersonColleagues;
  previousName: string;
  notStarted: boolean;
  className?: string;
}) {
  const rows = COLLEAGUES.filter(c => isKpiOn(c.id, settings)).map(c => ({ id: c.id, label: settings.names[c.id] ?? c.label, relation: RELATION_OF_KPI[c.id as keyof typeof RELATION_OF_KPI] }));
  const footer = `${group.source}. Peers count once ${PEER_MIN} reviews are in, the others once one is in. The person never sees who said what.`;
  if (notStarted || data.loading) {
    return (
      <Card eyebrow={group.title} name="Feedback from colleagues" className={className} footer={footer}>
        <Message title={notStarted ? 'Nothing to show yet' : 'Loading…'} text={notStarted ? 'This month has not started.' : undefined} />
      </Card>
    );
  }
  return (
    <Card eyebrow={group.title} name="Feedback from colleagues" className={className} footer={footer}>
      <div className="flex flex-col">
        <div aria-hidden="true" className="hidden flex-wrap items-center gap-x-6 sm:flex">
          <div className="sm:w-[250px]" />
          <div className="relative h-[14px] min-w-[120px] flex-1">
            {[0, 1, 2, 3, 4, 5].map(n => (
              <span key={n} className="absolute -translate-x-1/2 text-[11px] text-slate-600" style={{ left: `${n * 20}%` }}>
                {n}
              </span>
            ))}
          </div>
          <div className="w-[74px]" />
        </div>
        {rows.map(({ id, label, relation }) => {
          const state = roleState(data.current?.[relation], relation);
          const last = roleState(data.previous?.[relation], relation);
          let meta: string;
          if (data.error) meta = UNREAD.title;
          else if (state.kind === 'none') meta = 'No feedback this month';
          else if (state.kind === 'few') meta = `${state.given} of ${state.need} ${reviewWord(state.need)}. Shown once ${state.need === 1 ? 'it is' : `${state.need} are`} in.`;
          else meta = `${state.given} ${reviewWord(state.given)}${last.kind === 'ok' ? ` · ${lowerFirst(compare(state.average, last.average, { name: previousName, unit: 'rating' }).text)}` : ''}`;
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-200 py-3">
              <div className="sm:w-[250px]">
                <div className="text-sm font-bold text-ink">{label}</div>
                <div className="mt-0.5 text-[12.5px] text-slate-600">{meta}</div>
              </div>
              <div className="relative h-[18px] min-w-[120px] flex-1">
                {[0, 1, 2, 3, 4, 5].map(n => (
                  <i key={n} aria-hidden="true" className="absolute bottom-0 top-0 w-px bg-slate-200" style={{ left: `${n * 20}%` }} />
                ))}
                {state.kind === 'ok' && (
                  <div
                    role="img"
                    aria-label={`${label}: ${averageText(state.average)} out of 5 from ${state.given} ${reviewWord(state.given)}`}
                    className="absolute left-0 top-[3px] h-3 rounded-r-md"
                    style={{ width: `${(state.average / 5) * 100}%`, background: KPI_COLORS.accent }}
                  />
                )}
              </div>
              <div className="w-[74px] text-right text-2xl font-extrabold leading-none tabular-nums text-ink">
                {state.kind === 'ok' ? (
                  <>
                    {averageText(state.average)}
                    <span className="text-[13px] font-semibold text-slate-600"> / 5</span>
                  </>
                ) : (
                  // The line under the name already says why there is no number, so the dash is only for the eye.
                  <span aria-hidden="true" className="text-slate-400">
                    –
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
