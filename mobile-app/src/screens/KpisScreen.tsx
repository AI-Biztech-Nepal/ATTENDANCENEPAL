import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { attendanceRates, otherCalendarSpan, visibleGroups, type AttendanceKpi, type KpiGroup } from '../lib/kpi';
import { isKpiOn } from '../lib/kpiSettings';
import { problemsOf } from '../lib/kpiLoad';
import { serviceWord } from '../lib/serviceKpi';
import { rebookingPct } from '../lib/rebookingKpi';
import { utilisationPct } from '../lib/taskKpi';
import { averageText, feedbackState, formWord } from '../lib/feedbackKpi';
import { npsState, scoreText } from '../lib/npsKpi';
import { RELATION_OF_KPI, reviewWord, roleState, COLLEAGUE_KPIS } from '../lib/colleagueKpi';
import { isOwnColumn, numberText, ownIdOf } from '../lib/ownKpi';
import { useKpiOverview } from '../lib/useKpiOverview';
import { useKpiSettings } from '../lib/useKpiSettings';
import { useTaskMonth } from '../lib/useTaskKpi';
import { useRebooking } from '../lib/useRebookingKpi';
import { useFeedbackMonth } from '../lib/useFeedbackKpi';
import { useColleagueMonth } from '../lib/useColleagueKpi';
import { useOwnKpis } from '../lib/useOwnKpis';
import { useOwnMonth } from '../lib/useOwnKpiValues';
import type { Employee } from '../types';
import { LoadProblems, Message, MonthStepper, Page, SLATE } from '../components/kpi/KpiUi';
import { PickerField } from '../components/kpi/FormParts';

/**
 * Every employee against every KPI for one month, an admin's or HR's view: one card per person, the KPIs of the owner's sheet down it. Each KPI
 * stands on its own: there is no total, no ranking and no weighting, and people are listed by name. A dash means there is nothing to show yet,
 * or its numbers could not be read (the note above the list says so in that case). A card opens that person's own KPI screen for the same
 * month. Same as admin-web/app/(admin)/kpis/page.tsx (the table there is cards here, because a phone has no room for a wide table).
 */
