import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS } from '../types';
import { colors } from '../theme';
import SimpleLineChart from '../components/SimpleLineChart';
import SimplePieChart from '../components/SimplePieChart';
import { dateKey, firstCheckIn, isLate, presentEmployeeIds } from '../lib/metrics';
import { fetchAll } from '../lib/leaveBalance';
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
import { formatAdDate, formatTodayLine } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { useAuth } from '../lib/AuthContext';
import { usePendingApprovals } from '../lib/PendingApprovals';
import { ChevronRightIcon, DeviceIcon, EditIcon, PinIcon, UmbrellaIcon } from '../components/icons';

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
  const { profile } = useAuth();
  const { counts: pending, refresh: refreshPending } = usePendingApprovals();
  const [deviceCounts, setDeviceCounts] = useState<{ online: number; total: number } | null>(null);
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
      .from('devices')
      .select('status')
      .then(({ data }) => {
        if (data?.length) setDeviceCounts({ online: data.filter(d => d.status === 'online').length, total: data.length });
      });
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
    // A week of punches for a busy/large company can pass PostgREST's
    // default 1000-row cap on a plain select(), which silently truncates
    // rather than erroring — quietly wrong present/late/absent KPIs and a
    // stale-looking activity feed. fetchAll pages through every row instead.
    fetchAll<AttendanceLog>((a, b) =>
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', since.toISOString()).order('punch_time', { ascending: false }).range(a, b)
    ).then(logs => {
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

  useEffect(() => navigation.addListener('focus', refreshPending), [navigation, refreshPending]);

  // Today's attendance bar: late arrivals are a subset of present, so on time
  // is the rest; whatever isn't present, on leave or absent (roster Week Off,
  // company off-day) is the grey remainder.
  const onTimeCount = Math.max(0, presentIds.size - lateCount);
  const restCount = Math.max(0, activeEmployees.length - presentIds.size - onLeaveIds.size - absentCount);
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];

  function openApprovals(segment?: 'gps' | 'correction' | 'leave') {
    navigation.getParent()?.navigate('ApprovalsTab', { screen: 'Approvals', params: segment ? { segment } : undefined });
  }

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
            <View style={styles.hero}>
              <Text style={styles.greeting} numberOfLines={1}>
                Namaste{firstName ? `, ${firstName}` : ''}
              </Text>
              <Text style={styles.heroDate}>{formatTodayLine(today)}</Text>
            </View>

            <View style={styles.body}>
              <View style={styles.summaryCard}>
                <View style={styles.summaryTop}>
                  <Text style={styles.cardLabel}>Today's attendance</Text>
                  {deviceCounts && (
                    <View style={styles.devices}>
                      <DeviceIcon size={14} color={colors.slate500} />
                      <Text style={styles.devicesText}>
                        Devices {deviceCounts.online}/{deviceCounts.total} online
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity style={styles.bigRow} onPress={() => setDetailKey('present')}>
                  <Text style={styles.bigNumber}>{presentIds.size}</Text>
                  <Text style={styles.bigOf}>of {activeEmployees.length} checked in</Text>
                  <View style={styles.pctPill}>
                    <Text style={styles.pctText}>{attendancePct}%</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.bar}>
                  {onTimeCount > 0 && <View style={{ flex: onTimeCount, backgroundColor: colors.good }} />}
                  {lateCount > 0 && <View style={{ flex: lateCount, backgroundColor: '#d97706' }} />}
                  {onLeaveIds.size > 0 && <View style={{ flex: onLeaveIds.size, backgroundColor: '#2563eb' }} />}
                  {absentCount > 0 && <View style={{ flex: absentCount, backgroundColor: '#dc2626' }} />}
                  {restCount > 0 && <View style={{ flex: restCount, backgroundColor: colors.slate200 }} />}
                </View>
                <View style={styles.legend}>
                  {(
                    [
                      ['present', onTimeCount, 'On time', colors.good],
                      ['late', lateCount, 'Late', '#d97706'],
                      ['leave', onLeaveIds.size, 'On leave', '#2563eb'],
                      ['absent', absentCount, 'Absent', '#dc2626'],
                    ] as const
                  ).map(([key, value, label, color]) => (
                    <TouchableOpacity key={key} style={styles.legendItem} onPress={() => setDetailKey(key)}>
                      <Text style={styles.legendValue}>{value}</Text>
                      <View style={styles.legendLabelRow}>
                        <View style={[styles.legendSwatch, { backgroundColor: color }]} />
                        <Text style={styles.legendLabel}>{label}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Needs your approval</Text>
                  <TouchableOpacity onPress={() => openApprovals()}>
                    <Text style={styles.link}>Review all</Text>
                  </TouchableOpacity>
                </View>
                {(
                  [
                    ['gps', 'GPS check-ins', pending.gps, PinIcon],
                    ['correction', 'Missed-punch corrections', pending.corrections, EditIcon],
                    ['leave', 'Leave requests', pending.leave, UmbrellaIcon],
                  ] as const
                ).map(([segment, label, count, Icon], i) => (
                  <TouchableOpacity key={segment} style={[styles.approvalRow, i < 2 && styles.rowDivider]} onPress={() => openApprovals(segment)}>
                    <View style={styles.approvalIcon}>
                      <Icon size={17} color={colors.accent} />
                    </View>
                    <Text style={styles.approvalLabel}>{label}</Text>
                    <View style={[styles.countPill, count === 0 && styles.countPillZero]}>
                      <Text style={[styles.countText, count === 0 && styles.countTextZero]}>{count}</Text>
                    </View>
                    <ChevronRightIcon color={colors.slate500} />
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.kpiRow}>
                <TouchableOpacity style={styles.kpi} onPress={() => setDetailKey('hours')}>
                  <Text style={styles.kpiValue}>{todayWorkHours.toFixed(1)}h</Text>
                  <Text style={styles.kpiLabel}>Work hours today</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.kpi} onPress={() => setDetailKey('overtime')}>
                  <Text style={styles.kpiValue}>{todayOvertimeHours.toFixed(1)}h</Text>
                  <Text style={styles.kpiLabel}>Overtime today</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.kpi} onPress={() => setDetailKey('total')}>
                  <Text style={styles.kpiValue}>{activeEmployees.length}</Text>
                  <Text style={styles.kpiLabel}>Active staff</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Weekly Attendance Trend</Text>
                <SimpleLineChart data={trend} />
              </View>

              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Department Breakdown</Text>
                {deptBreakdown.length === 0 ? <Text style={styles.empty}>No employees yet.</Text> : <SimplePieChart data={deptBreakdown} />}
              </View>

              <View style={styles.cardHeaderLoose}>
                <Text style={styles.cardTitle}>Live activity</Text>
                <TouchableOpacity onPress={() => navigation.getParent()?.navigate('MoreTab', { screen: 'Attendance', initial: false })}>
                  <Text style={styles.link}>Full logs</Text>
                </TouchableOpacity>
              </View>
            </View>
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
  container: { flex: 1, backgroundColor: colors.slate100 },
  hero: { backgroundColor: colors.accent, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 72 },
  greeting: { fontSize: 26, fontWeight: '800', color: colors.white, letterSpacing: -0.4 },
  heroDate: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  body: { paddingHorizontal: 20 },
  summaryCard: {
    marginTop: -56,
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 18,
    shadowColor: '#064e3b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardLabel: { fontSize: 12, fontWeight: '800', color: colors.slate500, textTransform: 'uppercase', letterSpacing: 0.6 },
  devices: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  devicesText: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  bigNumber: { fontSize: 40, fontWeight: '800', color: colors.ink, letterSpacing: -1 },
  bigOf: { fontSize: 16, fontWeight: '700', color: colors.slate500 },
  pctPill: { marginLeft: 'auto', alignSelf: 'center', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.goodBg },
  pctText: { fontSize: 12, fontWeight: '800', color: colors.goodText },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, marginTop: 14, backgroundColor: colors.slate100 },
  legend: { flexDirection: 'row', marginTop: 12 },
  legendItem: { flex: 1 },
  legendValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  legendLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { height: 7, width: 7, borderRadius: 2 },
  legendLabel: { fontSize: 11, fontWeight: '700', color: colors.slate500 },
  card: { marginTop: 14, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.slate200 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  cardHeaderLoose: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  link: { fontSize: 13, fontWeight: '800', color: colors.accent },
  approvalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  approvalIcon: { height: 36, width: 36, borderRadius: 18, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  approvalLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  countPill: { minWidth: 26, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.warningBg },
  countPillZero: { backgroundColor: colors.slate100 },
  countText: { fontSize: 12, fontWeight: '800', color: colors.warningText },
  countTextZero: { color: colors.slate500 },
  kpiRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  kpi: { flex: 1, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: 12, paddingVertical: 10 },
  kpiValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  kpiLabel: { fontSize: 11, fontWeight: '700', color: colors.slate500, marginTop: 1 },
  chartCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginTop: 14 },
  chartTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginBottom: 8 },
  list: { paddingBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    marginHorizontal: 20,
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
