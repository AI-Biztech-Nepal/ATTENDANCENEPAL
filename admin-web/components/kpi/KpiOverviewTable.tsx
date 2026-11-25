'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { attendanceRates, type AttendanceKpi, type KpiGroup } from '@/lib/kpi';
import { serviceWord } from '@/lib/serviceKpi';
import { rebookingPct, type Rebooking } from '@/lib/rebookingKpi';
import type { RebookingReason } from '@/lib/useRebookingKpi';
import type { ServiceMonth } from '@/lib/useServiceKpi';
import { averageText, feedbackState, formWord, type FeedbackSummary } from '@/lib/feedbackKpi';
import { npsState, scoreText, type NpsSummary } from '@/lib/npsKpi';
import type { FeedbackMonth } from '@/lib/useFeedbackKpi';
import { RELATION_OF_KPI, reviewWord, roleState, type Roles } from '@/lib/colleagueKpi';
import { hoursText, utilisation } from '@/lib/utilisationKpi';
import { isOwnColumn, numberText, ownIdOf } from '@/lib/ownKpi';
import type { OwnMonth } from '@/lib/useOwnKpiValues';
import type { Employee } from '@/lib/types';

type Props = {
  /** The KPI groups to show, as this company set them up (see visibleGroups). */
  groups: KpiGroup[];
  employees: Employee[];
  attendance: Map<string, AttendanceKpi>;
  /** Services performed in the month, per person (`counts` is null when no booking file covers the month), and the time
   * each spent with customers. */
  services: ServiceMonth;
  /** The working day, in hours (Settings), that time with customers is measured against. */
  hoursPerDay: number;
  /** Rebooking per person: of the customers served, how many came back on a later day (no time limit). */
  rebooking: { loading: boolean; byEmployee: Map<string, Rebooking> | null; reason: RebookingReason; error: string };
  /** Customer feedback and NPS per person from the forms typed in. */
  feedback: FeedbackMonth;
  /** Colleague feedback per person, from the feedback colleagues gave during the month. `bySubject` is null when nobody was given any. */
  colleagues: { loading: boolean; bySubject: Map<string, Roles> | null; error: string };
  /** The numbers typed in for the KPIs the company added itself, per KPI and person. */
  own: OwnMonth;
  loading: boolean;
  /** The month being shown has not begun, so there is nothing to count yet. */
  notStarted: boolean;
  /** The month's first day (AD), sent along so a person's page opens on the same month. */
  monthStart: string;
  /** What the table says when nobody is listed (a search that matched no one says so). */
  emptyText?: string;
};

/** One row per person, the KPIs across (a line between the groups of KPIs that come from the same place). Nothing is
 * added up, ranked or compared: a dash means there is nothing to show yet, or its numbers could not be read (the note
 * above the table says so in that case). */