export default function KpisScreen({ navigation }: any) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(() => todayAnchor());
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');

  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  const { loading, error, employees, attendance, today } = useKpiOverview(start, end);
  const tasks = useTaskMonth(start, end, start <= today);
  // Which KPIs this company uses, and what it calls them (KPIs > Settings), and the KPIs it added itself.
  const { settings, loaded } = useKpiSettings();
  const ownKpis = useOwnKpis();
  const groups = useMemo(() => visibleGroups(settings, ownKpis.kpis), [settings, ownKpis.kpis]);
  const ownIds = useMemo(() => ownKpis.inUse.map(k => k.id), [ownKpis.inUse]);
  const begun = start <= today;
  const own = useOwnMonth(ownIds, start, end, ownIds.length > 0 && begun);
  const feedback = useFeedbackMonth(start, end, (isKpiOn('feedback', settings) || isKpiOn('nps', settings)) && begun);
  const colleagues = useColleagueMonth(start, end, COLLEAGUE_KPIS.some(id => isKpiOn(id, settings)) && begun);
  const rebooking = useRebooking(start, end, isKpiOn('rebooking', settings) && begun);

  const departments = useMemo(() => [...new Set(employees.map(e => e.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b)), [employees]);
  // A department that is not in the new month's list is the same as "all".
  const activeDepartment = departments.includes(department) ? department : '';
  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () => employees.filter(e => (!activeDepartment || e.department === activeDepartment) && (!term || [e.name, e.employee_code, e.department, e.designation, e.phone, e.email].some(v => !!v && v.toLowerCase().includes(term)))),
    [employees, activeDepartment, term]
  );

  const problems = problemsOf(tasks.error, rebooking.error, feedback.error, colleagues.error, ownKpis.error, own.error);
  const notStarted = start > today;
  const busy = loading || !loaded || !ownKpis.loaded;

  // One KPI's value for one person: the big line, and a small line under it. `null` is a dash.
  function value(columnId: string, emp: Employee, kpi: AttendanceKpi | undefined): { big: string; small?: string } | null {
    if (busy || notStarted) return null;
    switch (columnId) {
      case 'attendance': {
        if (!kpi || !kpi.tracked || kpi.expectedDays === 0) return null;
        const { present, onTime } = attendanceRates(kpi);
        return { big: `${present}% present`, small: `${onTime == null ? '–' : `${onTime}%`} on time` };
      }
      case 'services': {
        if (tasks.loading || tasks.error || !tasks.byEmployee) return null;
        const n = tasks.byEmployee.get(emp.id)?.done ?? 0;
        return { big: String(n), small: serviceWord(n) };
      }
      case 'utilisation': {
        const c = tasks.byEmployee?.get(emp.id);
        const pct = utilisationPct(c);
        if (tasks.loading || tasks.error || !c || pct == null) return null;
        return { big: `${pct}%`, small: `${c.done} of ${c.assigned}` };
      }
      case 'rebooking': {
        const r = rebooking.byEmployee?.get(emp.id);
        const pct = r ? rebookingPct(r) : null;
        if (rebooking.loading || rebooking.error || rebooking.reason || !r || pct == null) return null;
        return { big: `${pct}%`, small: `${r.back} of ${r.served}` };
      }
      case 'feedback': {
        const st = feedbackState(feedback.byEmployee?.get(emp.id));
        if (feedback.loading || feedback.error || !feedback.byEmployee || st.kind === 'none') return null;
        return { big: `${averageText(st.summary.average)} / 5`, small: `${st.summary.count} ${formWord(st.summary.count)}` };
      }
      case 'nps': {
        const st = npsState(feedback.nps?.get(emp.id));
        if (feedback.loading || feedback.error || !feedback.nps || st.kind === 'none') return null;
        return { big: scoreText(st.summary.score), small: `${st.summary.count} ${formWord(st.summary.count)}` };
      }
      case 'peers':
      case 'manager':
      case 'clevel':
      case 'training': {
        const st = roleState(colleagues.bySubject?.get(emp.id)?.[RELATION_OF_KPI[columnId]]);
        if (colleagues.loading || colleagues.error || !colleagues.bySubject || st.kind === 'none') return null;
        return { big: `${averageText(st.average)} / 5`, small: `${st.given} ${reviewWord(st.given)}` };
      }
      default: {
        if (!isOwnColumn(columnId)) return null;
        const n = own.byKpi.get(ownIdOf(columnId))?.get(emp.id);
        if (own.loading || own.error || n == null) return null;
        return { big: numberText(n) };
      }
    }
  }

  return (
    <Page>
      <MonthStepper label={label} subtitle={otherSpan} onPrevious={() => setAnchor(a => stepAnchor(system, a, -1))} onNext={() => setAnchor(a => stepAnchor(system, a, 1))} />
      {start !== monthDateRange(system, todayAnchor()).start ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="This month" onPress={() => setAnchor(todayAnchor())} style={s.thisMonth}>
          <Text style={s.thisMonthText}>This month</Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ gap: 10 }}>
        <TextInput
          accessibilityLabel="Search employees"
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name"
          placeholderTextColor={colors.slate400}
          autoCapitalize="none"
          autoCorrect={false}
          style={s.search}
        />
        {departments.length > 0 ? (
          <PickerField label="Department" title="Department" value={activeDepartment} placeholder="All departments" options={[{ id: '', label: 'All departments' }, ...departments.map(d => ({ id: d, label: d }))]} onChange={setDepartment} />
        ) : null}
      </View>

      {error ? <Message title={error} /> : null}
      <LoadProblems problems={problems} />

      {busy ? (
        <Text style={s.state}>Loading…</Text>
      ) : shown.length === 0 ? (
        <Text style={s.state}>{term ? `No employee matches “${search.trim()}”.` : 'No employees to show.'}</Text>
      ) : (
        shown.map(emp => {
          const kpi = attendance.get(emp.id);
          return (
            <TouchableOpacity
              key={emp.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${emp.name}'s KPIs`}
              onPress={() => navigation.navigate('KpiPerson', { employeeId: emp.id, start })}
              style={s.card}
            >
              <Text style={s.name}>{emp.name}</Text>
              <Text style={s.sub}>{subtitle(emp, kpi)}</Text>
              {groups.map(g => (
                <GroupRows key={g.id} group={g} emp={emp} kpi={kpi} value={value} />
              ))}
            </TouchableOpacity>
          );
        })
      )}
    </Page>
  );
}

function GroupRows({ group, emp, kpi, value }: { group: KpiGroup; emp: Employee; kpi: AttendanceKpi | undefined; value: (id: string, e: Employee, k: AttendanceKpi | undefined) => { big: string; small?: string } | null }) {
  return (
    <>
      {group.columns.map(c => {
        const v = value(c.id, emp, kpi);
        return (
          <View key={c.id} style={s.row} accessible accessibilityLabel={`${c.label}: ${v ? `${v.big}${v.small ? `, ${v.small}` : ''}` : 'nothing to show'}`}>
            <Text style={s.rowLabel}>{c.label}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[s.rowValue, !v && { color: SLATE[600] }]}>{v ? v.big : '–'}</Text>
              {v?.small ? <Text style={s.rowSmall}>{v.small}</Text> : null}
            </View>
          </View>
        );
      })}
    </>
  );
}

function subtitle(emp: Employee, kpi: AttendanceKpi | undefined) {
  const parts: string[] = [];
  if (emp.department) parts.push(emp.department);
  if (kpi && !kpi.tracked) parts.push('Excused from attendance');
  else if (kpi && kpi.leaveDays > 0) parts.push(`${kpi.leaveDays} ${kpi.leaveDays === 1 ? 'day' : 'days'} on leave`);
  return parts.join(' · ');
}

const s = StyleSheet.create({
  thisMonth: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white },
  thisMonthText: { fontSize: 14, fontWeight: '700', color: SLATE[700] },
  search: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white, paddingHorizontal: 12, fontSize: 15, color: colors.ink },
  state: { textAlign: 'center', paddingVertical: 28, fontSize: 14, color: SLATE[600] },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: 16, paddingVertical: 14 },
  name: { fontSize: 16, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 12.5, color: SLATE[600], marginTop: 1, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100 },
  rowLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: SLATE[700] },
  rowValue: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  rowSmall: { fontSize: 11.5, color: SLATE[600] },
});
