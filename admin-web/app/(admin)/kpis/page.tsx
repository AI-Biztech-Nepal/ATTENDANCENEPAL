'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { problemsOf } from '@/lib/kpiLoad';
import { useOwnKpis } from '@/lib/useOwnKpis';
import { useOwnMonth } from '@/lib/useOwnKpiValues';
import KpiOverviewTable from '@/components/kpi/KpiOverviewTable';
import LoadProblems from '@/components/kpi/LoadProblems';
import MonthStepper from '@/components/kpi/MonthStepper';

// Every employee against every KPI for one month. Each KPI stands on its own: there is no total, no
// ranking and no weighting, and people are listed by name. Attendance is read from the attendance
// records; the other groups show a dash until their input exists (see KPI_GROUPS in lib/kpi.ts).
// A name opens that person's own KPI page (/kpis/[employeeId]) for the same month. The top bar's search box filters this list
// (?search=…) instead of going to the Employees directory.
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
  const router = useRouter();
  const searchTerm = (params.get('search') ?? '').trim();
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
  // The KPIs the company added itself (Settings > "Add your own KPI"), and the numbers typed in for them this month.
  const ownKpis = useOwnKpis();
  const groups = useMemo(() => visibleGroups(settings, ownKpis.kpis), [settings, ownKpis.kpis]);
  const ownIds = useMemo(() => ownKpis.inUse.map(k => k.id), [ownKpis.inUse]);
  const own = useOwnMonth(ownIds, start, end, ownIds.length > 0 && start <= today);
  const feedback = useFeedbackMonth(start, end, (isKpiOn('feedback', settings) || isKpiOn('nps', settings)) && start <= today);
  const colleagues = useColleagueMonth(start, end, COLLEAGUE_KPIS.some(id => isKpiOn(id, settings)) && start <= today);
  const rebooking = useRebooking(start, end, isKpiOn('rebooking', settings) && start <= today);

  const departments = useMemo(
    () => [...new Set(employees.map(e => e.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b)),
    [employees]
  );
  // A department that is not in the new month's list (or after a reload) is the same as "all".
  const activeDepartment = departments.includes(department) ? department : '';
  const shown = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return employees.filter(
      e =>
        (!activeDepartment || e.department === activeDepartment) &&
        (!term || [e.name, e.employee_code, e.department, e.designation, e.phone, e.email].some(v => !!v && v.toLowerCase().includes(term)))
    );
  }, [employees, activeDepartment, searchTerm]);

  function clearSearch() {
    const next = new URLSearchParams(params.toString());
    next.delete('search');
    const qs = next.toString();
    router.replace(qs ? `/kpis?${qs}` : '/kpis');
  }
  // A table that is missing or a refused read is said out loud, so a dash never hides a number that could not be read.
  const problems = problemsOf(services.error, rebooking.error, feedback.error, colleagues.error, ownKpis.error, own.error);

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
        {searchTerm && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label={`Clear the search for ${searchTerm}`}
            className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-xl border border-teal-700 bg-teal-50 px-3.5 text-sm font-bold text-teal-800 hover:bg-teal-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="truncate">“{searchTerm}”</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-4 w-4 shrink-0">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>


      {error && (
        <p role="alert" className="m-0 rounded-xl border border-critical/30 bg-critical-bg px-4 py-3 text-sm font-semibold text-critical-text">
          {error}
        </p>
      )}

      <LoadProblems problems={problems} />

      <KpiOverviewTable groups={groups} employees={shown} attendance={attendance} services={services} hoursPerDay={settings.hoursPerDay} rebooking={rebooking} feedback={feedback} colleagues={colleagues} own={own} loading={loading || !loaded || !ownKpis.loaded} notStarted={start > today} monthStart={start} emptyText={searchTerm ? `No employee matches “${searchTerm}”.` : undefined} />
    </div>
  );
}
