'use client';

import { useMemo, useState } from 'react';
import { usePageTitle } from '@/lib/pageTitle';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { otherCalendarSpan, visibleGroups, type KpiGroupId } from '@/lib/kpi';
import { isKpiOn, kpiLabel, type KpiId } from '@/lib/kpiSettings';
import { problemsOf } from '@/lib/kpiLoad';
import { COLLEAGUE_KPIS } from '@/lib/colleagueKpi';
import { weekBars } from '@/lib/serviceKpi';
import { addDays } from '@/lib/taskSchedule';
import { useEmployeeKpi } from '@/lib/useEmployeeKpi';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { useOwnKpis } from '@/lib/useOwnKpis';
import { usePersonOwn } from '@/lib/useOwnKpiValues';
import { usePersonTasks } from '@/lib/useTaskKpi';
import { usePersonFeedback } from '@/lib/useFeedbackKpi';
import { useMyColleagues, useMyEmployeeId, useMyRebooking } from '@/lib/useMyKpi';
import { PageBody } from '@/components/employee/parts';
import LoadProblems from '@/components/kpi/LoadProblems';
import MonthStepper from '@/components/kpi/MonthStepper';
import { AttendanceCard, CardModeProvider, ColleagueCard, FeedbackCard, NpsCard, OwnKpiCard, RebookingCard, ServicesCard, UtilisationCard } from '@/components/kpi/EmployeeKpiCards';
import KpiReportDialog from '@/components/kpi/KpiReports';
import type { ReportKind } from '@/lib/reportKpi';

// My KPIs: the person's own KPIs from the owner's sheet (and any the company added), each with the chart that suits it, next to last
// month's. It is the same numbers, worked out the same way, as the admin's page for this person, but it is read only, it talks to
// the person, and it only ever shows their own: nothing is added up, ranked or set against a colleague. What customers and
// colleagues said, and giving feedback, are on the Feedback page.
export default function MyKpisPage() {
  usePageTitle('My KPIs');
  const employeeId = useMyEmployeeId();
  if (employeeId === undefined) {
    return (
      <PageBody>
        <p className="m-0 text-sm text-slate-600">Loading…</p>
      </PageBody>
    );
  }
  if (employeeId === null) {
    return (
      <PageBody>
        <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm font-semibold text-slate-700 shadow-sm">
          Your account is not linked to an employee record, so there are no KPIs to show. Ask your admin to link it.
        </p>
      </PageBody>
    );
  }
  return (
    <PageBody>
      <MyKpis employeeId={employeeId} />
    </PageBody>
  );
}

function MyKpis({ employeeId }: { employeeId: string }) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(() => todayAnchor());

  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const previousAnchor = useMemo(() => stepAnchor(system, anchor, -1), [system, anchor]);
  const previous = useMemo(() => monthDateRange(system, previousAnchor), [system, previousAnchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  // "October" / "Kartik": the month's name without its year, for the "last month" line under a KPI.
  const previousName = useMemo(() => buildMonth(system, previousAnchor).label.split(' ')[0], [system, previousAnchor]);
  const monthName = label.split(' ')[0];
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  const { loading, error, notFound, current, previous: previousKpi, today } = useEmployeeKpi(employeeId, { start, end }, previous);
  const serviceData = usePersonTasks(employeeId, { start, end }, previous, start <= today);
  // A month that has not begun still gets its weeks on the chart, empty: pass a day after its end so none is left out.
  const bars = useMemo(() => weekBars(serviceData.dates, start, end, start > today ? addDays(end, 1) : today, system), [serviceData.dates, start, end, today, system]);

  // Which KPIs this company uses, what it calls them and the rules (set by the admin in KPIs > Settings), and the KPIs it added itself.
  const { settings, loaded } = useKpiSettings();
  const ownKpis = useOwnKpis();
  const groups = useMemo(() => visibleGroups(settings, ownKpis.kpis), [settings, ownKpis.kpis]);
  const ownIds = useMemo(() => ownKpis.inUse.map(k => k.id), [ownKpis.inUse]);
  const group = (id: KpiGroupId) => groups.find(g => g.id === id);
  const on = (id: KpiId) => isKpiOn(id, settings);
  const attendance = group('attendance');
  const services = group('services');
  const customers = group('customers');
  const colleagues = group('colleagues');
  const ownGroup = group('own');

  const feedbackData = usePersonFeedback(employeeId, { start, end }, previous, (on('feedback') || on('nps')) && start <= today);
  const colleagueData = useMyColleagues({ start, end }, previous, COLLEAGUE_KPIS.some(on) && start <= today);
  const ownData = usePersonOwn(employeeId, ownIds, { start, end }, previous, ownIds.length > 0 && start <= today);
  const rebookingData = useMyRebooking(employeeId, { start, end }, previous, on('rebooking') && start <= today);
  // Clicking a graph card opens the report behind it in a pop-up (components/kpi/KpiReports.tsx): only this person's own rows.
  const [report, setReport] = useState<ReportKind | null>(null);
  const mode = useMemo(() => ({ mine: true, feedbackHref: '/my-feedback', openReport: setReport }), []);

  if (notFound || error) {
    return (
      <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm font-semibold text-slate-700 shadow-sm">
        {error || 'Your employee record was not found.'}
      </p>
    );
  }

  const subtitle = [otherSpan, start <= today && today <= end ? 'month so far' : ''].filter(Boolean).join(' · ');

  return (
    <CardModeProvider value={mode}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <MonthStepper label={label} subtitle={subtitle} onPrevious={() => setAnchor(a => stepAnchor(system, a, -1))} onNext={() => setAnchor(a => stepAnchor(system, a, 1))} />
        </div>


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
      </div>

      {report && (
        <KpiReportDialog
          kind={report}
          onClose={() => setReport(null)}
          ctx={{ employeeId, start, end, monthLabel: label, personName: 'You', mine: true, today, attendance: current }}
        />
      )}
    </CardModeProvider>
  );
}
