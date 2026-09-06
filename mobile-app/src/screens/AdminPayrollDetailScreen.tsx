import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Switch } from 'react-native';
import { supabase } from '../lib/supabase';
import { buildWeeklyPatternByEmployee, formatHoursMinutes, nepalTodayIso, type DailyShiftByDate, type WeeklyPatternByEmployee } from '../lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning, type DayDetail } from '../lib/payrollDetail';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '../lib/weekOff';
import { formatDdMmYyyy } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '../types';
import { colors } from '../theme';
import { ChevronIcon } from '../components/icons';

const MONTH_LABEL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
function monthBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}
export default function AdminPayrollDetailScreen({ route }: any) {
  const { employeeId } = route.params as { employeeId: string };
  const { system } = useCalendarSystem();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const { start, end } = useMemo(() => monthBounds(year, month), [year, month]);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ weekday: number; shift_id: string | null }[]>([]);
  // Read-only here (the save control lives on the admin Payroll list
  // screen) — loaded from the company's saved default rather than a
  // hardcoded 8h/1.5x.
  const [otHoursPerDay, setOtHoursPerDay] = useState(8);
  const [otMultiplier, setOtMultiplier] = useState(1.5);
  // Overtime pay is optional per employee (some employees just aren't
  // paid extra for it) — on by default, toggled here on the employee's
  // own page (moved off the Payroll list).
  const [otOn, setOtOn] = useState(true);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode, otHoursPerDay, otMultiplier }) => {
      setWeeklyOffDay(weeklyOffDay);
      setOtHoursPerDay(otHoursPerDay);
      setOtMultiplier(otMultiplier);
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('weekday, shift_id')
          .eq('employee_id', employeeId)
          .then(({ data }) => setWeeklyPatternRows((data as any) ?? []));
      }
    });
  }, [employeeId]);

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        setEmployee((data as Employee) ?? null);
        setLoading(false);
      });
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
  }, [employeeId]);

  useEffect(() => {
    supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end).then(({ data }) => setSummaries((data as PayrollSummary[]) ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', `${start}T00:00:00Z`)
      .lte('punch_time', `${end}T23:59:59Z`)
      .then(({ data }) => setLogs((data as AttendanceLog[]) ?? []));
    supabase.from('employee_daily_shifts').select('work_date, shift_id').eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end).then(({ data }) => setDailyShiftRows((data as any) ?? []));
    supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end).then(({ data }) => setHolidays((data as CompanyHoliday[]) ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', end)
      .gte('end_date', start)
      .then(({ data }) => setLeaveRequests((data as LeaveRequest[]) ?? []));
  }, [employeeId, start, end]);

  const paidOffDates = useMemo(() => {
    const set = weekOffDatesInRange(start, end, weeklyOffDay, holidays, employee?.gender ?? null);
    for (const req of leaveRequests) {
      const cur = new Date((req.start_date < start ? start : req.start_date) + 'T00:00:00Z');
      const endDate = new Date((req.end_date > end ? end : req.end_date) + 'T00:00:00Z');
      while (cur <= endDate) {
        set.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    return set;
  }, [start, end, weeklyOffDay, holidays, leaveRequests, employee?.gender]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => {
    const rows = weeklyPatternRows.map(r => ({ employee_id: employeeId, weekday: r.weekday, shift_id: r.shift_id }));
    return buildWeeklyPatternByEmployee(rows);
  }, [weeklyPatternRows, employeeId]);

  const dayRows: DayDetail[] = useMemo(
    () => (employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, weeklyPattern) : []),
    [employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, weeklyPattern]
  );
  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);

  const totals = useMemo(() => {
    const totalHours = dayRows.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = dayRows.reduce((s, r) => s + r.overtime, 0);
    const presentDays = dayRows.filter(r => r.checkIn).length;
    const absentDays = dayRows.filter(r => r.status === 'Absent').length;
    const paidOffDays = dayRows.filter(r => r.status === 'Week Off').length;
    let baseEarning = 0;
    let overtimeEarning = 0;
    for (const r of dayRows) {
      const earning = dailySalaryEarning(r, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, otOn);
      if (earning) {
        baseEarning += earning.base;
        overtimeEarning += earning.overtime;
      }
    }
    return { totalHours, overtimeHours, presentDays, absentDays, paidOffDays, totalSalary: baseEarning + overtimeEarning, overtimeEarning };
  }, [dayRows, employee, daysInRange, otHoursPerDay, otMultiplier, otOn]);

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
    setMonth(m);
    setYear(y);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employee) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Employee not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={dayRows}
        keyExtractor={item => item.date}
        ListHeaderComponent={
          <>
            <View style={styles.headerCard}>
              <Text style={styles.empName}>{employee.name}</Text>
              <Text style={styles.empMeta}>
                ID {employee.fingerprint_id ?? '—'} · {employee.designation ?? '—'}
              </Text>
              <View style={styles.otToggleRow}>
                <Text style={styles.otToggleLabel}>Overtime Salary</Text>
                <Switch
                  value={otOn}
                  onValueChange={setOtOn}
                  trackColor={{ false: colors.slate200, true: colors.good }}
                  style={{ transform: [{ scale: 0.8 }] }}
                />
              </View>
            </View>
            {employee.salary != null && (
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: colors.goodBg }]}>
                  <Text style={[styles.statLabel, { color: colors.goodText }]}>Salary/Day</Text>
                  <Text style={styles.statValue}>{employee.salary.toLocaleString()}</Text>
                  <Text style={[styles.statHint, { color: colors.goodText }]}>{Math.round(employee.salary / daysInRange).toLocaleString()}/day</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.infoBg }]}>
                  <Text style={[styles.statLabel, { color: colors.infoText }]}>Receivable</Text>
                  <Text style={styles.statValue}>{Math.round(totals.totalSalary).toLocaleString()}</Text>
                  <Text style={[styles.statHint, { color: colors.infoText }]}>(OT: {Math.round(totals.overtimeEarning).toLocaleString()})</Text>
                </View>
              </View>
            )}

            <View style={styles.periodBar}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
              <Text style={styles.periodLabel}>
                {MONTH_LABEL[month]} {year}
              </Text>
              <TouchableOpacity onPress={() => changeMonth(1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '-90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionHeading}>Daily Breakdown</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 0.16 }]}>Date</Text>
              <Text style={[styles.th, { flex: 0.15 }]}>Hrs</Text>
              <Text style={[styles.th, { flex: 0.15 }]}>OT</Text>
              <Text style={[styles.th, { flex: 0.19 }]}>Status</Text>
              <Text style={[styles.th, { flex: 0.35 }]}>Total (OT)</Text>
            </View>
          </>
        }
        renderItem={({ item: row, index }) => {
          const earning =
            row.checkIn || row.paidOff ? dailySalaryEarning(row, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, otOn) : null;
          return (
            <View style={[styles.tr, index % 2 === 1 && styles.trAlt]}>
              <Text style={[styles.td, { flex: 0.16 }]}>{formatDdMmYyyy(row.date, system).slice(0, 5)}</Text>
              <Text style={[styles.td, { flex: 0.15 }]}>{row.checkIn ? fmtHrs(row.hours) : '—'}</Text>
              <Text style={[styles.td, { flex: 0.15, color: colors.infoText }]}>{row.checkIn ? fmtHrs(row.overtime) : '—'}</Text>
              <Text
                style={[
                  styles.td,
                  { flex: 0.19 },
                  row.checkIn ? { color: colors.goodText } : row.status === 'Week Off' ? { color: colors.accent } : row.status === 'Absent' ? { color: colors.criticalText } : styles.dim,
                ]}
              >
                {row.checkIn ? 'Present' : row.status === 'Week Off' ? 'Week Off' : row.status === 'Absent' ? 'Absent' : '—'}
              </Text>
              <Text style={[styles.td, styles.tdBold, { flex: 0.35 }]}>
                {earning ? earning.total.toFixed(0) : '—'}
                {earning && earning.overtime > 0 ? <Text style={{ color: colors.infoText }}> ({earning.overtime.toFixed(0)})</Text> : null}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No attendance records for this month yet.</Text>}
        ListFooterComponent={
          dayRows.length > 0 ? (
            <View style={styles.footerRow}>
              <Text style={[styles.tf, { flex: 0.16 }]}>Total</Text>
              <Text style={[styles.tf, { flex: 0.15 }]}>{fmtHrs(totals.totalHours)}</Text>
              <Text style={[styles.tf, { flex: 0.15, color: colors.infoText }]}>{fmtHrs(totals.overtimeHours)}</Text>
              <Text style={[styles.tf, { flex: 0.19 }]}>
                <Text style={{ color: colors.goodText }}>{totals.presentDays}P</Text> <Text style={{ color: colors.accent }}>{totals.paidOffDays}W</Text>{' '}
                <Text style={{ color: colors.criticalText }}>{totals.absentDays}A</Text>
              </Text>
              <Text style={[styles.tf, { flex: 0.35, color: colors.goodText }]}>{Math.round(totals.totalSalary).toLocaleString()}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  headerCard: { marginBottom: 12 },
  empName: { fontSize: 17, fontWeight: '700', color: colors.ink },
  empMeta: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  otToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  otToggleLabel: { fontSize: 11, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 },
  statHint: { fontSize: 9, marginTop: 1 },
  periodBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 8, marginBottom: 16 },
  periodArrow: { padding: 8 },
  periodLabel: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.ink },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.slate100, paddingVertical: 6, paddingHorizontal: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  th: { fontSize: 9, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', textAlign: 'center' },
  tr: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  trAlt: { backgroundColor: colors.slate50 },
  td: { fontSize: 10, color: colors.slate500, textAlign: 'center' },
  tdBold: { fontWeight: '700', color: colors.goodText },
  dim: { color: colors.slate400 },
  footerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, backgroundColor: colors.slate100, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  tf: { fontSize: 10, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  empty: { textAlign: 'center', marginTop: 20, color: colors.slate400 },
});
