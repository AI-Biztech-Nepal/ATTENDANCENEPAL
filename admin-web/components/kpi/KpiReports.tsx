'use client';

import { useState } from 'react';
import ReportDialog from './ReportDialog';
import { KPI_COLORS } from './KpiCharts';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatAdDate, formatTime } from '@/lib/calendar';
import { attendanceRates, type AttendanceDayStatus, type AttendanceKpi } from '@/lib/kpi';
import { kpiLabel } from '@/lib/kpiSettings';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { daysBetween } from '@/lib/rebookingKpi';
import { servicesByDay, servicesByType, utilisationByDay, type ReportKind } from '@/lib/reportKpi';
import { useReportRebooking, useReportServices } from '@/lib/useKpiReport';
import { useFeedbackAbout, useMyCustomerForms, useMyFeedback, type FeedbackRead, type MyCustomerForm } from '@/lib/useFeedback';
import { averageText, formWord, summariseRatings } from '@/lib/feedbackKpi';
import { scoreText, summariseNps } from '@/lib/npsKpi';
import { hoursText, monthTime, utilisation } from '@/lib/utilisationKpi';
import { RELATION_LABEL, feedbackCount, ratingWord, summariseReport } from '@/lib/colleagueFeedback';
import { GiverLabel } from './FeedbackReport';
import { GuestHistoryBody, GuestName, GuestOpenContext } from './GuestHistory';
import type { GuestAnchor } from '@/lib/guestHistory';

/** What a report needs to know about the page it was opened from. */
export type ReportContext = {
  employeeId: string;
  /** The month on screen as AD date keys, and its name ("Mangsir 2083", "November 2026"). */
  start: string;
  end: string;
  monthLabel: string;
  /** Whose KPIs: a name on an admin's page, "you" on the employee's own. */
  personName: string;
  mine: boolean;
  hoursPerDay: number;
  today: string;
  attendance: AttendanceKpi | null;
};

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const TH = 'px-2 py-2 text-[11.5px] font-extrabold uppercase tracking-wider text-slate-600';
const TD = 'px-2 py-2.5 align-middle';

function useDayLabel() {
  const { system } = useCalendarSystem();
  return (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return `${new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })}, ${formatAdDate(date, system)}`;
  };
}

