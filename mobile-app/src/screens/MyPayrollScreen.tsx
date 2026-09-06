import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import { buildWeeklyPatternByEmployee, formatHoursMinutes, nepalTodayIso, type DailyShiftByDate, type WeeklyPatternByEmployee } from '../lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning, type DayDetail } from '../lib/payrollDetail';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '../lib/weekOff';
import { buildPeriodOptions, currentSystemYearMonth, formatDdMmYyyy, systemPeriod, type CalendarPeriod } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '../types';
import { colors } from '../theme';
import { ChevronIcon } from '../components/icons';
import SimpleLineChart from '../components/SimpleLineChart';

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

export default function MyPayrollScreen() {
  const { system } = useCalendarSystem();
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [dataRange, setDataRange] = useState<{ earliest: Date; latest: Date } | null>(null);
  const { start, end } = period;

  // Toggling AD/BS resets to "this month" in the newly active system — the
  // previously selected month rarely has an equivalent boundary in the
  // other system. Mirrors the web My Payroll page.
  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [lifetimeSummaries, setLifetimeSummaries] = useState<PayrollSummary[]>([]);
  const [lifetimeLogs, setLifetimeLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ weekday: number; shift_id: string | null }[]>([]);
  // Loaded from the company's saved default (companies.ot_hours_per_day/
  // ot_multiplier, set on the admin Payroll screen) rather than a hardcoded
  // 8h/1.5x, so this figure actually matches what the admin sees.
  const [otHoursPerDay, setOtHoursPerDay] = useState(8);
  const [otMultiplier, setOtMultiplier] = useState(1.5);
  // One company-wide rate each (companies.pf_rate/…), set on the admin
  // Salary Structure page — so these deduction lines match what the admin sees.
  const [pfRate, setPfRate] = useState(10);
  const [ssfRate, setSsfRate] = useState(11);
  const [tdsRate, setTdsRate] = useState(0);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode, otHoursPerDay, otMultiplier, pfRate, ssfRate, tdsRate }) => {
      setWeeklyOffDay(weeklyOffDay);
      setOtHoursPerDay(otHoursPerDay);
      setOtMultiplier(otMultiplier);
      setPfRate(pfRate);
      setSsfRate(ssfRate);
      setTdsRate(tdsRate);
      if (rosterMode === 'weekly' && employeeId) {
        supabase
          .from('employee_weekly_pattern')
          .select('weekday, shift_id')
          .eq('employee_id', employeeId)
          .then(({ data }) => setWeeklyPatternRows((data as any) ?? []));
      }
    });
  }, [employeeId]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const [{ data: emp }, { data: shiftRows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
      ]);
      setEmployee((emp as Employee) ?? null);
      setShifts((shiftRows as Shift[]) ?? []);
    });
  }, []);

  // This employee's own oldest/newest punch — bounds the period picker to
  // months that actually have data for them, same as web.
  useEffect(() => {
    if (!employeeId) return;
    Promise.all([
      supabase.from('attendance_logs').select('punch_time').eq('employee_id', employeeId).order('punch_time', { ascending: true }).limit(1),
      supabase.from('attendance_logs').select('punch_time').eq('employee_id', employeeId).order('punch_time', { ascending: false }).limit(1),
    ]).then(([earliestRes, latestRes]) => {
      const earliest = earliestRes.data?.[0]?.punch_time;
      const latest = latestRes.data?.[0]?.punch_time;
      if (!earliest || !latest) {
        setDataRange(null);
        return;
      }
      setDataRange({ earliest: new Date(earliest), latest: new Date(latest) });
    });
  }, [employeeId]);

  const periodOptions = useMemo(() => buildPeriodOptions(system, dataRange, period), [system, dataRange, period]);

  useEffect(() => {
    if (!employeeId) return;
    supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end).then(({ data }) => setSummaries((data as PayrollSummary[]) ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', `${start}T00:00:00Z`)
      .lte('punch_time', `${end}T23:59:59Z`)
      .then(({ data }) => setLogs((data as AttendanceLog[]) ?? []));
  }, [employeeId, start, end]);

  useEffect(() => {
    if (!employeeId || !employee?.date_of_joining) return;
    const from = employee.date_of_joining;
    const today = nepalTodayIso();
    supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).eq('employee_id', employeeId).gte('work_date', from).lte('work_date', today).then(({ data }) => setLifetimeSummaries((data as PayrollSummary[]) ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', `${from}T00:00:00Z`)
      .then(({ data }) => setLifetimeLogs((data as AttendanceLog[]) ?? []));
    supabase.from('employee_daily_shifts').select('work_date, shift_id').eq('employee_id', employeeId).gte('work_date', from).lte('work_date', today).then(({ data }) => setDailyShiftRows((data as any) ?? []));
    supabase.from('company_holidays').select('*').gte('holiday_date', from).lte('holiday_date', today).then(({ data }) => setHolidays((data as CompanyHoliday[]) ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', from)
      .then(({ data }) => setLeaveRequests((data as LeaveRequest[]) ?? []));
  }, [employeeId, employee?.date_of_joining]);

  // One combined set of paid-off dates spanning this employee's whole
  // employment history — reused for both the selected period's rows and the
  // lifetime rows below.
  const paidOffDates = useMemo(() => {
    if (!employee?.date_of_joining) return new Set<string>();
    const today = nepalTodayIso();
    const set = weekOffDatesInRange(employee.date_of_joining, today, weeklyOffDay, holidays, employee.gender);
    for (const req of leaveRequests) {
      const cur = new Date(req.start_date + 'T00:00:00Z');
      const endDate = new Date(req.end_date + 'T00:00:00Z');
      while (cur <= endDate) {
        set.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    return set;
  }, [employee?.date_of_joining, employee?.gender, weeklyOffDay, holidays, leaveRequests]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    if (!employeeId) return map;
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => {
    if (!employeeId) return new Map();
    const rows = weeklyPatternRows.map(r => ({ employee_id: employeeId, weekday: r.weekday, shift_id: r.shift_id }));
    return buildWeeklyPatternByEmployee(rows);
  }, [weeklyPatternRows, employeeId]);

  const dayRows: DayDetail[] = useMemo(
    () => (employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, weeklyPattern) : []),
    [employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, weeklyPattern]
  );
  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);

  const lifetimeDayRows: DayDetail[] = useMemo(
    () =>
      employee?.date_of_joining
        ? buildEmployeeDayRows(employee, shifts, lifetimeSummaries, lifetimeLogs, employee.date_of_joining, nepalTodayIso(), dailyShiftByDate, paidOffDates, weeklyPattern)
        : [],
    [employee, shifts, lifetimeSummaries, lifetimeLogs, dailyShiftByDate, paidOffDates, weeklyPattern]
  );

  const totalEarned = useMemo(() => {
    if (employee?.salary == null) return null;
    const byMonth = new Map<string, DayDetail[]>();
    for (const row of lifetimeDayRows) {
      const key = row.date.slice(0, 7);
      const list = byMonth.get(key);
      if (list) list.push(row);
      else byMonth.set(key, [row]);
    }
    let total = 0;
    for (const [key, rows] of byMonth) {
      const [y, m] = key.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      for (const row of rows) {
        const earning = dailySalaryEarning(row, employee.salary, daysInMonth, otHoursPerDay, otMultiplier, true);
        if (earning) total += earning.total;
      }
    }
    return Math.round(total);
  }, [lifetimeDayRows, employee]);

  const totals = useMemo(() => {
    const totalHours = dayRows.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = dayRows.reduce((s, r) => s + r.overtime, 0);
    const presentDays = dayRows.filter(r => r.checkIn).length;
    const absentDays = dayRows.filter(r => r.status === 'Absent').length;
    const paidOffDays = dayRows.filter(r => r.status === 'Week Off').length;
    let baseEarning = 0;
    let overtimeEarning = 0;
    for (const r of dayRows) {
      const earning = dailySalaryEarning(r, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, true);
      if (earning) {
        baseEarning += earning.base;
        overtimeEarning += earning.overtime;
      }
    }
    return { totalHours, overtimeHours, presentDays, absentDays, paidOffDays, totalSalary: baseEarning + overtimeEarning, overtimeEarning };
  }, [dayRows, employee, daysInRange]);

  // Payslip-style breakdown for the selected period — mirrors the web My
  // Payroll page. Basic Salary is the attendance-prorated base earning;
  // Allowance scales by that same attendance fraction; PF/SSF/TDS are each
  // a % of Basic Salary.
  const breakdown = useMemo(() => {
    if (employee?.salary == null) return null;
    const basic = Math.round(totals.totalSalary - totals.overtimeEarning);
    const earnedFraction = employee.salary > 0 ? basic / employee.salary : 0;
    const allowance = Math.round((employee.allowance ?? 0) * earnedFraction);
    const total = basic + allowance;
    const pf = Math.round((basic * pfRate) / 100);
    const ssf = Math.round((basic * ssfRate) / 100);
    const ot = Math.round(totals.overtimeEarning);
    const tds = Math.round((basic * tdsRate) / 100);
    const totalSalary = total + ot - pf - ssf - tds;
    return { basic, allowance, total, pf, ssf, ot, tds, totalSalary };
  }, [employee, totals, pfRate, ssfRate, tdsRate]);

  function changePeriod(delta: number) {
    const idx = periodOptions.findIndex(o => o.key === period.key);
    const next = periodOptions[idx + delta];
    if (next) setPeriod(next);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employeeId) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Your account isn't linked to an employee record yet.</Text>
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
            {employee?.salary != null && breakdown && (
              <>
                <View style={styles.salaryGrid}>
                  <SalaryTile label="Basic Salary" value={breakdown.basic} bg={colors.goodBg} fg={colors.goodText} />
                  <SalaryTile label="Allowance" value={breakdown.allowance} bg={colors.infoBg} fg={colors.infoText} />
                  <SalaryTile label="Total" value={breakdown.total} bg={colors.accentLight} fg={colors.accent} />
                  <SalaryTile label="PF" value={breakdown.pf} bg={colors.criticalBg} fg={colors.criticalText} negative />
                  <SalaryTile label="SSF" value={breakdown.ssf} bg={colors.criticalBg} fg={colors.criticalText} negative />
                  <SalaryTile label="OT" value={breakdown.ot} bg={colors.infoBg} fg={colors.infoText} />
                  <SalaryTile label="TDS" value={breakdown.tds} bg={colors.criticalBg} fg={colors.criticalText} negative />
                  <SalaryTile label="Total Salary" value={breakdown.totalSalary} bg={colors.warningBg} fg={colors.warningText} bold />
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.slate100, marginBottom: 12 }]}>
                  <Text style={[styles.statLabel, { color: colors.slate500 }]}>Total Earned till date</Text>
                  <Text style={styles.statValue}>{totalEarned != null ? totalEarned.toLocaleString() : '—'}</Text>
                </View>
              </>
            )}

            <View style={styles.periodBar}>
              <TouchableOpacity onPress={() => changePeriod(-1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.periodLabelBtn} onPress={() => setPeriodPickerOpen(true)}>
                <Text style={styles.periodLabel}>{period.label}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changePeriod(1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '-90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
            </View>
            <Text style={styles.dateRangeHint}>
              {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
            </Text>

            <Text style={styles.sectionHeading}>Daily Breakdown of {period.label}</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 0.11 }]}>Date</Text>
              <Text style={[styles.th, { flex: 0.15 }]}>Hrs</Text>
              <Text style={[styles.th, { flex: 0.15 }]}>OT</Text>
              <Text style={[styles.th, { flex: 0.12 }]}>Status</Text>
              <Text style={[styles.th, { flex: 0.23 }]}>My Salary</Text>
              <Text style={[styles.th, { flex: 0.24 }]}>Total(OT)</Text>
            </View>
          </>
        }
        renderItem={({ item: row, index }) => {
          const earning =
            row.checkIn || row.paidOff ? dailySalaryEarning(row, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, true) : null;
          return (
            <View style={[styles.tr, index % 2 === 1 && styles.trAlt]}>
              <Text style={[styles.td, { flex: 0.11 }]}>{formatDdMmYyyy(row.date, system).slice(0, 5)}</Text>
              <Text style={[styles.td, { flex: 0.15 }]}>{row.checkIn ? fmtHrs(row.hours) : '—'}</Text>
              <Text style={[styles.td, { flex: 0.15, color: colors.infoText }]}>{row.checkIn ? fmtHrs(row.overtime) : '—'}</Text>
              <Text
                style={[
                  styles.td,
                  { flex: 0.12 },
                  row.checkIn ? { color: colors.goodText } : row.status === 'Week Off' ? { color: colors.accent } : row.status === 'Absent' ? { color: colors.criticalText } : styles.dim,
                ]}
              >
                {row.checkIn ? 'Present' : row.status === 'Week Off' ? 'Week Off' : row.status === 'Absent' ? 'Absent' : '—'}
              </Text>
              <Text style={[styles.td, { flex: 0.23 }]}>{earning ? Math.round(earning.base).toLocaleString() : '—'}</Text>
              <Text style={[styles.td, styles.tdBold, { flex: 0.24 }]}>
                {earning ? Math.round(earning.total).toLocaleString() : '—'}
                {earning && earning.overtime > 0 ? <Text style={{ color: colors.infoText }}> ({Math.round(earning.overtime).toLocaleString()})</Text> : null}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No attendance records for this month yet.</Text>}
        ListFooterComponent={
          dayRows.length > 0 ? (
            <>
              <View style={styles.footerRow}>
                <Text style={[styles.tf, { flex: 0.11 }]}>Total</Text>
                <Text style={[styles.tf, { flex: 0.15 }]}>{fmtHrs(totals.totalHours)}</Text>
                <Text style={[styles.tf, { flex: 0.15, color: colors.infoText }]}>{fmtHrs(totals.overtimeHours)}</Text>
                <Text style={[styles.tf, { flex: 0.12 }]}>
                  <Text style={{ color: colors.goodText }}>{totals.presentDays}P</Text> <Text style={{ color: colors.accent }}>{totals.paidOffDays}W</Text>{' '}
                  <Text style={{ color: colors.criticalText }}>{totals.absentDays}A</Text>
                </Text>
                <Text style={[styles.tf, { flex: 0.23 }]}>{Math.round(totals.totalSalary - totals.overtimeEarning).toLocaleString()}</Text>
                <Text style={[styles.tf, { flex: 0.24, color: colors.goodText }]}>{Math.round(totals.totalSalary).toLocaleString()}</Text>
              </View>
              <View style={styles.chartCard}>
                <Text style={styles.sectionHeading}>Earning Trend</Text>
                <SimpleLineChart
                  color="#7c3aed"
                  formatValue={v => Math.round(v).toLocaleString()}
                  data={dayRows.map(row => {
                    const earning =
                      row.checkIn || row.paidOff
                        ? dailySalaryEarning(row, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, true)
                        : null;
                    return { label: formatDdMmYyyy(row.date, system).slice(0, 2), value: earning ? Math.round(earning.total) : 0 };
                  })}
                />
              </View>
            </>
          ) : null
        }
      />

      <Modal visible={periodPickerOpen} transparent animationType="fade" onRequestClose={() => setPeriodPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPeriodPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={[...periodOptions].reverse()}
              keyExtractor={item => item.key}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalOption, item.key === period.key && styles.modalOptionActive]}
                  onPress={() => {
                    setPeriod(item);
                    setPeriodPickerOpen(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function SalaryTile({ label, value, bg, fg, negative, bold }: { label: string; value: number; bg: string; fg: string; negative?: boolean; bold?: boolean }) {
  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <Text style={[styles.statLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.statValue, bold && styles.tileBold]}>
        {negative && value > 0 ? '-' : ''}
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 },
  statHint: { fontSize: 9, marginTop: 1 },
  salaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tile: { width: '47%', borderRadius: 10, padding: 8, alignItems: 'center' },
  tileBold: { fontWeight: '800' },
  periodBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 8 },
  periodArrow: { padding: 8 },
  periodLabelBtn: { flex: 1 },
  periodLabel: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.ink },
  dateRangeHint: { textAlign: 'center', fontSize: 11, color: colors.slate500, marginTop: 6, marginBottom: 16 },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  chartCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginTop: 16 },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.slate100, paddingVertical: 6, paddingHorizontal: 6, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  th: { fontSize: 8, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', textAlign: 'center' },
  tr: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  trAlt: { backgroundColor: colors.slate50 },
  td: { fontSize: 9, color: colors.slate500, textAlign: 'center' },
  tdBold: { fontWeight: '700', color: colors.goodText },
  dim: { color: colors.slate400 },
  footerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, backgroundColor: colors.slate100, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  tf: { fontSize: 9, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  empty: { textAlign: 'center', marginTop: 20, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionActive: { backgroundColor: colors.accentLight },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
