import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import { buildMonth, monthDateRange, stepAnchor, type CalendarAnchor } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { otherCalendarSpan, visibleGroups, type KpiGroupId } from '../../lib/kpi';
import { isKpiOn, kpiLabel, type KpiId } from '../../lib/kpiSettings';
import { problemsOf } from '../../lib/kpiLoad';
import { COLLEAGUE_KPIS } from '../../lib/colleagueKpi';
import { weekBars } from '../../lib/serviceKpi';
import { addDays } from '../../lib/taskClock';
import type { ReportKind } from '../../lib/reportKpi';
import { useEmployeeKpi } from '../../lib/useEmployeeKpi';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { useOwnKpis } from '../../lib/useOwnKpis';
import { usePersonOwn } from '../../lib/useOwnKpiValues';
import { usePersonTasks } from '../../lib/useTaskKpi';
import { usePersonFeedback } from '../../lib/useFeedbackKpi';
import { usePersonColleagues } from '../../lib/useColleagueKpi';
import { usePersonRebooking } from '../../lib/useRebookingKpi';
import { useMyColleagues, useMyRebooking } from '../../lib/useMyKpi';
import { AttendanceCard, ColleagueCard, FeedbackCard, NpsCard, OwnKpiCard, RebookingCard, ServicesCard, UtilisationCard } from './KpiCards';
import { CardModeProvider, LoadProblems, Message, MonthStepper, SLATE } from './KpiUi';
import KpiReportDialog from './KpiReports';

/**
 * One person's KPIs, the cards of the owner's sheet each with the chart that suits it, next to the person's own last month. The employee's own
 * "My KPIs" (`mine`) and an admin's Overview section for one person are the same screen with a different voice and a different way to read
 * rows that belong to other people: the cards talk TO the person on their own, ABOUT them for an admin. Nothing is added up, ranked or set
 * against anyone else. Same as admin-web/app/(employee)/my-kpis/page.tsx and app/(admin)/kpis/[employeeId]/page.tsx.
 */
