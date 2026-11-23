'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePageTitle } from '@/lib/pageTitle';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { otherCalendarSpan, parseMonthParam, visibleGroups } from '@/lib/kpi';
import { useKpiOverview } from '@/lib/useKpiOverview';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { useServiceMonth } from '@/lib/useServiceKpi';
import { useRebooking } from '@/lib/useRebookingKpi';
import { useFeedbackMonth } from '@/lib/useFeedbackKpi';
import { useColleagueMonth } from '@/lib/useColleagueKpi';
import { COLLEAGUE_KPIS } from '@/lib/colleagueKpi';
import { isKpiOn } from '@/lib/kpiSettings';
import KpiOverviewTable from '@/components/kpi/KpiOverviewTable';
import MonthStepper from '@/components/kpi/MonthStepper';

// Every employee against every KPI for one month. Each KPI stands on its own: there is no total, no
// ranking and no weighting, and people are listed by name. Attendance is read from the attendance
// records; the other groups show a dash until their input exists (see KPI_GROUPS in lib/kpi.ts).
// A name opens that person's own KPI page (/kpis/[employeeId]) for the same month.
export default function KpisPage() {
  // useSearchParams needs a Suspense boundary, like the other pages that read the address.
  return (
    <Suspense fallback={null}>
      <Kpis />
    </Suspense>
  );
}

function Kpis() {
  usePageTitle('KPIs');
  const { system } = useCalendarSystem();
  const params = useSearchParams();
  // The month is an AD anchor, so switching AD/BS keeps the same point in time and re-reads it as
  // whichever calendar's month it falls in (the same approach as the Attendance Calendar). It starts on
  // the month a person's page came from (`?date=`), so "All employees' KPIs" returns to the same month.
  const [anchor, setAnchor] = useState(() => parseMonthParam(params.get('date')) ?? todayAnchor());
  const [department, setDepartment] = useState('');

  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);
  const thisMonth = useMemo(() => monthDateRange(system, todayAnchor()), [system]);
  const isThisMonth = thisMonth.start === start;

  const { loading, error, employees, attendance, today } = useKpiOverview(start, end);
  const services = useServiceMonth(start, end, start <= today);
  // Which KPIs this company uses, and what it calls them (KPIs > Settings).
  const { settings, loaded } = useKpiSettings();
  const groups = useMemo(() => visibleGroups(settings), [settings]);
  const feedback = useFeedbackMonth(start, end, (isKpiOn('feedback', settings) || isKpiOn('nps', settings)) && start <= today);
  const colleagues = useColleagueMonth(start, end, COLLEAGUE_KPIS.some(id => isKpiOn(id, settings)) && start <= today);
  // Rebooking waits for the settings, because the "back within N days" setting decides who counts.
  const rebooking = useRebooking(start, end, settings.repeatDays, loaded && isKpiOn('rebooking', settings) && start <= today);

  const departments = useMemo(
    () => [...new Set(employees.map(e => e.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b)),
    [employees]
  );
  // A department that is not in the new month's list (or after a reload) is the same as "all".
  const activeDepartment = departments.includes(department) ? department : '';
  const shown = useMemo(() => (activeDepartment ? employees.filter(e => e.department === activeDepartment) : employees), [employees, activeDepartment]);
  const waiting = groups.filter(g => !g.connected);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthStepper
          label={label}
          subtitle={otherSpan}
          onPrevious={() => setAnchor(a => stepAnchor(system, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(system, a, 1))}
        />
        {!isThisMonth && (
          <button
            type="button"
            onClick={() => setAnchor(todayAnchor())}
            className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            This month
          </button>
        )}
        <select
          aria-label="Department"
          value={activeDepartment}
          onChange={e => setDepartment(e.target.value)}
          className="h-11 rounded-xl border border-slate-300 bg-white px-3.5 pr-9 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="">All departments</option>
          {departments.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <p className="m-0 text-[13px] leading-relaxed text-slate-600">
        Listed by name. Each KPI stands on its own: nothing is added up, ranked or compared. A dash means there is nothing to show yet.
      </p>

      {error && (
        <p role="alert" className="m-0 rounded-xl border border-critical/30 bg-critical-bg px-4 py-3 text-sm font-semibold text-critical-text">
          {error}
        </p>
      )}

      <KpiOverviewTable groups={groups} employees={shown} attendance={attendance} services={services} hoursPerDay={settings.hoursPerDay} rebooking={rebooking} windowDays={settings.repeatDays} feedback={feedback} minForms={settings.minResponses} colleagues={colleagues} loading={loading || !loaded} notStarted={start > today} monthStart={start} />

      {waiting.length > 0 && (
        <section aria-labelledby="not-connected" className="rounded-xl border border-slate-200 bg-white px-6 pb-2 pt-5 shadow-sm">
          <h2 id="not-connected" className="m-0 mb-1.5 text-base font-extrabold text-ink">
            Not connected yet
          </h2>
          {waiting.map(g => (
            <div key={g.id} className="border-t border-slate-200 py-3.5">
              <div className="text-sm font-bold text-ink">{g.title}</div>
              <div className="mt-0.5 text-[13px] text-slate-600">{g.waiting}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
