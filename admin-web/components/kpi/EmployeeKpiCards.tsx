'use client';

import { attendanceRates, type AttendanceKpi, type KpiGroup } from '@/lib/kpi';
import { isKpiOn, type KpiId, type KpiSettings } from '@/lib/kpiSettings';
import { serviceWord, type WeekBar } from '@/lib/serviceKpi';
import type { PersonServices } from '@/lib/useServiceKpi';
import { rebookingPct } from '@/lib/rebookingKpi';
import { hoursText, restOfDay, utilisation } from '@/lib/utilisationKpi';
import type { PersonRebooking } from '@/lib/useRebookingKpi';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { Bars, KPI_COLORS, Pie, Ring } from './KpiCharts';

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

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

function Message({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 py-4 text-center">
      <div className="text-sm font-bold text-slate-700">{title}</div>
      {text && <div className="text-xs text-slate-600">{text}</div>}
    </div>
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

  let footer: string | null = null;
  if (!loading && previous?.tracked) {
    if (previous.expectedDays === 0) footer = `${previousName}: no working days`;
    else {
      const r = attendanceRates(previous);
      footer = `${previousName}: ${r.present}% present, ${r.onTime == null ? '–' : `${r.onTime}%`} on time`;
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
  const showPrevious = !notStarted && !data.loading && data.monthHasData && data.previousTotal != null;
  const footer = [showPrevious ? `Whole of ${previousName}: ${data.previousTotal}` : '', partial && total > 0 ? 'The pale bar is the week so far.' : ''].filter(Boolean).join('. ');
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer ? `${footer}${footer.endsWith('.') ? '' : '.'}` : null}>
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
  const footer = !notStarted && !data.loading && !data.reason && previousPct != null ? `${previousName}: ${previousPct}%` : null;
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
  const footer = !notStarted && !data.loading && !attendanceLoading && !data.timeReason && prev ? `${previousName}: ${prev.pct}%` : null;
  return (
    <Card eyebrow={eyebrow} name={name} className={className} footer={footer}>
      {body}
    </Card>
  );
}

/** A KPI whose input does not exist yet: the card keeps its place on the page with a dash (and an empty ring
 * where the finished card has one), and says where the numbers will come from. */
export function PendingCard({ group, name, ring = false, className = '' }: { group: KpiGroup; name: string; ring?: boolean; className?: string }) {
  return (
    <Card eyebrow={group.title} name={name} className={className}>
      <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2 py-2 text-center">
        {ring ? (
          <Ring pct={0} size={120} stroke={14} aria={`${name}: not connected yet`} big="–" />
        ) : (
          <div aria-hidden="true" className="text-[34px] font-extrabold leading-none text-slate-400">
            –
          </div>
        )}
        <div className="text-sm font-bold text-slate-700">Not connected yet</div>
        <div className="text-xs text-slate-600">{group.source}</div>
        <span className="sr-only">{group.emptyNote}</span>
      </div>
    </Card>
  );
}

const COLLEAGUES: { id: KpiId; label: string }[] = [
  { id: 'peers', label: 'Feedback from peers' },
  { id: 'manager', label: 'Feedback from immediate manager' },
  { id: 'clevel', label: 'Feedback from C-level' },
  { id: 'training', label: 'Feedback from training and compliance' },
];

/** The four colleague-feedback KPIs on one scale of 0 to 5. Empty until reviews exist. */
export function ColleagueCard({ group, settings, className = '' }: { group: KpiGroup; settings: KpiSettings; className?: string }) {
  const rows = COLLEAGUES.filter(c => isKpiOn(c.id, settings)).map(c => ({ id: c.id, label: settings.names[c.id] ?? c.label }));
  return (
    <Card eyebrow={group.title} name="Feedback from colleagues" className={className} footer={`${group.source}. Not connected yet. Comments will be seen by management only.`}>
      <div className="flex flex-col">
        {rows.map(({ id, label }) => (
          <div key={id} className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-200 py-3">
            <div className="text-sm font-bold text-ink sm:w-[250px]">{label}</div>
            <div aria-hidden="true" className="h-3 min-w-[120px] flex-1 rounded-full bg-slate-100" />
            <div className="w-[74px] text-right text-2xl font-extrabold leading-none text-slate-400">
              <span aria-hidden="true">–</span>
              <span className="sr-only">{group.emptyNote}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
