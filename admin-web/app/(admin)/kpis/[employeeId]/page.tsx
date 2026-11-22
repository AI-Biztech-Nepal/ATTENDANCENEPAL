'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { usePageTitle } from '@/lib/pageTitle';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { otherCalendarSpan, parseMonthParam } from '@/lib/kpi';
import { useEmployeeKpi } from '@/lib/useEmployeeKpi';
import Avatar from '@/components/Avatar';
import MonthStepper from '@/components/kpi/MonthStepper';
import { AttendanceCard, ColleagueCard, PendingCard } from '@/components/kpi/EmployeeKpiCards';

// One person's KPIs, on a page of their own (not part of the employee directory). It is opened by
// clicking a name on the KPI list, which also passes the month it was looking at (`?date=`). Only the
// KPIs from the owner's sheet are here, each with the chart that suits it, and nothing is added up,
// ranked or compared. Attendance is real; the other cards wait for their input (see KPI_GROUPS).
export default function EmployeeKpiPage() {
  // useSearchParams needs a Suspense boundary, like the other pages that read the address.
  return (
    <Suspense fallback={null}>
      <EmployeeKpi />
    </Suspense>
  );
}

function EmployeeKpi() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(() => parseMonthParam(params.get('date')) ?? todayAnchor());

  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const previousAnchor = useMemo(() => stepAnchor(system, anchor, -1), [system, anchor]);
  const previous = useMemo(() => monthDateRange(system, previousAnchor), [system, previousAnchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  // "October" / "Kartik": the month's name without its year, for the "last month" line under a KPI.
  const previousName = useMemo(() => buildMonth(system, previousAnchor).label.split(' ')[0], [system, previousAnchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  const { loading, error, notFound, employee, current, previous: previousKpi, today } = useEmployeeKpi(employeeId, { start, end }, previous);
  // "KPIs" above the name once it is known; until then just "KPIs", not the same word twice.
  usePageTitle(employee ? employee.name : 'KPIs', employee ? 'KPIs' : '');

  const backHref = `/kpis?date=${start}`;
  const back = (
    <Link href={backHref} className="inline-flex items-center gap-1.5 self-start text-[13px] font-extrabold text-accent hover:underline">
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 6-6 6 6 6" />
      </svg>
      All employees&apos; KPIs
    </Link>
  );

  if (notFound || error) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm font-semibold text-slate-700 shadow-sm">
          {error || 'That employee was not found.'}
        </p>
      </div>
    );
  }

  const subtitle = [otherSpan, start <= today && today <= end ? 'month so far' : ''].filter(Boolean).join(' · ');
  const role = employee ? [employee.department, employee.designation].filter(Boolean).join(' · ') : '';

  return (
    <div className="flex flex-col gap-4">
      {back}

      <section aria-label="Employee and month" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          {employee ? <Avatar name={employee.name} photoUrl={employee.profile_photo_url} className="h-14 w-14 text-xl" /> : <div className="h-14 w-14 rounded-full bg-slate-100" />}
          <div>
            <div className="text-xl font-extrabold text-ink">{employee ? employee.name : 'Loading…'}</div>
            {role && <div className="mt-0.5 text-[13px] text-slate-600">{role}</div>}
          </div>
        </div>
        <MonthStepper
          label={label}
          subtitle={subtitle}
          onPrevious={() => setAnchor(a => stepAnchor(system, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(system, a, 1))}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AttendanceCard
          className="md:col-span-2"
          current={current}
          previous={previousKpi}
          previousName={previousName}
          loading={loading}
          notStarted={start > today}
        />
        <PendingCard className="md:col-span-2" groupId="services" name="Number of services performed" />
        <PendingCard groupId="services" name="Rebooking rate" ring />
        <PendingCard groupId="services" name="Hour utilisation per day" ring />
        <PendingCard groupId="customers" name="Customer feedback" />
        <PendingCard groupId="customers" name="NPS" ring />
        <ColleagueCard className="md:col-span-2 xl:col-span-4" />
      </div>

      <p className="m-0 text-[12.5px] text-slate-600">Each KPI stands on its own. Nothing is added up, ranked or compared.</p>
    </div>
  );
}