export default function KpiOverviewTable({ groups, employees, attendance, services, hoursPerDay, rebooking, feedback, colleagues, own, loading, notStarted, monthStart, emptyText = 'No employees to show.' }: Props) {
  const columnCount = 1 + groups.reduce((n, g) => n + g.columns.length, 0);
  // The name column and every KPI column at its width, so the table scrolls sideways before it squeezes.
  const minWidth = 210 + groups.reduce((n, g) => n + g.columns.reduce((m, c) => m + c.width, 0), 0);
  return (
    <section aria-label="KPIs by employee" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table style={{ minWidth }} className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th
                scope="col"
                className="w-[210px] bg-slate-50 px-5 py-3.5 align-middle md:sticky md:left-0 md:z-10 text-xs font-extrabold uppercase tracking-wider text-slate-600"
              >
                Employee
              </th>
              {groups.flatMap(g =>
                g.columns.map((c, i) => (
                  <th
                    key={c.id}
                    scope="col"
                    style={{ width: c.width }}
                    className={`px-3 py-3.5 text-center align-middle text-xs font-bold leading-snug text-slate-700 ${i === 0 ? 'border-l border-slate-200' : ''}`}
                  >
                    {c.label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="px-5 py-10 text-center text-sm text-slate-600">
                  Loading…
                </td>
              </tr>
            ) : employees.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-5 py-10 text-center text-sm text-slate-600">
                  {emptyText}
                </td>
              </tr>
            ) : (
              employees.map(emp => {
                const kpi = attendance.get(emp.id);
                return (
                  <tr key={emp.id} className="border-t border-slate-100">
                    <th scope="row" className="bg-white px-5 py-3.5 text-left font-normal md:sticky md:left-0 md:z-10">
                      <div className="flex items-center gap-3">
                        <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-9 w-9 text-[13px]" />
                        <div className="min-w-0">
                          <Link href={`/kpis/${emp.id}?date=${monthStart}`} className="block truncate text-sm font-bold text-ink hover:text-accent hover:underline">
                            {emp.name}
                          </Link>
                          <div className="truncate text-xs text-slate-600">{subtitle(emp, kpi)}</div>
                        </div>
                      </div>
                    </th>
                    {groups.map(g =>
                      g.columns.map((c, i) =>
                        c.id === 'attendance' ? (
                          <AttendanceCell key={c.id} kpi={kpi} notStarted={notStarted} />
                        ) : c.id === 'services' ? (
                          <ServicesCell key={c.id} group={g} first={i === 0} loading={services.loading} counts={services.counts} unread={!!services.error} employeeId={emp.id} notStarted={notStarted} />
                        ) : c.id === 'utilisation' ? (
                          <UtilisationCell key={c.id} group={g} first={i === 0} services={services} kpi={kpi} hoursPerDay={hoursPerDay} employeeId={emp.id} notStarted={notStarted} />
                        ) : c.id === 'feedback' ? (
                          <FeedbackCell key={c.id} group={g} first={i === 0} loading={feedback.loading} byEmployee={feedback.byEmployee} unread={!!feedback.error} employeeId={emp.id} notStarted={notStarted} />
                        ) : c.id === 'peers' || c.id === 'manager' || c.id === 'clevel' || c.id === 'training' ? (
                          <ColleagueCell key={c.id} group={g} first={i === 0} loading={colleagues.loading} bySubject={colleagues.bySubject} unread={!!colleagues.error} kpiId={c.id} employeeId={emp.id} notStarted={notStarted} />
                        ) : c.id === 'nps' ? (
                          <NpsCell key={c.id} group={g} first={i === 0} loading={feedback.loading} nps={feedback.nps} unread={!!feedback.error} employeeId={emp.id} notStarted={notStarted} />
                        ) : isOwnColumn(c.id) ? (
                          <OwnCell key={c.id} group={g} first={i === 0} loading={own.loading} values={own.byKpi.get(ownIdOf(c.id))} unread={!!own.error} employeeId={emp.id} notStarted={notStarted} />
                        ) : c.id === 'rebooking' ? (
                          <RebookingCell key={c.id} group={g} first={i === 0} loading={rebooking.loading} byEmployee={rebooking.byEmployee} reason={rebooking.reason} unread={!!rebooking.error} employeeId={emp.id} notStarted={notStarted} />
                        ) : (
                          <EmptyCell key={c.id} group={g} first={i === 0} />
                        )
                      )
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** What a dash says to a screen reader when its numbers could not be read (the note above the table says why), so it never
 * claims "nothing imported" for data that is only out of reach. */
const UNREAD = 'Could not be read';

function subtitle(emp: Employee, kpi: AttendanceKpi | undefined) {
  const parts: string[] = [];
  if (emp.department) parts.push(emp.department);
  if (kpi && !kpi.tracked) parts.push('Excused from attendance');
  else if (kpi && kpi.leaveDays > 0) parts.push(`${kpi.leaveDays} ${kpi.leaveDays === 1 ? 'day' : 'days'} on leave`);
  return parts.join(' · ') || ' ';
}

function AttendanceCell({ kpi, notStarted }: { kpi: AttendanceKpi | undefined; notStarted: boolean }) {
  const cell = 'border-l border-slate-100 px-3 py-3.5 text-center align-middle';
  if (!kpi || !kpi.tracked || kpi.expectedDays === 0) {
    const note = !kpi ? '' : !kpi.tracked ? 'Not tracked' : notStarted ? 'Month has not started' : 'No working days yet';
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">–</div>
        <div className="text-[11.5px] text-slate-600">{note}</div>
      </td>
    );
  }
  const { present, onTime } = attendanceRates(kpi);
  const title = `Present ${kpi.presentDays} of ${kpi.expectedDays} working days, ${kpi.presentDays - kpi.lateDays} of ${kpi.presentDays} on time`;
  return (
    <td className={cell} title={title}>
      <div className="text-sm font-extrabold tabular-nums text-ink">
        {present}% <span className="text-[11.5px] font-medium text-slate-600">present</span>
      </div>
      <div className="mt-0.5 text-[13px] font-bold tabular-nums text-ink">
        {onTime == null ? '–' : `${onTime}%`} <span className="text-[11.5px] font-medium text-slate-600">on time</span>
      </div>
    </td>
  );
}

/** How many services this person performed in the month. A dash when no booking file covers the month (that is not
 * the same as 0: someone with nothing in a month the others have services in did perform none). */
function ServicesCell({ group, first, loading, counts, unread, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; counts: Map<string, number> | null; unread: boolean; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  if (loading || unread || !counts) {
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{loading ? 'Loading' : notStarted ? 'Month has not started' : unread ? UNREAD : group.emptyNote}</span>
        </div>
      </td>
    );
  }
  const n = counts.get(employeeId) ?? 0;
  return (
    <td className={cell} title={`${n} ${serviceWord(n)}`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">{n}</div>
    </td>
  );
}

/** Of the customers this person served in the month, the share who booked again, with the numbers under it. A dash says
 * why there is nothing to show (not imported, no customer names, no customers) for screen readers. */
function RebookingCell({ group, first, loading, byEmployee, reason, unread, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; byEmployee: Map<string, Rebooking> | null; reason: RebookingReason; unread: boolean; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  const r = byEmployee?.get(employeeId);
  const pct = r ? rebookingPct(r) : null;
  if (loading || notStarted || unread || reason || !r || pct == null) {
    const why = loading ? 'Loading' : notStarted ? 'Month has not started' : unread ? UNREAD : reason === 'nocodes' ? 'No customer names in the file' : reason === 'none' ? group.emptyNote : 'No customers';
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{why}</span>
        </div>
      </td>
    );
  }
  return (
    <td className={cell} title={`${r.back} of ${r.served} came back`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">{pct}%</div>
      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-600">
        {r.back} of {r.served}
      </div>
    </td>
  );
}

/** The share of the working day this person spent with customers, averaged over the days they worked, with the hours a day
 * under it. A dash says why there is nothing to show (not imported, no time in the file, no timed services). */
function UtilisationCell({ group, first, services, kpi, hoursPerDay, employeeId, notStarted }: { group: KpiGroup; first: boolean; services: ServiceMonth; kpi: AttendanceKpi | undefined; hoursPerDay: number; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  const u = services.time ? utilisation(services.time.get(employeeId), kpi?.tracked ? kpi.presentDays : null, hoursPerDay) : null;
  if (services.loading || notStarted || services.error || services.reason || !u) {
    const why = services.loading ? 'Loading' : notStarted ? 'Month has not started' : services.error ? UNREAD : services.reason === 'notime' ? 'No time in the file' : services.reason === 'none' ? group.emptyNote : 'No services with a time';
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{why}</span>
        </div>
      </td>
    );
  }
  return (
    <td className={cell} title={`${hoursText(u.avgHours)} hours a day with a customer, out of ${hoursText(u.hoursPerDay)}, over ${u.days} days worked`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">{u.pct}%</div>
      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-600">{hoursText(u.avgHours)} h a day</div>
    </td>
  );
}

/** The average service rating out of 5 from the customer forms, with how many forms under it. It shows from the first form. */
function FeedbackCell({ group, first, loading, byEmployee, unread, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; byEmployee: Map<string, FeedbackSummary> | null; unread: boolean; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  const state = feedbackState(byEmployee?.get(employeeId));
  if (loading || notStarted || unread || !byEmployee || state.kind === 'none') {
    const why = loading ? 'Loading' : notStarted ? 'Month has not started' : unread ? UNREAD : !byEmployee ? group.emptyNote : 'No forms';
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{why}</span>
        </div>
      </td>
    );
  }
  const s = state.summary;
  return (
    <td className={cell} title={`${averageText(s.average)} out of 5 from ${s.count} ${formWord(s.count)}`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">
        {averageText(s.average)} <span className="text-[11.5px] font-medium text-slate-600">/ 5</span>
      </div>
      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-600">
        {s.count} {formWord(s.count)}
      </div>
    </td>
  );
}

/** The NPS: the share who would recommend minus the share who are not likely to, from -100 to +100, with how many forms
 * under it. It shows from the first form. */
function NpsCell({ group, first, loading, nps, unread, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; nps: Map<string, NpsSummary> | null; unread: boolean; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  const state = npsState(nps?.get(employeeId));
  if (loading || notStarted || unread || !nps || state.kind === 'none') {
    const why = loading ? 'Loading' : notStarted ? 'Month has not started' : unread ? UNREAD : !nps ? group.emptyNote : 'No forms';
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{why}</span>
        </div>
      </td>
    );
  }
  const s = state.summary;
  return (
    <td className={cell} title={`NPS ${scoreText(s.score)} from ${s.count} ${formWord(s.count)}: ${s.promoters} would recommend, ${s.passives} neutral, ${s.detractors} not likely`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">{scoreText(s.score)}</div>
      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-600">
        {s.count} {formWord(s.count)}
      </div>
    </td>
  );
}

/** The average rating out of 5 a person got from one kind of colleague in the month, with how many reviews under it. It
 * shows from the first review. */
function ColleagueCell({ group, first, loading, bySubject, unread, kpiId, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; bySubject: Map<string, Roles> | null; unread: boolean; kpiId: keyof typeof RELATION_OF_KPI; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  const relation = RELATION_OF_KPI[kpiId];
  const state = roleState(bySubject?.get(employeeId)?.[relation]);
  if (loading || notStarted || unread || !bySubject || state.kind === 'none') {
    const why = loading ? 'Loading' : notStarted ? 'Month has not started' : unread ? UNREAD : !bySubject ? group.emptyNote : 'No feedback from them';
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{why}</span>
        </div>
      </td>
    );
  }
  return (
    <td className={cell} title={`Average of ${state.given} ${reviewWord(state.given)}`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">
        {averageText(state.average)} <span className="text-[11.5px] font-medium text-slate-600">/ 5</span>
      </div>
      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-600">
        {state.given} {reviewWord(state.given)}
      </div>
    </td>
  );
}

/** The number typed in for this person for a KPI of the company's own, as it was typed in. A dash when none was typed in
 * (for anyone, or only for this person: the hidden text says which). */
function OwnCell({ group, first, loading, values, unread, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; values: Map<string, number> | undefined; unread: boolean; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`;
  const n = values?.get(employeeId);
  if (loading || notStarted || unread || n == null) {
    const why = loading ? 'Loading' : notStarted ? 'Month has not started' : unread ? UNREAD : values && values.size > 0 ? 'Not typed in for this person' : group.emptyNote;
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{why}</span>
        </div>
      </td>
    );
  }
  return (
    <td className={cell} title={numberText(n)}>
      <div className="text-sm font-extrabold tabular-nums text-ink">{numberText(n)}</div>
    </td>
  );
}

function EmptyCell({ group, first }: { group: KpiGroup; first: boolean }) {
  return (
    <td className={`px-3 py-3.5 text-center align-middle ${first ? 'border-l border-slate-100' : ''}`}>
      <div className="text-[15px] font-bold text-slate-600">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{group.emptyNote}</span>
      </div>
    </td>
  );
}