export default function PersonKpis({ employeeId, mine, anchor, onAnchor, openFeedback, typeInForm }: {
  employeeId: string;
  mine: boolean;
  /** The month on screen; the screen that owns it can keep the other sections on the same month. */
  anchor: CalendarAnchor;
  onAnchor: (anchor: CalendarAnchor) => void;
  /** "See your forms" / "See what colleagues said": goes to the Feedback section (employee only). */
  openFeedback?: () => void;
  /** "Type in a form": goes to the person's Customer feedback section (admin only). */
  typeInForm?: (monthStart: string) => void;
}) {
  const { system } = useCalendarSystem();
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const previousAnchor = useMemo(() => stepAnchor(system, anchor, -1), [system, anchor]);
  const previous = useMemo(() => monthDateRange(system, previousAnchor), [system, previousAnchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  // "October" / "Kartik": the month's name without its year, for the "last month" line under a KPI.
  const previousName = useMemo(() => buildMonth(system, previousAnchor).label.split(' ')[0], [system, previousAnchor]);
  const monthName = label.split(' ')[0];
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  const { loading, error, notFound, employee, current, previous: previousKpi, today } = useEmployeeKpi(employeeId, { start, end }, previous);
  const serviceData = usePersonTasks(employeeId, { start, end }, previous, start <= today);
  // A month that has not begun still gets its weeks on the chart, empty: pass a day after its end so none is left out.
  const bars = useMemo(() => weekBars(serviceData.dates, start, end, start > today ? addDays(end, 1) : today, system), [serviceData.dates, start, end, today, system]);

  // Which KPIs this company uses, what it calls them and the rules (KPIs > Settings), and the KPIs it added itself.
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

  const begun = start <= today;
  const feedbackData = usePersonFeedback(employeeId, { start, end }, previous, (on('feedback') || on('nps')) && begun);
  // An employee reads only their own rows, so what needs other people's rows comes through functions that hand over just what is needed.
  const wantColleagues = COLLEAGUE_KPIS.some(on) && begun;
  const colleaguesAdmin = usePersonColleagues(employeeId, { start, end }, previous, wantColleagues && !mine);
  const colleaguesMine = useMyColleagues({ start, end }, previous, wantColleagues && mine);
  const colleagueData = mine ? colleaguesMine : colleaguesAdmin;
  const ownData = usePersonOwn(employeeId, ownIds, { start, end }, previous, ownIds.length > 0 && begun);
  const rebookingAdmin = usePersonRebooking(employeeId, { start, end }, previous, on('rebooking') && begun && !mine);
  const rebookingMine = useMyRebooking(employeeId, { start, end }, previous, on('rebooking') && begun && mine);
  const rebookingData = mine ? rebookingMine : rebookingAdmin;

  // Tapping a graph card opens the report behind it in a pop-up (KpiReports.tsx): only this person's own rows on their own screen.
  const [report, setReport] = useState<ReportKind | null>(null);
  const mode = useMemo(
    () => ({ mine, openReport: setReport, openFeedback: mine ? openFeedback : undefined, typeInForm: !mine && typeInForm ? () => typeInForm(start) : undefined }),
    [mine, openFeedback, typeInForm, start]
  );

  if (notFound || error) return <Message title={error || (mine ? 'Your employee record was not found.' : 'That employee was not found.')} />;

  const subtitle = [otherSpan, begun && today <= end ? 'month so far' : ''].filter(Boolean).join(' · ');
  const role = employee ? [employee.department, employee.designation].filter(Boolean).join(' · ') : '';
  const notStarted = start > today;

  return (
    <CardModeProvider value={mode}>
      <View style={{ gap: 14 }}>
        {!mine && (
          <View accessibilityLabel="Employee" style={s.person}>
            <Text style={s.personName}>{employee ? employee.name : 'Loading…'}</Text>
            {role ? <Text style={s.personRole}>{role}</Text> : null}
          </View>
        )}
        <MonthStepper label={label} subtitle={subtitle} onPrevious={() => onAnchor(stepAnchor(system, anchor, -1))} onNext={() => onAnchor(stepAnchor(system, anchor, 1))} />

        {/* A table that is missing or a refused read is said out loud, so a dash never hides a number that could not be read. */}
        <LoadProblems problems={problemsOf(serviceData.error, rebookingData.error, feedbackData.error, colleagueData.error, ownKpis.error, ownData.error)} />

        {attendance && (
          <AttendanceCard
            eyebrow={attendance.title}
            name={kpiLabel('attendance', settings)}
            current={current}
            previous={previousKpi}
            previousName={previousName}
            loading={loading || !loaded}
            notStarted={notStarted}
          />
        )}
        {services && on('services') && (
          <ServicesCard
            eyebrow={services.title}
            name={kpiLabel('services', settings, 'Number of services performed')}
            data={serviceData}
            bars={bars}
            monthName={monthName}
            previousName={previousName}
            thisMonthSoFar={begun && today <= end}
            notStarted={notStarted}
          />
        )}
        {services && on('rebooking') && (
          <RebookingCard
            eyebrow={services.title}
            name={kpiLabel('rebooking', settings)}
            data={loaded ? rebookingData : { ...rebookingData, loading: true }}
            monthName={monthName}
            previousName={previousName}
            notStarted={notStarted}
          />
        )}
        {services && on('utilisation') && (
          <UtilisationCard eyebrow={services.title} name={kpiLabel('utilisation', settings)} data={serviceData} monthName={monthName} previousName={previousName} notStarted={notStarted} />
        )}
        {customers && on('feedback') && (
          <FeedbackCard
            eyebrow={customers.title}
            name={kpiLabel('feedback', settings)}
            data={loaded ? feedbackData : { ...feedbackData, loading: true }}
            monthName={monthName}
            previousName={previousName}
            notStarted={notStarted}
          />
        )}
        {customers && on('nps') && (
          <NpsCard eyebrow={customers.title} name={kpiLabel('nps', settings)} data={loaded ? feedbackData : { ...feedbackData, loading: true }} monthName={monthName} previousName={previousName} notStarted={notStarted} />
        )}
        {colleagues && <ColleagueCard group={colleagues} settings={settings} data={colleagueData} previousName={previousName} notStarted={notStarted} />}
        {ownGroup &&
          ownKpis.inUse.map(k => (
            <OwnKpiCard
              key={k.id}
              eyebrow={ownGroup.title}
              name={k.name}
              data={{ loading: ownData.loading, current: ownData.byKpi.get(k.id)?.current ?? null, previous: ownData.byKpi.get(k.id)?.previous ?? null, error: ownData.error }}
              monthName={monthName}
              previousName={previousName}
              notStarted={notStarted}
            />
          ))}
      </View>

      {report && (employee || mine) && (
        <KpiReportDialog
          kind={report}
          onClose={() => setReport(null)}
          ctx={{ employeeId, start, end, monthLabel: label, personName: mine ? 'You' : employee?.name ?? '', mine, today, attendance: current }}
        />
      )}
    </CardModeProvider>
  );
}

const s = StyleSheet.create({
  person: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: 16, paddingVertical: 14 },
  personName: { fontSize: 20, fontWeight: '800', color: colors.ink },
  personRole: { fontSize: 13, color: SLATE[600], marginTop: 2 },
});
