import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '../types';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '../lib/weekOff';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  resolveShiftForDate,
  type DailyShiftByDate,
  type DayStatus,
  type WeeklyPatternByEmployee,
} from '../lib/shift';
import { colors } from '../theme';
import Badge from './Badge';
import MonthCalendarGrid from './MonthCalendarGrid';
import SimpleLineChart from './SimpleLineChart';
import { formatAdDate, formatDdMmYyyy } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';

const WINDOW_DAYS = 400;

function localDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function datesBetween(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed);
  const dates: string[] = [];
  for (let d = new Date(sy, sm - 1, sd); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    dates.push(localDateKey(d.toISOString()));
  }
  return dates;
}

type CardKey = 'hours' | 'late' | 'early' | 'overtime' | 'present' | 'absent';
type CardEntry = { date: string; minutes: number };

const CARD_STYLES: Record<CardKey, { label: string; bg: string; text: string }> = {
  hours: { label: 'Total Work Hours', bg: colors.goodBg, text: colors.goodText },
  late: { label: 'Late In', bg: colors.warningBg, text: colors.warningText },
  early: { label: 'Early Out', bg: colors.criticalBg, text: colors.criticalText },
  overtime: { label: 'Overtime', bg: colors.infoBg, text: colors.infoText },
  present: { label: 'Present Days', bg: colors.goodBg, text: colors.goodText },
  absent: { label: 'Absent Days', bg: colors.slate100, text: colors.slate500 },
};

type TableRow = {
  date: string;
  onLeave: boolean;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  overtime: number;
  lateMinutes: number;
  earlyMinutes: number;
  present: boolean;
  absent: boolean;
};

