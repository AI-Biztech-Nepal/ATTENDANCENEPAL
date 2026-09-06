import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS } from '../types';
import { colors } from '../theme';
import StatCard from '../components/StatCard';
import SimpleLineChart from '../components/SimpleLineChart';
import SimplePieChart from '../components/SimplePieChart';
import { dateKey, firstCheckIn, isLate, presentEmployeeIds } from '../lib/metrics';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  isWeekOff,
  nepalTodayIso,
  punchTypeLabel,
  resolveShiftForDate,
  type DailyShiftByDate,
  type WeeklyPatternByEmployee,
} from '../lib/shift';
import { fetchMyCompanyWeekOffConfig, weekOffDatesByGender } from '../lib/weekOff';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';

type EmployeeLite = Pick<Employee, 'name' | 'profile_photo_url'>;
type DetailRow = { id: string; primary: string; secondary?: string };
type DetailKey = 'total' | 'present' | 'late' | 'leave' | 'absent' | 'hours' | 'overtime';

const DEPT_COLORS: Record<string, string> = {
  Engineering: '#0d9488',
  Operations: '#2563eb',
  Marketing: '#f97316',
  Sales: '#a855f7',
  Support: '#ec4899',
};
const OTHER_COLOR = '#94a3b8';
const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function last7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default function DashboardScreen({ navigation }: any) {
  const { system } = useCalendarSystem();
  const [feed, setFeed] = useState<AttendanceLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeLookup, setEmployeeLookup] = useState<Record<string, EmployeeLite>>({});
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [onLeave, setOnLeave] = useState<LeaveRequest[]>([]);
  const [todayRoster, setTodayRoster] = useState<{ employee_id: string; shift_id: string | null }[]>([]);
  const [weekLogs, setWeekLogs] = useState<AttendanceLog[]>([]);
  const [detailKey, setDetailKey] = useState<DetailKey | null>(null);
  const [photoFailed, setPhotoFailed] = useState<Set<string>>(new Set());
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);

  useEffect(() => {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const today = nepalTodayIso();

    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode }) => {
      setWeeklyOffDay(weeklyOffDay);
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows((data as any) ?? []));
      }
    });
    supabase
      .from('company_holidays')
      .select('*')
      .gte('holiday_date', since.toISOString().slice(0, 10))
      .then(({ data }) => setHolidays((data as CompanyHoliday[]) ?? []));
    supabase
      .from('employees')
      .select('*')
      .then(({ data }) => {
        setEmployees((data as Employee[]) ?? []);
        const map: Record<string, EmployeeLite> = {};
        for (const e of data ?? []) map[e.id] = { name: e.name, profile_photo_url: e.profile_photo_url };
        setEmployeeLookup(map);
      });
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
      .then(({ data }) => setOnLeave((data as LeaveRequest[]) ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('employee_id, shift_id')
      .eq('work_date', today)
      .then(({ data }) => setTodayRoster(data ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .gte('punch_time', since.toISOString())
      .order('punch_time', { ascending: false })
      .then(({ data }) => {
        const logs = (data as AttendanceLog[]) ?? [];
        setWeekLogs(logs);
        setFeed(logs.slice(0, 20));
      });

    const channel = supabase
      .channel('attendance-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
        payload => {
          const log = payload.new as AttendanceLog;
          setFeed(prev => [log, ...prev].slice(0, 20));
          setWeekLogs(prev => [log, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  const today = nepalTodayIso();
  const todayLogs = useMemo(() => weekLogs.filter(l => dateKey(l.punch_time) === today), [weekLogs, today]);
  const presentIds = useMemo(() => presentEmployeeIds(weekLogs, today), [weekLogs, today]);
  const onLeaveIds = useMemo(() => new Set(onLeave.map(l => l.employee_id)), [onLeave]);
  const attendancePct = activeEmployees.length ? Math.round((presentIds.size / activeEmployees.length) * 100) : 0;

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of todayRoster) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(today, r.shift_id);
    }
    return map;
  }, [todayRoster, today]);

  // Company-wide Week-off (recurring day + ad-hoc holidays) — distinct from
  // the per-employee roster Week Off (dailyShiftByDate) and approved Leave
  // (onLeaveIds) below, but treated identically to a roster Week Off
  // wherever a resolved shift matters, so someone who does show up on a
  // company-wide off day isn't marked Late against a shift they were never
  // expecting to work.
  // Per-employee: a gender-scoped holiday today (e.g. Teej) is a day off only
  // for the employees it covers. The base set (no gender) drives the plain
  // "today is a company off-day" banner.
  const weekOffDatesFor = useMemo(
    () => weekOffDatesByGender(today, today, weeklyOffDay, holidays),
    [today, weeklyOffDay, holidays]
  );
  const companyWeekOffDates = useMemo(() => weekOffDatesFor(null), [weekOffDatesFor]);
  const todayIsWeekOff = companyWeekOffDates.has(today);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

  const lateEmployees = useMemo(() => {
    const rows: DetailRow[] = [];
    for (const emp of activeEmployees) {
      const empLogs = todayLogs.filter(l => l.employee_id === emp.id);
      if (!empLogs.length || !isLate(emp, shifts, empLogs, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern)) continue;
      const checkIn = firstCheckIn(empLogs);
      rows.push({
        id: emp.id,
        primary: emp.name,
        secondary: checkIn ? `In at ${new Date(checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined,
      });
    }
    return rows;
  }, [activeEmployees, todayLogs, shifts, today, dailyShiftByDate, weekOffDatesFor, weeklyPattern]);
  const lateCount = lateEmployees.length;

  // todayIsWeekOff only covers the COMPANY-wide off day — an employee can
  // also have their own per-employee roster Week Off for today specifically
  // (an employee_daily_shifts row, or an employee_weekly_pattern row in
  // 'weekly' roster_mode) with no company-wide off day in effect at all.
  // Without resolving each employee's own shift here, someone on a roster
  // Week Off who hasn't punched in showed up as "Absent" even though the
  // admin dashboard/Payroll/My Calendar already knew to call them Week Off.
  const absentRows = useMemo<DetailRow[]>(
    () =>
      todayIsWeekOff
        ? []
        : activeEmployees
            .filter(
              emp =>
                !presentIds.has(emp.id) &&
                !onLeaveIds.has(emp.id) &&
                !isWeekOff(resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern))
            )
            .map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? undefined })),
    [activeEmployees, presentIds, onLeaveIds, todayIsWeekOff, shifts, today, dailyShiftByDate, weekOffDatesFor, weeklyPattern]
  );
  const absentCount = absentRows.length;

  const totalEmployeeRows = useMemo<DetailRow[]>(
    () => activeEmployees.map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? emp.employee_code })),
    [activeEmployees]
  );

  const presentRows = useMemo<DetailRow[]>(() => {
    const rows: DetailRow[] = [];
    for (const emp of activeEmployees) {
      if (!presentIds.has(emp.id)) continue;
      const checkIn = firstCheckIn(todayLogs.filter(l => l.employee_id === emp.id));
      rows.push({
        id: emp.id,
        primary: emp.name,
        secondary: checkIn ? `In at ${new Date(checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined,
      });
    }
    return rows;
  }, [activeEmployees, presentIds, todayLogs]);

  const leaveRows = useMemo<DetailRow[]>(() => {
    const byId = new Map(employees.map(e => [e.id, e.name]));
    return onLeave.map(l => ({
      id: l.id,
      primary: byId.get(l.employee_id) ?? 'Unknown',
      secondary: `${l.leave_type} · until ${formatAdDate(l.end_date, system)}`,
    }));
  }, [onLeave, employees, system]);

  const todayDayStatus = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeDayStatusForResolvedShift>>();
    for (const emp of activeEmployees) {
      const empLogs = weekLogs.filter(l => l.employee_id === emp.id);
      if (empLogs.length === 0) continue;
      const byDate = new Map<string, AttendanceLog[]>();
      for (const log of empLogs) {
        const key = dateKey(log.punch_time);
        const list = byDate.get(key);
        if (list) list.push(log);
        else byDate.set(key, [log]);
      }
      const weekOffDates = weekOffDatesFor(emp.gender);
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, weekOffDates, weeklyPattern);
      const dayLogs = byDate.get(today);
      if (!dayLogs || dayLogs.length === 0) continue;
      const resolved = resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDates, weeklyPattern);
      map.set(emp.id, computeDayStatusForResolvedShift(dayLogs, resolved));
    }
    return map;
  }, [activeEmployees, weekLogs, shifts, dailyShiftByDate, today, weekOffDatesFor, weeklyPattern]);

  const workHoursRows = useMemo<DetailRow[]>(() => {
    const entries: { id: string; name: string; hours: number }[] = [];
    for (const emp of activeEmployees) {
      const status = todayDayStatus.get(emp.id);
      if (!status?.hasOut) continue;
      entries.push({ id: emp.id, name: emp.name, hours: status.totalMinutes / 60 });
    }
    return entries.sort((a, b) => b.hours - a.hours).map(e => ({ id: e.id, primary: e.name, secondary: `${e.hours.toFixed(1)} hrs` }));
  }, [activeEmployees, todayDayStatus]);

  const overtimeRows = useMemo<DetailRow[]>(() => {
    const entries: { id: string; name: string; ot: number }[] = [];
    for (const emp of activeEmployees) {
      const status = todayDayStatus.get(emp.id);
      if (!status || status.overtimeMinutes <= 0) continue;
      entries.push({ id: emp.id, name: emp.name, ot: status.overtimeMinutes / 60 });
    }
    return entries.sort((a, b) => b.ot - a.ot).map(e => ({ id: e.id, primary: e.name, secondary: `${e.ot.toFixed(1)} hrs OT` }));
  }, [activeEmployees, todayDayStatus]);

  const detailPanels: Record<DetailKey, { title: string; rows: DetailRow[]; emptyText: string }> = {
    total: { title: 'Total Employees', rows: totalEmployeeRows, emptyText: 'No active employees.' },
    present: { title: 'Present Today', rows: presentRows, emptyText: 'Nobody has checked in yet today.' },
    late: { title: 'Late Arrivals', rows: lateEmployees, emptyText: 'No late arrivals today.' },
    leave: { title: 'On Leave Today', rows: leaveRows, emptyText: 'Nobody is on approved leave today.' },
    absent: { title: 'Absent Today', rows: absentRows, emptyText: 'No one is absent — everyone is present or on leave.' },
    hours: { title: 'Total Work Hours', rows: workHoursRows, emptyText: 'No work hours recorded yet today.' },
    overtime: { title: 'Overtime', rows: overtimeRows, emptyText: 'No overtime recorded today.' },
  };

  const todayWorkHours = useMemo(() => {
    let sum = 0;
    for (const status of todayDayStatus.values()) if (status.hasOut) sum += status.totalMinutes / 60;
    return sum;
  }, [todayDayStatus]);

  const todayOvertimeHours = useMemo(() => {
    let sum = 0;
    for (const status of todayDayStatus.values()) sum += status.overtimeMinutes / 60;
    return sum;
  }, [todayDayStatus]);

  const trend = useMemo(() => {
    return last7Days().map(day => {
      const count = presentEmployeeIds(weekLogs, day).size;
      const weekday = WEEKDAY_LABEL[new Date(day + 'T00:00:00Z').getUTCDay()];
      return { label: weekday, value: count };
    });
  }, [weekLogs]);

  const deptBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const emp of activeEmployees) {
      const key = emp.department && DEPT_COLORS[emp.department] ? emp.department : emp.department ? 'Other' : 'Unassigned';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value, color: DEPT_COLORS[name] ?? OTHER_COLOR }));
  }, [activeEmployees]);

  return (
    <View style={styles.container}>
      <FlatList
        data={feed}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.statsGrid}>
              <StatCard label="Total Employees" value={String(activeEmployees.length)} hint="Active rosters" onPress={() => setDetailKey('total')} />
              <StatCard label="Present Today" value={String(presentIds.size)} hint={`${attendancePct}% attendance`} onPress={() => setDetailKey('present')} />
              <StatCard label="Late Arrivals" value={String(lateCount)} hint="Past grace period" onPress={() => setDetailKey('late')} />
              <StatCard label="On Leave" value={String(onLeaveIds.size)} hint="Approved today" onPress={() => setDetailKey('leave')} />
              <StatCard label="Absent Today" value={String(absentCount)} hint="No punch, not on leave" onPress={() => setDetailKey('absent')} />
              <StatCard label="Total Work Hours" value={todayWorkHours.toFixed(1)} hint="Today, all staff" onPress={() => setDetailKey('hours')} />
              <StatCard label="Overtime" value={`${todayOvertimeHours.toFixed(1)} hrs`} hint="Today, all staff" onPress={() => setDetailKey('overtime')} />
            </View>

            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>Weekly Attendance Trend</Text>
              <SimpleLineChart data={trend} />
            </View>

            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>Department Breakdown</Text>
              {deptBreakdown.length === 0 ? <Text style={styles.empty}>No employees yet.</Text> : <SimplePieChart data={deptBreakdown} />}
            </View>

            <TouchableOpacity
              style={styles.viewLogsButton}
              onPress={() => navigation.getParent()?.navigate('Attendance' as never)}
            >
              <Text style={styles.viewLogsText}>View Full Logs</Text>
            </TouchableOpacity>
            <Text style={styles.heading}>Live Biometric Feed</Text>
          </>
        }
        renderItem={({ item }) => {
          const emp = employeeLookup[item.employee_id];
          const name = emp?.name ?? 'Unknown';
          const isIn = item.punch_type === '0';
          return (
            <View style={styles.row}>
              {emp?.profile_photo_url && !photoFailed.has(item.employee_id) ? (
                <Image
                  source={{ uri: emp.profile_photo_url }}
                  style={styles.avatarImage}
                  onError={() => setPhotoFailed(prev => new Set(prev).add(item.employee_id))}
                />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.time}>
                  {new Date(item.punch_time).toLocaleTimeString()} · {item.method}
                </Text>
              </View>
              <View style={[styles.typeBadge, isIn ? styles.typeInBg : styles.typeOutBg]}>
                <Text style={isIn ? styles.typeInText : styles.typeOutText}>
                  {punchTypeLabel(item.punch_type)}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No punches yet.</Text>}
      />

      <Modal visible={!!detailKey} transparent animationType="fade" onRequestClose={() => setDetailKey(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setDetailKey(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.detailSheet}>
            {detailKey && (
              <>
                <Text style={styles.detailTitle}>{detailPanels[detailKey].title}</Text>
                <FlatList
                  data={detailPanels[detailKey].rows}
                  keyExtractor={r => r.id}
                  style={{ maxHeight: 400 }}
                  renderItem={({ item }) => (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailPrimary}>{item.primary}</Text>
                      {item.secondary ? <Text style={styles.detailSecondary}>{item.secondary}</Text> : null}
                    </View>
                  )}
                  ListEmptyComponent={<Text style={styles.empty}>{detailPanels[detailKey].emptyText}</Text>}
                />
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50, padding: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  chartCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginBottom: 12 },
  chartTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  viewLogsButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16, marginTop: 4 },
  viewLogsText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  heading: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  list: { paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  avatarImage: { height: 36, width: 36, borderRadius: 18, backgroundColor: colors.slate200 },
  avatar: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  name: { fontSize: 14, fontWeight: '600', color: colors.ink },
  time: { fontSize: 12, color: colors.slate500, marginTop: 1 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeInBg: { backgroundColor: colors.goodBg },
  typeOutBg: { backgroundColor: colors.infoBg },
  typeInText: { fontSize: 11, fontWeight: '700', color: colors.goodText },
  typeOutText: { fontSize: 11, fontWeight: '700', color: colors.infoText },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  detailSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20, maxHeight: '75%' },
  detailTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  detailRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  detailPrimary: { fontSize: 13, fontWeight: '600', color: colors.ink },
  detailSecondary: { fontSize: 11, color: colors.slate500 },
});
