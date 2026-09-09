import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '../types';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesByGender } from '../lib/weekOff';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalDateKey,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
  type WeeklyPatternByEmployee,
} from '../lib/shift';
import { colors } from '../theme';
import { ChevronIcon } from '../components/icons';
import { buildPeriodOptions, currentSystemYearMonth, formatDdMmYyyy, systemPeriod } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

type Row = {
  id: string;
  enrollId: string;
  name: string;
  salary: number | null;
  days: number;
  hours: number;
  overtime: number;
  lateDays: number;
  earlyDays: number;
  paidOffDays: number;
};

export default function PayrollScreen({ navigation }: any) {
  const { system } = useCalendarSystem();
  const [{ year, month }, setYearMonth] = useState(() => currentSystemYearMonth('AD'));
  useEffect(() => {
    setYearMonth(currentSystemYearMonth(system));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);
  const period = useMemo(() => systemPeriod(system, year, month), [system, year, month]);
  const { start, end } = period;

  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingSalary, setPendingSalary] = useState<Record<string, string>>({});
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  // Seeded from (and savable back to) the company's own saved default
  // (companies.ot_hours_per_day/ot_multiplier) rather than a hardcoded
  // 8h/1.5x, so a chosen OT policy actually sticks between sessions.
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [otHoursPerDay, setOtHoursPerDay] = useState('8');
  const [otMultiplier, setOtMultiplier] = useState('1.5');
  const [otDefaultsDirty, setOtDefaultsDirty] = useState(false);
  const [savingOtDefaults, setSavingOtDefaults] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ companyId, weeklyOffDay, rosterMode, otHoursPerDay, otMultiplier }) => {
      setCompanyId(companyId);
      setWeeklyOffDay(weeklyOffDay);
      setOtHoursPerDay(String(otHoursPerDay));
      setOtMultiplier(String(otMultiplier));
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows((data as any) ?? []));
      }
    });
  }, []);

  async function saveOtDefaults() {
    if (!companyId) return;
    setSavingOtDefaults(true);
    const { error } = await supabase
      .from('companies')
      .update({ ot_hours_per_day: Number(otHoursPerDay) || 0, ot_multiplier: Number(otMultiplier) || 0 })
      .eq('id', companyId);
    setSavingOtDefaults(false);
    if (!error) setOtDefaultsDirty(false);
  }

  function reload() {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', start).lte('work_date', end),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', `${start}T00:00:00Z`).lte('punch_time', `${end}T23:59:59Z`),
      supabase.from('shifts').select('*'),
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
      supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    ]).then(([summariesRes, logsRes, shiftsRes, employeesRes, rosterRes, holidaysRes, leaveRes]) => {
      setSummaries((summariesRes.data as PayrollSummary[]) ?? []);
      setLogs((logsRes.data as AttendanceLog[]) ?? []);
      setShifts((shiftsRes.data as Shift[]) ?? []);
      setEmployees((employeesRes.data as Employee[]) ?? []);
      setDailyShiftRows((rosterRes.data as any) ?? []);
      setHolidays((holidaysRes.data as CompanyHoliday[]) ?? []);
      setLeaveRequests((leaveRes.data as LeaveRequest[]) ?? []);
      setLoading(false);
    });
  }
  useEffect(reload, [start, end]);

  // A per-employee lookup: gender-scoped holidays (e.g. Teej) are a paid day
  // off only for the employees they cover.
  const weekOffDatesFor = useMemo(() => weekOffDatesByGender(start, end, weeklyOffDay, holidays), [start, end, weeklyOffDay, holidays]);
  const leaveByEmployee = useMemo(() => leaveDatesByEmployee(leaveRequests), [leaveRequests]);
  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);
  const elapsedDaysInRange = useMemo(() => {
    const today = nepalTodayIso();
    const elapsedEnd = end < today ? end : today;
    return start > elapsedEnd ? 0 : (new Date(elapsedEnd).getTime() - new Date(start).getTime()) / 86400000 + 1;
  }, [start, end]);

  const byEmployee: Row[] = useMemo(() => {
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    while (cur <= endDate) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const map = new Map<string, Row>();
    for (const emp of employees) {
      map.set(emp.id, { id: emp.id, enrollId: emp.fingerprint_id ?? '—', name: emp.name, salary: emp.salary, days: 0, hours: 0, overtime: 0, lateDays: 0, earlyDays: 0, paidOffDays: 0 });
    }
    const today = nepalTodayIso();
    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of employees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => nepalDateKey(l.punch_time) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern, days);
      logsByEmployeeDay.set(emp.id, byDate);
    }
    for (const day of days) {
      for (const emp of employees) {
        const row = map.get(emp.id);
        if (!row) continue;
        const weekOffDateSet = weekOffDatesFor(emp.gender);
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        if (summary) {
          row.days += 1;
          row.hours += Number(summary.total_hours);
          row.overtime += Number(summary.overtime_hours);
          if (summary.is_late && !emp.attendance_exempt) row.lateDays += 1;
          if (summary.is_early_departure && !emp.attendance_exempt) row.earlyDays += 1;
          continue;
        }
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        if (dayLogs.length === 0) {
          // No punch, but still a paid day: company Week-off, a per-employee
          // Week Off from the roster or recurring weekly pattern (checked
          // via the same resolveShiftForDate() a day WITH punches already
          // uses below — a roster/pattern row wins over the company-wide
          // date), or approved Leave.
          const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
          if (isWeekOff(resolved) || leaveByEmployee.get(emp.id)?.has(day)) row.paidOffDays += 1;
          continue;
        }
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
        const live = computeDayStatusForResolvedShift(dayLogs, resolved);
        row.days += 1;
        row.hours += live.totalMinutes / 60;
        row.overtime += live.overtimeMinutes / 60;
        if (live.isLate && !emp.attendance_exempt) row.lateDays += 1;
        if (live.isEarly && !emp.attendance_exempt) row.earlyDays += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.enrollId.localeCompare(b.enrollId, undefined, { numeric: true, sensitivity: 'base' }));
  }, [summaries, logs, shifts, employees, start, end, dailyShiftByDate, weekOffDatesFor, leaveByEmployee, weeklyPattern]);

  const otHours = Number(otHoursPerDay) || 0;
  const otMult = Number(otMultiplier) || 0;

  function calculatedSalary(row: Row): number | null {
    if (row.salary == null || !otHours) return null;
    const hourlyRate = row.salary / (daysInRange * otHours);
    const regularHours = Math.max(0, row.hours - row.overtime);
    return Math.round(hourlyRate * regularHours + hourlyRate * otHours * row.paidOffDays);
  }
  function overtimeSalary(row: Row): number | null {
    if (row.salary == null || !otHours) return null;
    if (row.overtime <= 0) return 0;
    const hourlyRate = row.salary / (daysInRange * otHours);
    return Math.round(hourlyRate * otMult * row.overtime);
  }
  function totalSalary(row: Row): number | null {
    const calculated = calculatedSalary(row);
    if (calculated == null) return null;
    return calculated + (overtimeSalary(row) ?? 0);
  }

  const totals = useMemo(() => {
    const totalHours = byEmployee.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = byEmployee.reduce((s, r) => s + r.overtime, 0);
    const workedDays = byEmployee.reduce((s, r) => s + r.days, 0);
    const paidOffDays = byEmployee.reduce((s, r) => s + r.paidOffDays, 0);
    const possibleDays = employees.length * elapsedDaysInRange;
    const absentDays = Math.max(0, possibleDays - workedDays - paidOffDays);
    const attendancePct = possibleDays ? Math.round((workedDays / possibleDays) * 1000) / 10 : 0;
    const totalEmployeeSalary = byEmployee.reduce((s, r) => s + (r.salary ?? 0), 0);
    const totalSalaryPayable = byEmployee.reduce((s, r) => s + (calculatedSalary(r) ?? 0), 0);
    const totalOvertimeSalary = byEmployee.reduce((s, r) => s + (overtimeSalary(r) ?? 0), 0);
    return { totalHours, overtimeHours, workedDays, paidOffDays, absentDays, attendancePct, totalEmployeeSalary, totalSalaryPayable, totalOvertimeSalary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byEmployee, employees.length, elapsedDaysInRange, otHours, otMult]);

  async function saveSalaryRow(employeeId: string) {
    const draft = pendingSalary[employeeId];
    if (draft === undefined) return;
    setSavingRowId(employeeId);
    const { error } = await supabase.from('employees').update({ salary: draft ? Number(draft) : null }).eq('id', employeeId);
    setSavingRowId(null);
    if (error) return;
    setPendingSalary(p => {
      const next = { ...p };
      delete next[employeeId];
      return next;
    });
    setEditingSalaryId(null);
    reload();
  }

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setYearMonth({ year: y, month: m });
  }

  if (loading && byEmployee.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.warningBg }]}>
            <Text style={[styles.statLabel, { color: colors.warningText }]}>Overtime Salary</Text>
            <Text style={[styles.statValue, { color: colors.warningText }]}>{Math.round(totals.totalOvertimeSalary).toLocaleString()}</Text>
            <View style={styles.otInputsRow}>
              <TextInput
                style={styles.otInput}
                value={otHoursPerDay}
                onChangeText={v => {
                  setOtHoursPerDay(v);
                  setOtDefaultsDirty(true);
                }}
                keyboardType="numeric"
              />
              <Text style={styles.otInputLabel}>h/day ×</Text>
              <TextInput
                style={styles.otInput}
                value={otMultiplier}
                onChangeText={v => {
                  setOtMultiplier(v);
                  setOtDefaultsDirty(true);
                }}
                keyboardType="numeric"
              />
              <Text style={styles.otInputLabel}>x</Text>
            </View>
            {otDefaultsDirty && (
              <TouchableOpacity onPress={saveOtDefaults} disabled={savingOtDefaults || !companyId}>
                <Text style={[styles.otInputLabel, { textDecorationLine: 'underline', marginTop: 4, opacity: savingOtDefaults ? 0.5 : 1 }]}>
                  {savingOtDefaults ? 'Saving…' : 'Save as company default'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.goodBg }]}>
            <Text style={[styles.statLabel, { color: colors.goodText }]}>Total Salary Payable</Text>
            <Text style={[styles.statValue, { color: colors.goodText }]}>{Math.round(totals.totalSalaryPayable).toLocaleString()}</Text>
            <Text style={[styles.statHint, { color: colors.goodText }]}>Earned so far this period</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.infoBg }]}>
            <Text style={[styles.statLabel, { color: colors.infoText }]}>Total Employees Salary</Text>
            <Text style={[styles.statValue, { color: colors.infoText }]}>{Math.round(totals.totalEmployeeSalary).toLocaleString()}</Text>
            <Text style={[styles.statHint, { color: colors.infoText }]}>Full monthly salary, all staff</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.accentLight }]}>
            <Text style={[styles.statLabel, { color: colors.accent }]}>Total Payable Hours</Text>
            <Text style={[styles.statValue, { color: colors.accent }]}>{fmtHrs(totals.totalHours)}</Text>
            <Text style={[styles.statHint, { color: colors.accent }]}>Across {employees.length} staff</Text>
          </View>
          <View
            style={[
              styles.statCard,
              { backgroundColor: totals.attendancePct >= 75 ? colors.goodBg : totals.attendancePct >= 50 ? colors.warningBg : colors.criticalBg },
            ]}
          >
            <Text style={[styles.statLabel, { color: totals.attendancePct >= 75 ? colors.goodText : totals.attendancePct >= 50 ? colors.warningText : colors.criticalText }]}>
              Avg Attendance
            </Text>
            <Text style={[styles.statValue, { color: totals.attendancePct >= 75 ? colors.goodText : totals.attendancePct >= 50 ? colors.warningText : colors.criticalText }]}>
              {totals.attendancePct}%
            </Text>
            <Text style={[styles.statHint, { color: totals.attendancePct >= 75 ? colors.goodText : totals.attendancePct >= 50 ? colors.warningText : colors.criticalText }]}>
              Worked vs possible days
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#f3e8ff' }]}>
            <Text style={[styles.statLabel, { color: '#7e22ce' }]}>Overtime Tracked</Text>
            <Text style={[styles.statValue, { color: '#7e22ce' }]}>{fmtHrs(totals.overtimeHours)}</Text>
            <Text style={[styles.statHint, { color: '#7e22ce' }]}>This period</Text>
          </View>
        </View>

        <View style={styles.periodBar}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.periodArrow}>
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <ChevronIcon size={16} color={colors.accent} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMonthPickerOpen(true)} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.periodLabel}>{period.label}</Text>
            <Text style={styles.periodSub}>
              {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)} ({daysInRange}d)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.periodArrow}>
            <View style={{ transform: [{ rotate: '-90deg' }] }}>
              <ChevronIcon size={16} color={colors.accent} />
            </View>
          </TouchableOpacity>
        </View>

        <View>
          {byEmployee.map(item => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardTop}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.navigate('PayrollDetail', { employeeId: item.id })}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.cardSub}>ID {item.enrollId}</Text>
                </TouchableOpacity>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.gridLabel}>Total</Text>
                  <Text style={styles.cardTotal}>{totalSalary(item) != null ? totalSalary(item)!.toLocaleString() : '—'}</Text>
                </View>
              </View>

              <View style={styles.cardGrid}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Days</Text>
                  <Text style={styles.gridValue}>{item.days}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Hours</Text>
                  <Text style={styles.gridValue}>{fmtHrs(item.hours)}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Overtime</Text>
                  <Text style={[styles.gridValue, { color: colors.infoText }]}>{fmtHrs(item.overtime)}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Late / Early</Text>
                  <Text style={styles.gridValue}>
                    <Text style={{ color: colors.warningText }}>{item.lateDays}L</Text> <Text style={{ color: colors.criticalText }}>{item.earlyDays}E</Text>
                  </Text>
                </View>

                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Salary</Text>
                  {editingSalaryId === item.id ? (
                    <View style={{ gap: 4 }}>
                      <TextInput
                        style={styles.salaryInput}
                        keyboardType="numeric"
                        autoFocus
                        value={pendingSalary[item.id] ?? (item.salary != null ? String(item.salary) : '')}
                        onChangeText={v => setPendingSalary(p => ({ ...p, [item.id]: v }))}
                      />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity onPress={() => setEditingSalaryId(null)}>
                          <Text style={styles.cancelLink}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => saveSalaryRow(item.id)} disabled={savingRowId === item.id}>
                          <Text style={styles.saveLink}>{savingRowId === item.id ? '…' : 'Save'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setEditingSalaryId(item.id)}>
                      <Text style={styles.gridValue}>{item.salary != null ? item.salary.toLocaleString() : 'Set'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Calculated</Text>
                  <Text style={styles.gridValue}>{calculatedSalary(item) != null ? calculatedSalary(item)!.toLocaleString() : '—'}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>OT Salary</Text>
                  <Text style={styles.gridValue}>{overtimeSalary(item) != null ? overtimeSalary(item)!.toLocaleString() : '—'}</Text>
                </View>
              </View>
            </View>
          ))}
          {byEmployee.length === 0 && <Text style={styles.empty}>{loading ? 'Loading…' : 'No active employees.'}</Text>}
        </View>

        {byEmployee.length > 0 && (
          <View style={styles.footerBar}>
            <Text style={{ color: colors.goodText, fontWeight: '700', fontSize: 12 }}>{totals.workedDays} present days</Text>
            <Text style={{ color: colors.slate400 }}> · </Text>
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 12 }}>{totals.paidOffDays} paid week-off/leave</Text>
            <Text style={{ color: colors.slate400 }}> · </Text>
            <Text style={{ color: colors.criticalText, fontWeight: '700', fontSize: 12 }}>{totals.absentDays} absent days</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={monthPickerOpen} transparent animationType="fade" onRequestClose={() => setMonthPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setMonthPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={buildPeriodOptions(system, null, period)}
              keyExtractor={o => o.key}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    const [y, m] = item.key.split('-').slice(1).map(Number);
                    setYearMonth({ year: y, month: m });
                    setMonthPickerOpen(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, item.key === period.key && { color: colors.accent, fontWeight: '700' }]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: { flexBasis: '48%', borderRadius: 12, padding: 12, marginBottom: 10 },
  statLabel: { fontSize: 11, fontWeight: '600' },
  statValue: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  statHint: { fontSize: 10, marginTop: 2, opacity: 0.8 },
  otInputsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  otInput: { width: 32, borderWidth: 1, borderColor: colors.warning, borderRadius: 4, backgroundColor: colors.white, textAlign: 'center', fontSize: 10, color: colors.warningText, paddingVertical: 2 },
  otInputLabel: { fontSize: 10, color: colors.warningText },
  periodBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 10, marginBottom: 12 },
  periodArrow: { padding: 8 },
  periodLabel: { fontSize: 19, fontWeight: '700', color: colors.ink },
  periodSub: { fontSize: 12, color: colors.slate400, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  cardName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  cardSub: { fontSize: 11, color: colors.slate400, marginTop: 1 },
  cardTotal: { fontSize: 17, fontWeight: '700', color: colors.goodText, marginTop: 2 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: 12 },
  gridItem: { width: '50%', paddingRight: 10, marginBottom: 10 },
  gridLabel: { fontSize: 10, fontWeight: '700', color: colors.slate400, textTransform: 'uppercase', marginBottom: 3 },
  gridValue: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  salaryInput: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, fontSize: 12, color: colors.ink, width: 90 },
  cancelLink: { fontSize: 11, color: colors.slate500, fontWeight: '600' },
  saveLink: { fontSize: 11, color: colors.accent, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 20, marginBottom: 20, color: colors.slate400 },
  footerBar: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