function Tiles({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <div className={`mb-4 grid grid-cols-2 gap-3 ${items.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
      {items.map(t => (
        <div key={t.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <div className="text-[26px] font-extrabold leading-none tabular-nums text-ink">{t.value}</div>
          <div className="mt-1.5 text-[12.5px] font-bold text-ink">{t.label}</div>
          {t.note && <div className="mt-0.5 text-[11.5px] text-slate-600">{t.note}</div>}
        </div>
      ))}
    </div>
  );
}

function Bar({ pct, color = KPI_COLORS.accent }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full min-w-[56px] overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => <h3 className="m-0 mb-1.5 mt-5 text-[13px] font-extrabold text-ink">{children}</h3>;

/** Loading, or why it could not be read, or the report itself. */
function Gate({ loading, error, children }: { loading: boolean; error: string; children: React.ReactNode }) {
  if (loading) return <p className="m-0 py-8 text-center text-sm text-slate-600">Loading…</p>;
  if (error) {
    return (
      <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-700">
        {error}
      </p>
    );
  }
  return <>{children}</>;
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="m-0 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600">{children}</p>;

const Stars = ({ rating }: { rating: number | null }) =>
  rating == null ? (
    <span className="text-[12.5px] text-slate-500">No rating</span>
  ) : (
    <span role="img" aria-label={`Rating ${rating} of 5`} className="text-[15px] tracking-wider" style={{ color: KPI_COLORS.warn }}>
      {'★'.repeat(rating)}
      <span className="text-slate-300">{'★'.repeat(5 - rating)}</span>
    </span>
  );

// ---------------------------------------------------------------------------
// Attendance and punctuality: every day of the month
// ---------------------------------------------------------------------------

const STATUS: Record<AttendanceDayStatus, { label: string; cls: string }> = {
  on_time: { label: 'On time', cls: 'bg-teal-50 text-teal-800' },
  late: { label: 'Late', cls: 'bg-amber-50 text-amber-800' },
  absent: { label: 'Absent', cls: 'bg-rose-50 text-rose-800' },
  leave: { label: 'On leave', cls: 'bg-sky-50 text-sky-800' },
  off: { label: 'Day off', cls: 'bg-slate-100 text-slate-600' },
};

function AttendanceReport({ ctx }: { ctx: ReportContext }) {
  const day = useDayLabel();
  const a = ctx.attendance;
  if (!a) return <Gate loading error="">{null}</Gate>;
  if (!a.tracked) return <Empty>{ctx.mine ? 'You are excused from attendance, so there is nothing to report.' : 'This person is excused from attendance, so there is nothing to report.'}</Empty>;
  const count = (s: AttendanceDayStatus) => a.days.filter(d => d.status === s).length;
  const rates = attendanceRates(a);
  return (
    <>
      <Tiles
        items={[
          { label: 'On time', value: String(count('on_time')), note: rates.onTime != null ? `${rates.onTime}% of days at work` : undefined },
          { label: 'Late', value: String(count('late')) },
          { label: 'Absent', value: String(count('absent')), note: rates.present != null ? `${rates.present}% present` : undefined },
          { label: 'On leave', value: String(count('leave')) },
        ]}
      />
      {a.days.length === 0 ? (
        <Empty>No days to show yet in {ctx.monthLabel}.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className={TH}>Day</th>
                <th scope="col" className={TH}>What happened</th>
                <th scope="col" className={`${TH} text-center`}>In</th>
                <th scope="col" className={`${TH} text-center`}>Out</th>
              </tr>
            </thead>
            <tbody>
              {a.days.map(d => (
                <tr key={d.date} className={`border-b border-slate-100 ${d.status === 'off' || d.status === 'leave' ? 'text-slate-600' : 'text-ink'}`}>
                  <th scope="row" className={`${TD} whitespace-nowrap font-semibold`}>{day(d.date)}</th>
                  <td className={TD}>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-bold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
                    {d.status === 'late' && d.lateMinutes > 0 && <span className="ml-2 text-[12px] text-slate-600">{' '}{d.lateMinutes} min late</span>}
                    {d.status === 'off' && d.checkIn && <span className="ml-2 text-[12px] text-slate-600">{' '}worked</span>}
                    {d.status === 'absent' && d.date === ctx.today && <span className="ml-2 text-[12px] text-slate-600">{' '}so far today</span>}
                  </td>
                  <td className={`${TD} text-center tabular-nums`}>{d.checkIn ? formatTime(d.checkIn) : '–'}</td>
                  <td className={`${TD} text-center tabular-nums`}>{d.checkIn && !d.checkOut ? <span className="text-slate-500">none</span> : d.checkOut ? formatTime(d.checkOut) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Services performed: by service and by day
// ---------------------------------------------------------------------------

function ServicesReport({ ctx }: { ctx: ReportContext }) {
  const day = useDayLabel();
  const { rows, loading, error } = useReportServices(ctx.employeeId, ctx.start, ctx.end, true);
  const types = servicesByType(rows);
  const days = servicesByDay(rows);
  const minutes = rows.reduce((n, r) => n + (r.minutes && r.minutes > 0 ? r.minutes : 0), 0);
  const topCount = types[0]?.count ?? 1;
  return (
    <Gate loading={loading} error={error}>
      {rows.length === 0 ? (
        <Empty>No services {ctx.mine ? 'for you ' : ''}in {ctx.monthLabel}.</Empty>
      ) : (
        <>
          <Tiles
            items={[
              { label: 'Services', value: String(rows.length), note: `on ${days.length} ${days.length === 1 ? 'day' : 'days'}` },
              { label: 'Time with guests', value: minutes > 0 ? `${hoursText(Math.round(minutes / 6) / 10)} h` : '–' },
              { label: 'Kinds of service', value: String(types.length) },
            ]}
          />
          <Heading>By service</Heading>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className={TH}>Service</th>
                  <th scope="col" className={`${TH} text-center`}>Done</th>
                  <th scope="col" className={`${TH} text-center`}>Time</th>
                  <th scope="col" className={`${TH} w-[26%]`}><span className="sr-only">Share</span></th>
                </tr>
              </thead>
              <tbody>
                {types.map(t => (
                  <tr key={t.service} className="border-b border-slate-100">
                    <th scope="row" className={`${TD} font-semibold text-ink`}>{t.service}</th>
                    <td className={`${TD} text-center font-bold tabular-nums text-ink`}>{t.count}</td>
                    <td className={`${TD} text-center tabular-nums text-slate-700`}>{t.minutes > 0 ? `${hoursText(Math.round(t.minutes / 6) / 10)} h` : '–'}</td>
                    <td className={TD}><Bar pct={(t.count / topCount) * 100} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Heading>Day by day</Heading>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className={TH}>Day</th>
                  <th scope="col" className={`${TH} text-center`}>Services</th>
                  <th scope="col" className={`${TH} text-center`}>Time with guests</th>
                </tr>
              </thead>
              <tbody>
                {days.map(d => (
                  <tr key={d.date} className="border-b border-slate-100">
                    <th scope="row" className={`${TD} whitespace-nowrap font-semibold text-ink`}>{day(d.date)}</th>
                    <td className={`${TD} text-center font-bold tabular-nums text-ink`}>{d.count}</td>
                    <td className={`${TD} text-center tabular-nums text-slate-700`}>{d.minutes > 0 ? `${hoursText(Math.round(d.minutes / 6) / 10)} h` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Rebooking rate: the guests served and who came back
// ---------------------------------------------------------------------------

function RebookingReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { guests, loading, error } = useReportRebooking({ employeeId: ctx.employeeId, start: ctx.start, end: ctx.end, mine: ctx.mine, enabled: true });
  const back = guests.filter(g => g.state === 'back').length;
  const pct = guests.length > 0 ? Math.round((back / guests.length) * 100) : null;
  return (
    <Gate loading={loading} error={error}>
      {guests.length === 0 ? (
        <Empty>{words.t(`No customers ${ctx.mine ? 'you ' : ''}served in ${ctx.monthLabel}.`)}</Empty>
      ) : (
        <>
          <Tiles
            items={[
              { label: words.t('Customers served'), value: String(guests.length) },
              { label: 'Booked again', value: String(back), note: pct != null ? `${pct}% of them` : undefined },
              { label: 'Not yet', value: String(guests.length - back) },
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className={TH}>{words.One}</th>
                  <th scope="col" className={TH}>First visit</th>
                  <th scope="col" className={`${TH} text-center`}>Visits</th>
                  <th scope="col" className={TH}>Came back</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g, i) => (
                  <tr key={g.key} className="border-b border-slate-100">
                    <th scope="row" className={`${TD} whitespace-nowrap font-semibold text-ink`}>
                      {g.name ? (
                        <GuestName name={g.name} anchor={g.anchorId ? { serviceId: g.anchorId } : null} />
                      ) : (
                        <span title={words.t('Imported before customer names were kept: import the file again to see the name.')}>
                          {words.One} {i + 1}
                        </span>
                      )}
                    </th>
                    <td className={`${TD} whitespace-nowrap text-slate-700`}>{day(g.first)}</td>
                    <td className={`${TD} text-center tabular-nums`}>{g.visits}</td>
                    <td className={TD}>
                      {g.state === 'back' && g.returnedOn ? (
                        <span className="font-semibold text-teal-800">
                          {day(g.returnedOn)} <span className="font-normal text-slate-600">· {dayCount(daysBetween(g.first, g.returnedOn))} later</span>
                        </span>
                      ) : (
                        <span className="text-slate-600">Not yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Hour utilisation per day: each day worked
// ---------------------------------------------------------------------------

function UtilisationReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { rows, loading, error } = useReportServices(ctx.employeeId, ctx.start, ctx.end, true);
  const a = ctx.attendance;
  const presentDates = (a?.days ?? []).filter(d => d.status === 'on_time' || d.status === 'late').map(d => d.date);
  const lines = utilisationByDay(rows, presentDates, ctx.hoursPerDay);
  const u = utilisation(monthTime(rows, ctx.start, ctx.end), a?.tracked ? a.presentDays : null, ctx.hoursPerDay);
  return (
    <Gate loading={loading} error={error}>
      {!u ? (
        <Empty>No time with {words.many} to show for {ctx.monthLabel}: no service has a time.</Empty>
      ) : (
        <>
          <Tiles
            items={[
              { label: `Share of the ${hoursText(ctx.hoursPerDay)}-hour day`, value: `${u.pct}%` },
              { label: `A day with ${words.many}`, value: `${hoursText(u.avgHours)} h`, note: `of ${hoursText(ctx.hoursPerDay)} h` },
              { label: 'Days worked', value: String(u.days) },
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className={TH}>Day</th>
                  <th scope="col" className={`${TH} text-center`}>Services</th>
                  <th scope="col" className={`${TH} text-center`}>With {words.many}</th>
                  <th scope="col" className={`${TH} w-[34%]`}>Share of the day</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.date} className="border-b border-slate-100">
                    <th scope="row" className={`${TD} whitespace-nowrap font-semibold text-ink`}>{day(l.date)}</th>
                    <td className={`${TD} text-center tabular-nums`}>{l.services || '–'}</td>
                    <td className={`${TD} text-center tabular-nums`}>{l.minutes > 0 ? `${hoursText(Math.round(l.minutes / 6) / 10)} h` : '0 h'}</td>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <Bar pct={l.pct} />
                        <span className="w-9 shrink-0 text-right text-[12.5px] font-bold tabular-nums text-ink">{l.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Guest feedback and NPS: the forms
// ---------------------------------------------------------------------------

function useForms(ctx: ReportContext) {
  return useMyCustomerForms(ctx.employeeId, ctx.start, ctx.end);
}

/** A small note when the names could not be read; the forms or feedback are still listed without them. */
function NamesNote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="m-0 mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-900">
      {text}
    </p>
  );
}

/** The guest's name on a form, when it is on file. */
const FormGuest = ({ f }: { f: MyCustomerForm }) => (f.guest_name ? <GuestName name={f.guest_name} anchor={{ feedbackId: f.id }} className="text-[13.5px]" /> : null);

function FormComment({ f }: { f: MyCustomerForm }) {
  return f.comment ? <p className="m-0 mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{f.comment}</p> : <p className="m-0 mt-1 text-sm italic text-slate-500">No comment.</p>;
}

function GuestFeedbackReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { forms, loading, error, namesError } = useForms(ctx);
  const summary = summariseRatings(forms.map(f => f.rating));
  const top = summary ? Math.max(...summary.byRating, 1) : 1;
  return (
    <Gate loading={loading} error={error}>
      {forms.length === 0 ? (
        <Empty>{words.t(`No customer forms ${ctx.mine ? 'for you ' : ''}in ${ctx.monthLabel}.`)}</Empty>
      ) : (
        <>
          <Tiles items={[{ label: 'Average rating', value: summary ? `${averageText(summary.average)} / 5` : '–', note: summary ? `from ${summary.count} ${formWord(summary.count)}` : 'no ratings' }, { label: 'Forms', value: String(forms.length) }]} />
          {summary && (
            <div className="mb-2 flex flex-col gap-1.5" role="img" aria-label={`Ratings: ${[5, 4, 3, 2, 1].map(n => `${n} ${n === 1 ? 'star' : 'stars'} ${summary.byRating[n - 1]}`).join(', ')}`}>
              {[5, 4, 3, 2, 1].map(n => (
                <div key={n} className="flex items-center gap-2 text-[12.5px] text-slate-700">
                  <span className="w-[50px] shrink-0">{n} {n === 1 ? 'star' : 'stars'}</span>
                  <Bar pct={(summary.byRating[n - 1] / top) * 100} />
                  <b className="w-6 shrink-0 text-right tabular-nums text-ink">{summary.byRating[n - 1]}</b>
                </div>
              ))}
            </div>
          )}
          <Heading>The forms</Heading>
          <NamesNote text={namesError} />
          <ol className="m-0 list-none p-0">
            {forms.map(f => (
              <li key={f.id} className="border-b border-slate-100 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                  <FormGuest f={f} />
                  <span className="font-bold text-slate-700">{day(f.given_on)}</span>
                  <Stars rating={f.rating} />
                  {f.recommend != null && <span>Would recommend: {f.recommend} out of 10</span>}
                  {f.reference && <span>{f.reference}</span>}
                </div>
                <FormComment f={f} />
              </li>
            ))}
          </ol>
        </>
      )}
    </Gate>
  );
}

function NpsReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { forms, loading, error, namesError } = useForms(ctx);
  const withNumber = forms.filter(f => f.recommend != null);
  const nps = summariseNps(withNumber.map(f => f.recommend));
  const kind = (n: number) => (n >= 9 ? { label: 'Would recommend', cls: 'bg-teal-50 text-teal-800' } : n >= 7 ? { label: 'Neutral', cls: 'bg-amber-50 text-amber-800' } : { label: 'Not likely', cls: 'bg-rose-50 text-rose-800' });
  return (
    <Gate loading={loading} error={error}>
      {!nps ? (
        <Empty>{words.t(`No recommend numbers ${ctx.mine ? 'for you ' : ''}in ${ctx.monthLabel}.`)}</Empty>
      ) : (
        <>
          <Tiles
            items={[
              { label: 'NPS', value: scoreText(nps.score), note: `from ${nps.count} ${formWord(nps.count)}` },
              { label: 'Would recommend', value: String(nps.promoters), note: '9 or 10' },
              { label: 'Neutral', value: String(nps.passives), note: '7 or 8' },
              { label: 'Not likely', value: String(nps.detractors), note: '0 to 6' },
            ]}
          />
          <Heading>The numbers given</Heading>
          <NamesNote text={namesError} />
          <ol className="m-0 list-none p-0">
            {withNumber.map(f => {
              const k = kind(f.recommend as number);
              return (
                <li key={f.id} className="border-b border-slate-100 py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                    <FormGuest f={f} />
                    <span className="font-bold text-slate-700">{day(f.given_on)}</span>
                    <b className="text-[15px] tabular-nums text-ink">{f.recommend} <span className="text-[12px] font-medium text-slate-600">out of 10</span></b>
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${k.cls}`}>{k.label}</span>
                    {f.reference && <span>{f.reference}</span>}
                  </div>
                  <FormComment f={f} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Feedback from colleagues: each piece, with who gave it
// ---------------------------------------------------------------------------

function ColleagueBody({ read, ctx }: { read: FeedbackRead; ctx: ReportContext }) {
  const day = useDayLabel();
  const report = summariseReport(read.items);
  return (
    <Gate loading={read.loading} error={read.error}>
      {read.items.length === 0 ? (
        <Empty>No feedback from colleagues {ctx.mine ? 'for you ' : ''}in {ctx.monthLabel}.</Empty>
      ) : (
        <>
          <Tiles items={report.roles.map(r => ({ label: RELATION_LABEL[r.relation], value: r.average != null ? `${r.average.toFixed(1)} / 5` : '–', note: r.count > 0 ? `${r.count} ${r.count === 1 ? 'review' : 'reviews'}` : 'none' }))} />
          <Heading>{feedbackCount(report.count)}</Heading>
          <NamesNote text={read.namesError} />
          <ol className="m-0 list-none p-0">
            {read.items.map(i => (
              <li key={i.id} className="border-b border-slate-100 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                  <GiverLabel item={i} />
                  <span className="font-bold text-slate-700">{day(i.given_on)}</span>
                  <b className="tabular-nums text-ink">{i.rating} / 5</b>
                  <span>{ratingWord(i.rating)}</span>
                </div>
                {i.comment ? <p className="m-0 mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{i.comment}</p> : <p className="m-0 mt-1 text-sm italic text-slate-500">No comment.</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Gate>
  );
}
// An admin reads the table; an employee goes through the function that hands over only their own feedback. Both then read who gave it.
const ColleaguesAdmin = ({ ctx }: { ctx: ReportContext }) => <ColleagueBody read={useFeedbackAbout(ctx.employeeId, ctx.start, ctx.end)} ctx={ctx} />;
const ColleaguesMine = ({ ctx }: { ctx: ReportContext }) => <ColleagueBody read={useMyFeedback(ctx.start, ctx.end)} ctx={ctx} />;

// ---------------------------------------------------------------------------
// The pop-up
// ---------------------------------------------------------------------------

/** The report behind one KPI card, in a pop-up. It reads nothing until it is open. */
export default function KpiReportDialog({ kind, ctx, onClose }: { kind: ReportKind; ctx: ReportContext; onClose: () => void }) {
  const { settings, words } = useKpiSettings();
  // A guest's name in the report opens their history here, in place of the report (which stays loaded behind it).
  const [guest, setGuest] = useState<{ anchor: GuestAnchor; name: string } | null>(null);
  const head: Record<ReportKind, { eyebrow: string; title: string }> = {
    attendance: { eyebrow: 'Attendance', title: kpiLabel('attendance', settings) },
    services: { eyebrow: 'Services', title: kpiLabel('services', settings, 'Number of services performed') },
    rebooking: { eyebrow: 'Services', title: kpiLabel('rebooking', settings) },
    utilisation: { eyebrow: 'Services', title: kpiLabel('utilisation', settings) },
    feedback: { eyebrow: words.Many, title: kpiLabel('feedback', settings) },
    nps: { eyebrow: words.Many, title: kpiLabel('nps', settings) },
    colleagues: { eyebrow: 'Colleagues', title: 'Feedback from colleagues' },
  };
  return (
    <ReportDialog
      eyebrow={guest ? words.One : head[kind].eyebrow}
      title={guest ? guest.name : head[kind].title}
      subtitle={guest ? undefined : `${ctx.personName} · ${ctx.monthLabel}`}
      onClose={onClose}
    >
      {guest && (
        <div>
          <button
            type="button"
            autoFocus
            onClick={() => setGuest(null)}
            className="-ml-1 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-1 text-sm font-bold text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Back to {head[kind].title}
          </button>
          <GuestHistoryBody anchor={guest.anchor} />
        </div>
      )}
      <div hidden={!!guest}>
        <GuestOpenContext.Provider value={(anchor, name) => setGuest({ anchor, name })}>
          {kind === 'attendance' && <AttendanceReport ctx={ctx} />}
          {kind === 'services' && <ServicesReport ctx={ctx} />}
          {kind === 'rebooking' && <RebookingReport ctx={ctx} />}
          {kind === 'utilisation' && <UtilisationReport ctx={ctx} />}
          {kind === 'feedback' && <GuestFeedbackReport ctx={ctx} />}
          {kind === 'nps' && <NpsReport ctx={ctx} />}
          {kind === 'colleagues' && (ctx.mine ? <ColleaguesMine ctx={ctx} /> : <ColleaguesAdmin ctx={ctx} />)}
        </GuestOpenContext.Provider>
      </div>
    </ReportDialog>
  );
}
