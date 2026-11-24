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
import { usePersonRebooking } from '@/lib/useRebookingKpi';
import { usePersonFeedback } from '@/lib/useFeedbackKpi';
import { usePersonColleagues } from '@/lib/useColleagueKpi';
import { COLLEAGUE_KPIS } from '@/lib/colleagueKpi';
import { weekBars } from '@/lib/serviceKpi';
import { addDays } from '@/lib/taskSchedule';
import { problemsOf } from '@/lib/kpiLoad';
import { useOwnKpis } from '@/lib/useOwnKpis';
import { usePersonOwn } from '@/lib/useOwnKpiValues';
import Avatar from '@/components/Avatar';
import LoadProblems from '@/components/kpi/LoadProblems';
import MonthStepper from '@/components/kpi/MonthStepper';
import { AttendanceCard, ColleagueCard, FeedbackCard, NpsCard, OwnKpiCard, RebookingCard, ServicesCard, UtilisationCard } from '@/components/kpi/EmployeeKpiCards';

// One person's KPIs: the Overview section of their pages (the layout has the way back, their name and the other
// sections). It is opened by clicking a name on the KPI list, which also passes the month it was looking at
// (`?date=`). Only the
// KPIs from the owner's sheet are here, each with the chart that suits it, and nothing is added up or
// ranked. Each card compares the person with their own last month, never with another person.
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
  const serviceData = usePersonServices(employeeId, { start, end }, previous, start <= today);
  // A month that has not begun still gets its weeks on the chart, empty: pass a day after its end so none is left out.
  const bars = useMemo(() => weekBars(serviceData.dates, start, end, start > today ? addDays(end, 1) : today, system), [serviceData.dates, start, end, today, system]);
  // "November" / "Mangsir": the month's name without its year.
  const monthName = label.split(' ')[0];
  // Which KPIs this company uses, and what it calls them (KPIs > Settings).
  const { settings, loaded } = useKpiSettings();
  // The KPIs the company added itself (Settings > "Add your own KPI"): one card each, with this person's typed-in number.
  const ownKpis = useOwnKpis();
  const groups = useMemo(() => visibleGroups(settings, ownKpis.kpis), [settings, ownKpis.kpis]);
  const ownIds = useMemo(() => ownKpis.inUse.map(k => k.id), [ownKpis.inUse]);
  const group = (id: KpiGroupId) => groups.find(g => g.id === id);
  const on = (id: KpiId) => isKpiOn(id, settings);
  const customers = group('customers');
  const services = group('services');
  const colleagues = group('colleagues');
  const ownGroup = group('own');
  const attendance = group('attendance');
  const feedbackData = usePersonFeedback(employeeId, { start, end }, previous, (on('feedback') || on('nps')) && start <= today);
  const colleagueData = usePersonColleagues(employeeId, { start, end }, previous, COLLEAGUE_KPIS.some(on) && start <= today);
  const ownData = usePersonOwn(employeeId, ownIds, { start, end }, previous, ownIds.length > 0 && start <= today);
  const rebookingData = usePersonRebooking(employeeId, { start, end }, previous, settings.repeatDays, loaded && on('rebooking') && start <= today);

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

      {/* A table that is missing or a refused read is said out loud, so a dash never hides a number that could not be read. */}
      <LoadProblems problems={problemsOf(serviceData.error, rebookingData.error, feedbackData.error, colleagueData.error, ownKpis.error, ownData.error)} />

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
        {services && on('rebooking') && (
          <RebookingCard
            eyebrow={services.title}
            name={kpiLabel('rebooking', settings)}
            data={loaded ? rebookingData : { ...rebookingData, loading: true }}
            windowDays={settings.repeatDays}
            monthName={monthName}
            previousName={previousName}
            notStarted={start > today}
          />
        )}
        {services && on('utilisation') && (
          <UtilisationCard
            eyebrow={services.title}
            name={kpiLabel('utilisation', settings)}
            data={serviceData}
            presentDays={current?.tracked ? current.presentDays : null}
            previousPresentDays={previousKpi?.tracked ? previousKpi.presentDays : null}
            attendanceLoading={loading || !loaded}
            hoursPerDay={settings.hoursPerDay}
            monthName={monthName}
            previousName={previousName}
            notStarted={start > today}
          />
        )}
        {customers && on('feedback') && (
          <FeedbackCard
            eyebrow={customers.title}
            name={kpiLabel('feedback', settings)}
            data={loaded ? feedbackData : { ...feedbackData, loading: true }}
            monthName={monthName}
            previousName={previousName}
            notStarted={start > today}
            typeInHref={`/kpis/${employeeId}/feedback?date=${start}`}
          />
        )}
        {customers && on('nps') && (
          <NpsCard
            eyebrow={customers.title}
            name={kpiLabel('nps', settings)}
            data={loaded ? feedbackData : { ...feedbackData, loading: true }}
            monthName={monthName}
            previousName={previousName}
            notStarted={start > today}
          />
        )}
        {colleagues && (
          <ColleagueCard className="md:col-span-2 xl:col-span-4" group={colleagues} settings={settings} data={colleagueData} previousName={previousName} notStarted={start > today} />
        )}
        {ownGroup &&
          ownKpis.inUse.map(k => (
            <OwnKpiCard
              key={k.id}
              eyebrow={ownGroup.title}
              name={k.name}
              data={{ loading: ownData.loading, current: ownData.byKpi.get(k.id)?.current ?? null, previous: ownData.byKpi.get(k.id)?.previous ?? null, error: ownData.error }}
              monthName={monthName}
              previousName={previousName}
              notStarted={start > today}
            />
          ))}
      </div>

      <p className="m-0 text-[12.5px] text-slate-600">Each KPI stands on its own. Nothing is added up or ranked, and no one is compared with anyone else, only with their own last month.</p>
    </div>
  );
}
