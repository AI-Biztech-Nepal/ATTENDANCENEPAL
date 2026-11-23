'use client';

import { Suspense, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { otherCalendarSpan, parseMonthParam, visibleGroups, type KpiGroupId } from '@/lib/kpi';
import { isKpiOn, kpiLabel, type KpiId } from '@/lib/kpiSettings';
import { useEmployeeKpi } from '@/lib/useEmployeeKpi';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { useMonthInUrl } from '@/lib/useMonthInUrl';
import { usePersonServices } from '@/lib/useServiceKpi';
import { weekBars } from '@/lib/serviceKpi';
import Avatar from '@/components/Avatar';
import MonthStepper from '@/components/kpi/MonthStepper';
import { AttendanceCard, ColleagueCard, PendingCard, ServicesCard } from '@/components/kpi/EmployeeKpiCards';

// One person's KPIs: the Overview section of their pages (the layout has the way back, their name and the other
// sections). It is opened by clicking a name on the KPI list, which also passes the month it was looking at
// (`?date=`). Only the
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

  useMonthInUrl(start);
  const { loading, error, notFound, employee, current, previous: previousKpi, today } = useEmployeeKpi(employeeId, { start, end }, previous);
  const serviceData = usePersonServices(employeeId, { start, end }, previous);
  const bars = useMemo(() => weekBars(serviceData.dates, start, end, today, system), [serviceData.dates, start, end, today, system]);
  // "November" / "Mangsir": the month's name without its year.
  const monthName = label.split(' ')[0];
  // Which KPIs this company uses, and what it calls them (KPIs > Settings).
  const { settings, loaded } = useKpiSettings();
  const groups = useMemo(() => visibleGroups(settings), [settings]);
  const group = (id: KpiGroupId) => groups.find(g => g.id === id);
  const on = (id: KpiId) => isKpiOn(id, settings);
  const customers = group('customers');
  const services = group('services');
  const colleagues = group('colleagues');
  const attendance = group('attendance');

  if (notFound || error) {
    return (
      <div className="flex flex-col gap-4">
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
        {attendance && (
          <AttendanceCard
            className="md:col-span-2"
            eyebrow={attendance.title}
            name={kpiLabel('attendance', settings)}
            current={current}
            previous={previousKpi}
            previousName={previousName}
            loading={loading || !loaded}
            notStarted={start > today}
          />
        )}
        {services && on('services') && (
          <ServicesCard
            className="md:col-span-2"
            eyebrow={services.title}
            name={kpiLabel('services', settings, 'Number of services performed')}
            data={serviceData}
            bars={bars}
            monthName={monthName}
            previousName={previousName}
            thisMonthSoFar={start <= today && today <= end}
            notStarted={start > today}
          />
        )}
        {services && on('rebooking') && <PendingCard group={services} name={kpiLabel('rebooking', settings)} ring />}
        {services && on('utilisation') && <PendingCard group={services} name={kpiLabel('utilisation', settings)} ring />}
        {customers && on('feedback') && <PendingCard group={customers} name={kpiLabel('feedback', settings)} />}
        {customers && on('nps') && <PendingCard group={customers} name={kpiLabel('nps', settings)} ring />}
        {colleagues && <ColleagueCard className="md:col-span-2 xl:col-span-4" group={colleagues} settings={settings} />}
      </div>

      <p className="m-0 text-[12.5px] text-slate-600">Each KPI stands on its own. Nothing is added up, ranked or compared.</p>
    </div>
  );
}