export default function EmployeeCalendarView({ employeeId }: { employeeId: string }) {
  const { system } = useCalendarSystem();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [visibleDates, setVisibleDates] = useState<string[]>([]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ weekday: number; shift_id: string | null }[]>([]);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode }) => {
      setWeeklyOffDay(weeklyOffDay);
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
    setSelectedDate(null);
    setExpandedCard(null);
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => setEmployee((data as Employee) ?? null));
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', since)
      .order('punch_time', { ascending: true })
      .then(({ data }) => setLogs((data as AttendanceLog[]) ?? []));
    supabase
      .from('payroll_summaries')
      .select(PAYROLL_SUMMARY_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('work_date', since.slice(0, 10))
      .then(({ data }) => setSummaries((data as PayrollSummary[]) ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .then(({ data }) => setLeaveRequests((data as LeaveRequest[]) ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('work_date, shift_id')
      .eq('employee_id', employeeId)
      .gte('work_date', since.slice(0, 10))
      .then(({ data }) => setDailyShiftRows((data as any) ?? []));
    supabase.from('company_holidays').select('*').gte('holiday_date', since.slice(0, 10)).then(({ data }) => setHolidays((data as CompanyHoliday[]) ?? []));
  }, [employeeId]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  // Company-wide Week-off (recurring day + ad-hoc holidays) — distinct from
  // the per-employee roster `weekOffDates` below, but treated identically
  // everywhere in this view: never Absent, never counted toward Hours, and
  // (via dayStatus below) never Late/Early either if the employee does show
  // up on one — same as a roster Week Off already was.
  const companyWeekOffDates = useMemo(() => {
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return weekOffDatesInRange(since, today, weeklyOffDay, holidays, employee?.gender ?? null);
  }, [weeklyOffDay, holidays, employee?.gender]);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => {
    const rows = weeklyPatternRows.map(r => ({ employee_id: employeeId, weekday: r.weekday, shift_id: r.shift_id }));
    return buildWeeklyPatternByEmployee(rows);
  }, [weeklyPatternRows, employeeId]);

  const dayStatus = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = localDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const map = new Map<string, DayStatus>();
    if (!employee) return map;
    applyOvernightShiftCorrection(byDate, logs, employee, shifts, dailyShiftByDate, companyWeekOffDates, weeklyPattern);
    for (const [date, dLogs] of byDate) {
      const resolved = resolveShiftForDate(employee, shifts, date, dailyShiftByDate, companyWeekOffDates, weeklyPattern);
      map.set(date, computeDayStatusForResolvedShift(dLogs, resolved));
    }
    return map;
  }, [logs, employee, shifts, dailyShiftByDate, companyWeekOffDates, weeklyPattern]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const lr of leaveRequests) for (const date of datesBetween(lr.start_date, lr.end_date)) map.set(date, lr);
    return map;
  }, [leaveRequests]);
  const leaveDates = useMemo(() => new Set(leaveByDate.keys()), [leaveByDate]);

  const weekOffDates = useMemo(() => {
    const set = new Set<string>();
    const perDate = dailyShiftByDate.get(employeeId);
    if (perDate) {
      for (const [date, shiftId] of perDate) if (shiftId === null) set.add(date);
    }
    const perWeekday = weeklyPattern.get(employeeId);
    if (perWeekday?.size) {
      const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      for (const date of datesBetween(windowStart, today)) {
        if (perDate?.has(date)) continue;
        const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
        if (perWeekday.get(weekday) === null) set.add(date);
      }
    }
    return set;
  }, [dailyShiftByDate, employeeId, weeklyPattern]);

  const todayKey = useMemo(() => localDateKey(new Date().toISOString()), []);

  const summaryByDate = useMemo(() => {
    const map = new Map<string, PayrollSummary>();
    for (const s of summaries) map.set(s.work_date, s);
    return map;
  }, [summaries]);

  const monthSummary = useMemo(() => {
    const hours: CardEntry[] = [];
    const late: CardEntry[] = [];
    const early: CardEntry[] = [];
    const overtime: CardEntry[] = [];
    const present: CardEntry[] = [];
    const absent: CardEntry[] = [];
    let totalWorkMinutes = 0;
    let overtimeMinutes = 0;

    for (const date of visibleDates) {
      if (leaveDates.has(date) || weekOffDates.has(date) || companyWeekOffDates.has(date)) continue;
      // A summary row with no check_in isn't a worked day (nightly job swept
      // in a Week Off / Absent day, or the punch was claimed by the previous
      // day's overnight shift) — ignore it here.
      const rawSummary = date !== todayKey ? summaryByDate.get(date) : undefined;
      const summary = rawSummary && rawSummary.check_in ? rawSummary : undefined;
      const status = dayStatus.get(date);
      if (summary || status) {
        present.push({ date, minutes: 0 });
        const dayTotalMinutes = summary ? Math.round(Number(summary.total_hours) * 60) : status!.totalMinutes;
        const dayOvertimeMinutes = summary ? Math.round(Number(summary.overtime_hours) * 60) : status!.overtimeMinutes;
        const hasOut = summary ? !!summary.check_out : status!.hasOut;
        if (hasOut) {
          hours.push({ date, minutes: dayTotalMinutes });
          totalWorkMinutes += dayTotalMinutes;
        }
        const isLate = summary ? summary.is_late : status!.isLate;
        const lateMinutes = summary ? summary.late_minutes : status!.lateMinutes;
        const isEarly = summary ? summary.is_early_departure : status!.isEarly;
        const earlyMinutes = summary ? summary.early_departure_minutes : status!.earlyMinutes;
        if (isLate) late.push({ date, minutes: lateMinutes });
        if (isEarly) early.push({ date, minutes: earlyMinutes });
        if (dayOvertimeMinutes > 0) {
          overtime.push({ date, minutes: dayOvertimeMinutes });
          overtimeMinutes += dayOvertimeMinutes;
        }
      } else if (date <= todayKey) {
        absent.push({ date, minutes: 0 });
      }
    }
    const byDateDesc = (a: CardEntry, b: CardEntry) => b.date.localeCompare(a.date);
    return {
      totalWorkMinutes,
      overtimeMinutes,
      entries: {
        hours: hours.sort(byDateDesc),
        late: late.sort(byDateDesc),
        early: early.sort(byDateDesc),
        overtime: overtime.sort(byDateDesc),
        present: present.sort(byDateDesc),
        absent: absent.sort(byDateDesc),
      } as Record<CardKey, CardEntry[]>,
    };
  }, [visibleDates, dayStatus, leaveDates, weekOffDates, companyWeekOffDates, summaryByDate, todayKey]);

  const tableRows: TableRow[] = useMemo(
    () =>
      visibleDates.map(date => {
        const onLeave = leaveDates.has(date) || weekOffDates.has(date) || companyWeekOffDates.has(date);
        if (onLeave) {
          return { date, onLeave: true, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, present: false, absent: false };
        }
        const summary = date !== todayKey ? summaryByDate.get(date) : undefined;
        if (summary && summary.check_in) {
          return {
            date,
            onLeave: false,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: Number(summary.total_hours),
            overtime: Number(summary.overtime_hours),
            lateMinutes: summary.is_late ? summary.late_minutes : 0,
            earlyMinutes: summary.is_early_departure ? summary.early_departure_minutes : 0,
            present: true,
            absent: false,
          };
        }
        const status = dayStatus.get(date);
        if (!status) {
          return { date, onLeave: false, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, present: false, absent: date <= todayKey };
        }
        return {
          date,
          onLeave: false,
          checkIn: status.checkIn.punch_time,
          checkOut: status.checkOut?.punch_time ?? null,
          hours: status.totalMinutes / 60,
          overtime: status.overtimeMinutes / 60,
          lateMinutes: status.lateMinutes,
          earlyMinutes: status.earlyMinutes,
          present: true,
          absent: false,
        };
      }),
    [visibleDates, leaveDates, weekOffDates, companyWeekOffDates, dayStatus, summaryByDate, todayKey]
  );

  const chartData = useMemo(
    () => tableRows.map(row => ({ label: formatDdMmYyyy(row.date, system).slice(0, 2), value: row.present ? row.hours : 0 })),
    [tableRows, system]
  );

  const selectedLeave = selectedDate ? leaveByDate.get(selectedDate) ?? null : null;
  const selectedDaySummary = useMemo(() => {
    if (dayLogs.length === 0 || !employee || !selectedDate) return null;
    const resolved = resolveShiftForDate(employee, shifts, selectedDate, dailyShiftByDate, companyWeekOffDates, weeklyPattern);
    return computeDayStatusForResolvedShift(dayLogs, resolved);
  }, [dayLogs, employee, shifts, selectedDate, dailyShiftByDate, companyWeekOffDates, weeklyPattern]);

  useEffect(() => {
    if (!selectedDate) {
      setDayLogs([]);
      return;
    }
    const start = `${selectedDate}T00:00:00`;
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', start)
      .lt('punch_time', end)
      .order('punch_time', { ascending: true })
      .then(({ data }) => setDayLogs((data as AttendanceLog[]) ?? []));
  }, [selectedDate, employeeId]);

  // Per-employee roster Week Off + company-wide Week-off, merged for the
  // calendar's visual "week off" coloring.
  const mergedWeekOffDates = useMemo(() => new Set([...weekOffDates, ...companyWeekOffDates]), [weekOffDates, companyWeekOffDates]);

  function cardValue(key: CardKey) {
    if (key === 'hours') return formatHoursMinutes(monthSummary.totalWorkMinutes);
    if (key === 'overtime') return formatHoursMinutes(monthSummary.overtimeMinutes);
    const count = monthSummary.entries[key].length;
    return `${count} day${count === 1 ? '' : 's'}`;
  }

  function fmtTime(t: string | null) {
    return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–';
  }

  return (
    <>
      <MonthCalendarGrid
        dayStatus={dayStatus}
        leaveDates={leaveDates}
        weekOffDates={mergedWeekOffDates}
        selectedDate={selectedDate}
        onSelectDate={d => setSelectedDate(cur => (cur === d ? null : d))}
        onMonthChange={setVisibleDates}
      />

      {selectedDate && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{formatAdDate(selectedDate, system)}</Text>
          {selectedLeave && (
            <View style={styles.leaveBanner}>
              <Text style={styles.leaveBannerLabel}>On Leave</Text>
              <Text style={styles.leaveBannerType}>{selectedLeave.leave_type}</Text>
            </View>
          )}
          {!selectedDaySummary && !selectedLeave && <Text style={styles.dim}>No punches recorded.</Text>}
          {selectedDaySummary && (
            <View style={{ gap: 10 }}>
              <View style={styles.grid2}>
                <View style={[styles.detailCell, { backgroundColor: colors.goodBg }]}>
                  <Text style={[styles.detailCellLabel, { color: colors.goodText }]}>IN</Text>
                  <Text style={styles.detailCellValue}>
                    {new Date(selectedDaySummary.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {selectedDaySummary.isLate && <Badge tone="warning">Late {formatHoursMinutes(selectedDaySummary.lateMinutes)}</Badge>}
                </View>
                <View style={[styles.detailCell, { backgroundColor: colors.warningBg }]}>
                  <Text style={[styles.detailCellLabel, { color: colors.warningText }]}>OUT</Text>
                  <Text style={styles.detailCellValue}>
                    {selectedDaySummary.checkOut ? new Date(selectedDaySummary.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}
                  </Text>
                  {selectedDaySummary.isEarly && <Badge tone="critical">Early {formatHoursMinutes(selectedDaySummary.earlyMinutes)}</Badge>}
                </View>
              </View>
              <View style={styles.grid2}>
                <View style={[styles.detailCell, { backgroundColor: colors.goodBg }]}>
                  <Text style={[styles.detailCellLabel, { color: colors.goodText }]}>Total Work Hours</Text>
                  <Text style={styles.detailCellValue}>{formatHoursMinutes(selectedDaySummary.totalMinutes)}</Text>
                </View>
                <View style={[styles.detailCell, { backgroundColor: colors.infoBg }]}>
                  <Text style={[styles.detailCellLabel, { color: colors.infoText }]}>Overtime</Text>
                  <Text style={styles.detailCellValue}>{formatHoursMinutes(selectedDaySummary.overtimeMinutes)}</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      <Text style={styles.sectionHeading}>This Month</Text>
      <View style={styles.statsGrid}>
        {(Object.keys(CARD_STYLES) as CardKey[]).map(key => {
          const style = CARD_STYLES[key];
          const open = expandedCard === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.statCard, { backgroundColor: style.bg }, open && styles.statCardOpen]}
              onPress={() => setExpandedCard(open ? null : key)}
            >
              <Text style={[styles.statValue, { color: style.text }]}>{cardValue(key)}</Text>
              <Text style={styles.statLabel}>{style.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tableRows.length > 0 && (
        <View style={styles.tableCard}>
          <View style={styles.reportHeader}>
            <Text style={[styles.reportTh, { flex: 0.14 }]}>Date</Text>
            <Text style={[styles.reportTh, { flex: 0.22 }]}>In / Out</Text>
            <Text style={[styles.reportTh, { flex: 0.13 }]}>Late</Text>
            <Text style={[styles.reportTh, { flex: 0.13 }]}>Early</Text>
            <Text style={[styles.reportTh, { flex: 0.16 }]}>Status</Text>
            <Text style={[styles.reportTh, { flex: 0.11 }]}>OT</Text>
            <Text style={[styles.reportTh, { flex: 0.11 }]}>Hrs</Text>
          </View>
          {tableRows.map((row, i) => (
            <View key={row.date} style={[styles.reportRow, i % 2 === 1 && styles.reportRowAlt]}>
              <Text style={[styles.reportTd, { flex: 0.14 }]}>{formatDdMmYyyy(row.date, system).slice(0, 5)}</Text>
              <Text style={[styles.reportTd, { flex: 0.22 }]}>{row.onLeave ? '—' : `${fmtTime(row.checkIn)}-${fmtTime(row.checkOut)}`}</Text>
              <Text style={[styles.reportTd, { flex: 0.13, color: colors.warningText }]}>
                {row.present && row.lateMinutes > 0 ? formatHoursMinutes(row.lateMinutes) : '—'}
              </Text>
              <Text style={[styles.reportTd, { flex: 0.13, color: colors.criticalText }]}>
                {row.present && row.earlyMinutes > 0 ? formatHoursMinutes(row.earlyMinutes) : '—'}
              </Text>
              <Text
                style={[
                  styles.reportTd,
                  { flex: 0.16 },
                  row.onLeave ? { color: '#7e22ce' } : row.present ? { color: colors.goodText } : row.absent ? { color: colors.criticalText } : styles.dim,
                ]}
              >
                {row.onLeave ? 'On Leave' : row.present ? 'Present' : row.absent ? 'Absent' : '—'}
              </Text>
              <Text style={[styles.reportTd, { flex: 0.11, color: colors.infoText }]}>{row.present ? formatHoursMinutes(Math.round(row.overtime * 60)) : '—'}</Text>
              <Text style={[styles.reportTd, { flex: 0.11 }]}>{row.present ? formatHoursMinutes(Math.round(row.hours * 60)) : '—'}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.chartCard}>
        <View style={styles.chartHeaderRow}>
          <Text style={styles.sectionHeadingTight}>Hours Trend</Text>
          <Text style={styles.chartHint}>Scroll to see all days →</Text>
        </View>
        {chartData.length === 0 ? (
          <Text style={styles.dim}>No data to chart yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ width: Math.max(chartData.length * 24, 320) }}>
              <SimpleLineChart data={chartData} height={160} formatValue={v => formatHoursMinutes(Math.round(v * 60))} />
            </View>
          </ScrollView>
        )}
      </View>

      {expandedCard && (
        <View style={styles.expandedCard}>
          <Text style={styles.expandedTitle}>{CARD_STYLES[expandedCard].label}</Text>
          {monthSummary.entries[expandedCard].length === 0 ? (
            <Text style={styles.dim}>Nothing to show for this month.</Text>
          ) : (
            monthSummary.entries[expandedCard].map(entry => {
              const day = dayStatus.get(entry.date);
              return (
                <View key={entry.date} style={styles.expandedRow}>
                  <Text style={styles.expandedDate}>{formatAdDate(entry.date, system)}</Text>
                  {!day && <Badge tone="neutral">Absent</Badge>}
                  {day?.isLate && <Badge tone="warning">Late</Badge>}
                </View>
              );
            })
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dim: { fontSize: 12, color: colors.slate400 },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 18, marginBottom: 10 },
  sectionHeadingTight: { fontSize: 13, fontWeight: '700', color: colors.ink },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: {
    flexBasis: '31%',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  statCardOpen: { borderColor: colors.accent },
  statValue: { fontSize: 14, fontWeight: '700' },
  statLabel: { fontSize: 9, color: colors.ink, marginTop: 3, fontWeight: '600' },
  detailCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  detailTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  leaveBanner: { backgroundColor: '#f3e8ff', borderRadius: 12, padding: 10, marginBottom: 10 },
  leaveBannerLabel: { fontSize: 11, fontWeight: '600', color: '#7e22ce' },
  leaveBannerType: { fontSize: 15, fontWeight: '700', color: colors.ink, textTransform: 'capitalize' },
  grid2: { flexDirection: 'row', gap: 10 },
  detailCell: { flex: 1, borderRadius: 12, padding: 10 },
  detailCellLabel: { fontSize: 11, fontWeight: '600' },
  detailCellValue: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 2, marginBottom: 4 },
  tableCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  reportHeader: { flexDirection: 'row', backgroundColor: colors.slate50, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
  reportTh: { fontSize: 8, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', paddingHorizontal: 2 },
  reportRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  reportRowAlt: { backgroundColor: colors.slate50 },
  reportTd: { fontSize: 10, color: colors.slate500, paddingHorizontal: 2 },
  chartCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  chartHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  chartHint: { fontSize: 10, color: colors.slate400 },
  expandedCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  expandedTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  expandedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.slate100 },
  expandedDate: { fontSize: 14, color: colors.ink, fontWeight: '600' },
});
