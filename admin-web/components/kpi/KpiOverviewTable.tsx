'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { attendanceRates, type AttendanceKpi, type KpiGroup } from '@/lib/kpi';
import { serviceWord } from '@/lib/serviceKpi';
import { rebookingPct, type Rebooking } from '@/lib/rebookingKpi';
import type { RebookingReason } from '@/lib/useRebookingKpi';
import type { Employee } from '@/lib/types';

type Props = {
  /** The KPI groups to show, as this company set them up (see visibleGroups). */
  groups: KpiGroup[];
  employees: Employee[];
  attendance: Map<string, AttendanceKpi>;
  /** Services performed in the month, per person. `counts` is null when no booking file covers the month. */
  services: { loading: boolean; counts: Map<string, number> | null };
  /** Rebooking per person: of the customers served, how many booked again within `windowDays`. */
  rebooking: { loading: boolean; byEmployee: Map<string, Rebooking> | null; reason: RebookingReason };
  windowDays: number;
  loading: boolean;
  /** The month being shown has not begun, so there is nothing to count yet. */
  notStarted: boolean;
  /** The month's first day (AD), sent along so a person's page opens on the same month. */
  monthStart: string;
};

/** One row per person, the KPIs across (a line between the groups of KPIs that come from the same place; the
 * groups themselves are named in the "Not connected yet" card under the table). Nothing is added up or
 * compared: a dash means there is nothing to show yet. */
export default function KpiOverviewTable({ groups, employees, attendance, services, rebooking, windowDays, loading, notStarted, monthStart }: Props) {
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
                className="w-[210px] bg-slate-50 px-5 py-3.5 align-bottom md:sticky md:left-0 md:z-10 text-xs font-extrabold uppercase tracking-wider text-slate-600"
              >
                Employee
              </th>
              {groups.flatMap(g =>
                g.columns.map((c, i) => (
                  <th
                    key={c.id}
                    scope="col"
                    style={{ width: c.width }}
                    className={`px-3 py-3.5 align-bottom text-xs font-bold text-slate-700 ${i === 0 ? 'border-l border-slate-200' : ''}`}
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
                  No employees to show.
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
                          <ServicesCell key={c.id} group={g} first={i === 0} loading={services.loading} counts={services.counts} employeeId={emp.id} notStarted={notStarted} />
                        ) : c.id === 'rebooking' ? (
                          <RebookingCell key={c.id} group={g} first={i === 0} loading={rebooking.loading} byEmployee={rebooking.byEmployee} reason={rebooking.reason} employeeId={emp.id} notStarted={notStarted} windowDays={windowDays} />
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
      <p className="m-0 border-t border-slate-200 bg-slate-50 px-5 py-3 text-[12.5px] leading-relaxed text-slate-600">
        Click a name to open that person&apos;s KPIs. Attendance counts the working days so far: week-offs, holidays and approved leave are left out.
      </p>
    </section>
  );
}

function subtitle(emp: Employee, kpi: AttendanceKpi | undefined) {
  const parts: string[] = [];
  if (emp.department) parts.push(emp.department);
  if (kpi && !kpi.tracked) parts.push('Excused from attendance');
  else if (kpi && kpi.leaveDays > 0) parts.push(`${kpi.leaveDays} ${kpi.leaveDays === 1 ? 'day' : 'days'} on leave`);
  return parts.join(' · ') || ' ';
}

function AttendanceCell({ kpi, notStarted }: { kpi: AttendanceKpi | undefined; notStarted: boolean }) {
  const cell = 'border-l border-slate-100 px-3 py-3.5';
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
function ServicesCell({ group, first, loading, counts, employeeId, notStarted }: { group: KpiGroup; first: boolean; loading: boolean; counts: Map<string, number> | null; employeeId: string; notStarted: boolean }) {
  const cell = `px-3 py-3.5 ${first ? 'border-l border-slate-100' : ''}`;
  if (loading || !counts) {
    return (
      <td className={cell}>
        <div className="text-[15px] font-bold text-slate-600">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{loading ? 'Loading' : notStarted ? 'Month has not started' : group.emptyNote}</span>
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
 * why there is nothing to show (not imported, no customer codes, no customers) for screen readers. */
function RebookingCell({ group, first, loading, byEmployee, reason, employeeId, notStarted, windowDays }: { group: KpiGroup; first: boolean; loading: boolean; byEmployee: Map<string, Rebooking> | null; reason: RebookingReason; employeeId: string; notStarted: boolean; windowDays: number }) {
  const cell = `px-3 py-3.5 ${first ? 'border-l border-slate-100' : ''}`;
  const r = byEmployee?.get(employeeId);
  const pct = r ? rebookingPct(r) : null;
  if (loading || notStarted || reason || !r || pct == null) {
    const why = loading ? 'Loading' : notStarted ? 'Month has not started' : reason === 'nocodes' ? 'No customer codes' : reason === 'none' ? group.emptyNote : 'No customers';
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
    <td className={cell} title={`${r.back} of ${r.served} booked again within ${windowDays} days`}>
      <div className="text-sm font-extrabold tabular-nums text-ink">{pct}%</div>
      <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-600">
        {r.back} of {r.served}
      </div>
    </td>
  );
}

function EmptyCell({ group, first }: { group: KpiGroup; first: boolean }) {
  return (
    <td className={`px-3 py-3.5 ${first ? 'border-l border-slate-100' : ''}`}>
      <div className="text-[15px] font-bold text-slate-600">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{group.emptyNote}</span>
      </div>
    </td>
  );
}
