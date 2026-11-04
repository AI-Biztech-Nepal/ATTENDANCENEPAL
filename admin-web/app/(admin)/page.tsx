'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { timeAgo, usePendingApprovals, type PendingQueue } from '@/lib/pendingApprovals';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { AttendanceLog, CompanyHoliday, Device, Employee, LeaveRequest, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';
import { dateKey, firstCheckIn, isLate, last7Days, presentEmployeeIds, WEEKDAY_LABEL } from '@/lib/metrics';
import { fetchMyCompanyWeekOffConfig, weekOffDatesByGender } from '@/lib/weekOff';
import { fetchAll } from '@/lib/leaveBalance';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '@/lib/shift';

const DEPT_COLORS: Record<string, string> = {
  Engineering: '#0d9488',
  Operations: '#2563eb',
  Marketing: '#f97316',
  Sales: '#a855f7',
  Support: '#ec4899',
};
const OTHER_COLOR = '#94a3b8';

// Live activity rows: pastel initials circles, cycled per row.
const AVATAR_COLORS: [string, string][] = [
  ['#e0e7ff', '#3730a3'],
  ['#fce7f3', '#9d174d'],
  ['#dcfce7', '#166534'],
  ['#fef3c7', '#92400e'],
  ['#e0f2fe', '#075985'],
];
const PUNCH_VERB: Record<string, string> = { '0': 'checked in', '1': 'checked out', '2': 'started a break', '3': 'is back from break' };
const METHOD_LABEL: Record<string, string> = { zkteco: 'Biometric', gps: 'GPS', qr: 'QR code', selfie: 'Selfie' };
function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

type FeedItem = AttendanceLog & { employee_name: string };
type DetailRow = { id: string; primary: string; secondary?: string };
type DetailKey = 'total' | 'present' | 'late' | 'leave' | 'weekOff' | 'absent' | 'hours' | 'overtime';

export default function DashboardPage() {
  const router = useRouter();
  const { system } = useCalendarSystem();
  // Superadmins never see this tenant dashboard — any account listed in the
  // server-side SUPERADMIN_EMAILS allowlist gets bounced straight to
  // /superadmin instead, same gate /api/superadmin/* itself uses (see
  // app/superadmin/layout.tsx), so this stays in sync automatically for
  // every account entrusted with the role, not just one hardcoded email.
  const [checkingSuperadmin, setCheckingSuperadmin] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [onLeave, setOnLeave] = useState<LeaveRequest[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [todayRoster, setTodayRoster] = useState<{ employee_id: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [todayHoliday, setTodayHoliday] = useState<CompanyHoliday | null>(null);
  const [detailKey, setDetailKey] = useState<DetailKey | null>(null);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const pending = usePendingApprovals();
  // Top bar reads "DASHBOARD" over "Namaste, <first name>".
  const firstName = ownerName?.trim().split(/\s+/)[0];
  usePageTitle(`Namaste${firstName ? `, ${firstName}` : ''}`, 'Dashboard');

  useEffect(() => {
    if (!supabaseConfigured) {
      setCheckingSuperadmin(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const token = data.session?.access_token;
      if (!token) {
        setCheckingSuperadmin(false);
        return;
      }
      const res = await fetch('/api/superadmin/me', { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({ isSuperadmin: false }));
      if (!active) return;
      if (body.isSuperadmin) {
        router.replace('/superadmin');
        return;
      }
      setCheckingSuperadmin(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (checkingSuperadmin) return;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);

    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    const today = nepalTodayIso();
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
      .then(({ data }) => setOnLeave(data ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('employee_id, shift_id')
      .eq('work_date', today)
      .then(({ data }) => setTodayRoster(data ?? []));
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay }) => {
      setWeeklyOffDay(weeklyOffDay);
    });
    // Not date-scoped (a pattern applies to every week) — see
    // resolveShiftForDate(), which always falls back to it.
    supabase
      .from('employee_weekly_pattern')
      .select('employee_id, weekday, shift_id')
      .then(({ data }) => setWeeklyPatternRows(data ?? []));
    supabase.from('company_holidays').select('*').eq('holiday_date', today).maybeSingle().then(({ data }) => setTodayHoliday(data ?? null));
    // Branch names for the live activity and device rows.
    supabase.from('branches').select('id, name').then(({ data }) => setBranches(data ?? []));
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', data.user.id).single();
      setOwnerName(profile?.full_name ?? null);
    });
    // A week of punches for a busy/large company can pass PostgREST's
    // default 1000-row cap on a plain select(), which silently truncates
    // rather than erroring — quietly wrong present/late/absent KPIs and a
    // stale-looking activity feed. fetchAll pages through every row instead.
    fetchAll<AttendanceLog>((a, b) =>
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', since.toISOString()).order('punch_time', { ascending: false }).range(a, b)
    ).then(rows => setLogs(rows));

    const channel = supabase
      .channel('dashboard-live-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_logs' }, payload => {
        const log = payload.new as AttendanceLog;
        setLogs(prev => [log, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [checkingSuperadmin]);

  useEffect(() => {
    if (employees.length === 0) return;
    const byId = new Map(employees.map(e => [e.id, e.name]));
    setFeed(
      logs.slice(0, 8).map(log => ({ ...log, employee_name: byId.get(log.employee_id) ?? 'Unknown' }))
    );
  }, [logs, employees]);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  // Nepal calendar day, not the browser/UTC day — matches My Calendar and
  // Attendance Report, which already use nepalTodayIso() for the same
  // reason: a plain new Date().toISOString() boundary disagrees with Nepal
  // local time for roughly six hours a day.
  const today = nepalTodayIso();
  const todayLogs = useMemo(() => logs.filter(l => dateKey(l.punch_time) === today), [logs, today]);
  const presentIds = useMemo(() => presentEmployeeIds(logs, today), [logs, today]);

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

  // Company-wide Week-off: recurring weekly day (e.g. every Saturday) or an
  // ad-hoc holiday for today specifically. Distinct from per-employee roster
  // Week Off (dailyShiftByDate) and approved Leave (onLeaveIds) below — but
  // treated identically to a roster Week Off wherever a resolved shift
  // matters (isLate, applyOvernightShiftCorrection, resolveShiftForDate),
  // so someone who does show up on a company-wide off day isn't marked Late
  // against a shift they were never expecting to work.
  // Per-employee: a gender-scoped holiday today (e.g. Teej) is a day off only
  // for the employees it covers — everyone else works a normal day.
  const weekOffDatesFor = useMemo(
    () => weekOffDatesByGender(today, today, weeklyOffDay, todayHoliday ? [todayHoliday] : []),
    [today, weeklyOffDay, todayHoliday]
  );
  // The base set (weekly off-day + company-wide holidays only) — drives the
  // "nobody is absent today" banners, which shouldn't fire for a holiday that
  // only covers one gender.
  const companyWeekOffDates = useMemo(() => weekOffDatesFor(null), [weekOffDatesFor]);
  const todayIsWeekOff = companyWeekOffDates.has(today);
  const weeklyPattern = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

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

  const onLeaveIds = useMemo(() => new Set(onLeave.map(l => l.employee_id)), [onLeave]);
  const attendancePct = activeEmployees.length ? Math.round((presentIds.size / activeEmployees.length) * 100) : 0;

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

  // todayIsWeekOff only covers the COMPANY-wide off day — an employee can
  // also have their own per-employee roster Week Off for today specifically
  // (an employee_daily_shifts row, or an employee_weekly_pattern row) with
  // no company-wide off day in effect at all.
  // Without resolving each employee's own shift here, someone on a roster
  // Week Off who hasn't punched in showed up as "Absent" on this dashboard
  // even though every other page (Payroll, My Calendar, the Attendance
  // Report) already knew to call them Week Off instead.
  const absentRows = useMemo<DetailRow[]>(
    () =>
      todayIsWeekOff
        ? []
        : activeEmployees
            .filter(
              emp =>
                !presentIds.has(emp.id) &&
                !onLeaveIds.has(emp.id) &&
                !emp.attendance_exempt &&
                !isWeekOff(resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern))
            )
            .map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? undefined })),
    [activeEmployees, presentIds, onLeaveIds, todayIsWeekOff, shifts, today, dailyShiftByDate, weekOffDatesFor, weeklyPattern]
  );
  const absentCount = absentRows.length;

  // Week-off Today should reflect how many employees actually have a day off
  // today — whether from the company-wide recurring/holiday off-day or from
  // their own per-employee roster Week Off — not just whether a company-wide
  // off-day is in effect.
  const weekOffRows = useMemo<DetailRow[]>(
    () =>
      activeEmployees
        .filter(emp => isWeekOff(resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern)))
        .map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? undefined })),
    [activeEmployees, shifts, today, dailyShiftByDate, weekOffDatesFor, weeklyPattern]
  );
  const weekOffCount = weekOffRows.length;

  // payroll_summaries only gets a row for a date once the nightly job (or a
  // manual "Recalculate month") has processed it — for TODAY that row never
  // exists yet, so Total Work Hours/Overtime must be computed live from raw
  // punches instead, same as My Calendar and the Attendance Report already
  // do, rather than reading a table that's always empty for today.
  const todayDayStatus = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeDayStatusForResolvedShift>>();
    for (const emp of activeEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
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
  }, [activeEmployees, logs, shifts, dailyShiftByDate, today, weekOffDatesFor, weeklyPattern]);

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
    weekOff: {
      title: 'Week-off Today',
      rows: weekOffRows,
      emptyText: 'No employees have a Week-off today.',
    },
    absent: {
      title: 'Absent Today',
      rows: absentRows,
      emptyText: todayIsWeekOff ? 'Today is a company Week-off — nobody is marked absent.' : 'No one is absent — everyone is present or on leave.',
    },
    hours: { title: 'Total Work Hours', rows: workHoursRows, emptyText: 'No work hours recorded yet today.' },
    overtime: { title: 'Overtime', rows: overtimeRows, emptyText: 'No overtime recorded today.' },
  };

  const todayWorkHours = useMemo(() => {
    let sum = 0;
    for (const status of todayDayStatus.values()) {
      if (status.hasOut) sum += status.totalMinutes / 60;
    }
    return sum;
  }, [todayDayStatus]);

  const todayOvertimeHours = useMemo(() => {
    let sum = 0;
    for (const status of todayDayStatus.values()) sum += status.overtimeMinutes / 60;
    return sum;
  }, [todayDayStatus]);

  const trend = useMemo(() => {
    return last7Days().map(day => {
      const count = presentEmployeeIds(logs, day).size;
      const weekday = WEEKDAY_LABEL[new Date(day + 'T00:00:00Z').getUTCDay()];
      return { day: weekday, present: count };
    });
  }, [logs]);

  const deptBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const emp of activeEmployees) {
      const key = emp.department && DEPT_COLORS[emp.department] ? emp.department : emp.department ? 'Other' : 'Unassigned';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value, color: DEPT_COLORS[name] ?? OTHER_COLOR }))
      .sort((a, b) => b.value - a.value);
  }, [activeEmployees]);

  if (checkingSuperadmin) {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  // Today's attendance bar: late arrivals are a subset of present, so on time
  // is the rest. Each count opens the same name list as before.
  const onTimeCount = Math.max(0, presentIds.size - lateCount);
  // `color` fills the bar; `ink` is the same hue darkened so a number or icon on its own tint reads at 4.5:1.
  const segments: { key: string; label: string; count: number; color: string; ink: string; icon: React.ReactNode; detail: DetailKey }[] = [
    { key: 'onTime', label: 'On time', count: onTimeCount, color: '#15803d', ink: '#166534', icon: <CheckCircleGlyph />, detail: 'present' },
    { key: 'late', label: 'Late', count: lateCount, color: '#d97706', ink: '#92400e', icon: <ClockGlyph />, detail: 'late' },
    { key: 'leave', label: 'On leave', count: onLeaveIds.size, color: '#2563eb', ink: '#1d4ed8', icon: <UmbrellaGlyph />, detail: 'leave' },
    { key: 'absent', label: 'Absent', count: absentCount, color: '#dc2626', ink: '#b91c1c', icon: <CrossCircleGlyph />, detail: 'absent' },
    { key: 'weekOff', label: 'Week-off', count: weekOffCount, color: '#94a3b8', ink: '#475569', icon: <MoonGlyph />, detail: 'weekOff' },
  ];
  const shareOf = (n: number) => (activeEmployees.length ? Math.round((n / activeEmployees.length) * 100) : 0);
  const allOnline = devices.length > 0 && devices.every(d => d.status === 'online');
  const onlineDevices = devices.filter(d => d.status === 'online').length;
  const branchName = (id: string | null) => branches.find(b => b.id === id)?.name ?? null;
  const deviceById = new Map(devices.map(d => [d.id, d]));
  const oldestText = (q: PendingQueue) => (q.oldest ? `Oldest ${timeAgo(q.oldest.created_at)}` : 'Nothing waiting');
  const leaveText = (q: PendingQueue) => {
    const o = q.oldest;
    if (!o?.leave_type || !o.start_date || !o.end_date) return 'Nothing waiting';
    const days = Math.round((new Date(o.end_date).getTime() - new Date(o.start_date).getTime()) / 86400000) + 1;
    return `${o.leave_type[0].toUpperCase()}${o.leave_type.slice(1)} · ${days} ${days === 1 ? 'day' : 'days'}`;
  };
  const approvals = [
    { label: 'GPS check-ins', count: pending.gps.count, sub: oldestText(pending.gps), href: '/corrections', icon: <PinGlyph /> },
    { label: 'Missed-punch corrections', count: pending.corrections.count, sub: oldestText(pending.corrections), href: '/corrections', icon: <PencilGlyph /> },
    { label: 'Leave requests', count: pending.leave.count, sub: leaveText(pending.leave), href: '/leave', icon: <UmbrellaGlyph /> },
  ];
  const kpis: { label: string; value: string; caption: string; detail: DetailKey }[] = [
    { label: 'Active staff', value: String(activeEmployees.length), caption: 'On active rosters', detail: 'total' },
    { label: 'Work hours today', value: `${todayWorkHours.toFixed(1)}h`, caption: 'All staff, checked out', detail: 'hours' },
    { label: 'Overtime today', value: `${todayOvertimeHours.toFixed(1)}h`, caption: 'Beyond shift hours', detail: 'overtime' },
    {
      label: 'Week-off today',
      value: String(weekOffCount),
      caption: todayIsWeekOff ? (todayHoliday?.name ?? 'Recurring weekly day') : 'Off by roster or holiday',
      detail: 'weekOff',
    },
  ];
  const [ty, tm, td] = today.split('-').map(Number);
  const todayLine = `${new Date(ty, tm - 1, td).toLocaleDateString(undefined, { weekday: 'short' })}, ${formatAdDate(today, 'AD')}  ·  ${formatAdDate(today, 'BS')}`;
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lastPunch = feed[0];
  const maxDept = Math.max(1, ...deptBreakdown.map(d => d.value));

  // The three tiles under the weekly chart, all read off the same seven days it draws.
  const weekTotal = trend.reduce((sum, d) => sum + d.present, 0);
  const weekAverage = trend.length ? Math.round((weekTotal / trend.length) * 10) / 10 : 0;
  const busiest = trend.reduce((best, d) => (d.present > best.present ? d : best), trend[0] ?? { day: '—', present: 0 });
  const presentToday = trend[trend.length - 1]?.present ?? 0;
  const presentYesterday = trend[trend.length - 2]?.present ?? 0;
  const dayDelta = presentToday - presentYesterday;
  const weekGlance = [
    { label: 'Daily average', value: String(weekAverage), sub: 'staff present per day', ink: '#064e3b' },
    { label: 'Busiest day', value: busiest.present > 0 ? busiest.day : '—', sub: busiest.present > 0 ? `${busiest.present} present` : 'No punches yet', ink: '#064e3b' },
    {
      label: 'Today vs yesterday',
      value: dayDelta > 0 ? `+${dayDelta}` : String(dayDelta),
      sub: `${presentToday} today · ${presentYesterday} yesterday`,
      ink: dayDelta > 0 ? '#166534' : dayDelta < 0 ? '#b91c1c' : '#475569',
    },
  ];

  return (
    <>
      <p className="mb-5 text-[13px] font-bold text-[#586474]">{todayLine}</p>

      <div className="flex flex-wrap gap-5">
        <section className="min-w-0 flex-[2_1_560px] rounded-[18px] border border-[#d5e6dc] bg-[linear-gradient(180deg,#eef8f2_0%,#ffffff_48%)] px-6 py-[22px] shadow-[0_1px_2px_rgba(6,78,59,0.04),0_8px_24px_-14px_rgba(6,78,59,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <h2 className="text-[13px] font-extrabold tracking-[0.06em] text-[#586474]">TODAY&apos;S ATTENDANCE</h2>
            {devices.length > 0 && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                  allOnline ? 'bg-[#e2f3e8] text-[#14532d]' : 'bg-[#fdf0d5] text-[#8a4b06]'
                }`}
              >
                <span className={`h-[7px] w-[7px] rounded-full ${allOnline ? 'bg-[#15803d]' : 'bg-[#d97706]'}`} />
                Devices {onlineDevices}/{devices.length} online
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
            <button
              onClick={() => setDetailKey('present')}
              className="text-[56px] font-extrabold leading-none tracking-[-0.03em] text-brand-deep hover:text-brand"
            >
              {presentIds.size}
            </button>
            <span className="text-lg font-bold text-[#586474]">of {activeEmployees.length} checked in</span>
            <span className="rounded-full bg-brand px-2.5 py-1 text-[13px] font-extrabold text-white">{attendancePct}%</span>
            {lastPunch && (
              <span className="ml-auto inline-flex items-center gap-2 self-center rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-[#586474] shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-50 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                </span>
                <span>
                  Last punch · <span className="font-extrabold text-ink">{lastPunch.employee_name}</span> {PUNCH_VERB[lastPunch.punch_type] ?? 'punched'} at {timeOf(lastPunch.punch_time)}
                </span>
              </span>
            )}
          </div>
          <div
            role="img"
            aria-label={segments.filter(s => s.count > 0).map(s => `${s.label} ${s.count}`).join(', ')}
            className="mt-[18px] flex h-4 gap-[3px] overflow-hidden rounded-full bg-slate-100"
          >
            {segments
              .filter(s => s.count > 0)
              .map((s, i) => (
                <span
                  key={s.key}
                  title={`${s.label} · ${s.count} (${shareOf(s.count)}%)`}
                  className="att-seg rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]"
                  style={{ flex: s.count, backgroundColor: s.color, animationDelay: `${i * 80}ms` }}
                />
              ))}
          </div>
          {/* Each tile wears its status: a tinted wash and hairline, a drawn icon (so the status is not
              colour alone), and the count in a darkened shade of the same hue. A status nobody is in goes
              quiet and grey so the tiles that matter stand out. The small % is the share of active staff. */}
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3">
            {segments.map(s => {
              const on = s.count > 0;
              return (
                <button
                  key={s.key}
                  onClick={() => setDetailKey(s.detail)}
                  style={on ? { backgroundColor: `${s.color}14`, borderColor: `${s.color}38` } : undefined}
                  className={`rounded-xl border px-3 py-2.5 text-left transition duration-200 hover:-translate-y-px hover:shadow-[0_8px_16px_-10px_rgba(15,23,42,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    on ? '' : 'border-slate-100 bg-slate-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ${on ? '' : 'bg-slate-100 text-slate-400'}`}
                      style={on ? { backgroundColor: `${s.color}22`, color: s.ink } : undefined}
                    >
                      {s.icon}
                    </span>
                    {on && <span className="text-[11px] font-bold text-[#586474]">{shareOf(s.count)}%</span>}
                  </span>
                  <span className={`mt-2 block text-[26px] font-extrabold leading-none ${on ? '' : 'text-[#7b8798]'}`} style={on ? { color: s.ink } : undefined}>
                    {s.count}
                  </span>
                  <span className={`mt-1 block text-xs font-bold ${on ? 'text-[#586474]' : 'text-slate-500'}`}>{s.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-w-0 flex-[1_1_340px] rounded-[18px] border border-slate-200 bg-white px-5 py-[18px]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-ink">Needs your approval</h2>
            {pending.total > 0 && (
              <span className="rounded-full bg-[#fee2e2] px-[9px] py-0.5 text-xs font-extrabold text-[#991b1b]">{pending.total} waiting</span>
            )}
          </div>
          <div className="mt-2 flex flex-col">
            {approvals.map((a, i) => (
              <Link
                key={a.label}
                href={a.href}
                className={`flex items-center gap-3 py-3 transition-opacity hover:opacity-80 ${i < approvals.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{a.label}</span>
                  <span className="block text-xs font-semibold text-[#586474]">{a.sub}</span>
                </span>
                <span
                  className={`rounded-full px-[9px] py-[3px] text-xs font-extrabold ${
                    a.count > 0 ? 'bg-[#fdf0d5] text-[#8a4b06]' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {a.count}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-5">
        {kpis.map(k => (
          <button
            key={k.label}
            onClick={() => setDetailKey(k.detail)}
            className="rounded-2xl border border-slate-200 bg-white px-[18px] py-4 text-left transition-colors hover:border-slate-300"
          >
            <div className="text-xs font-extrabold uppercase tracking-[0.05em] text-[#586474]">{k.label}</div>
            <div className="mt-1.5 text-[26px] font-extrabold text-ink">{k.value}</div>
            <div className="text-xs font-semibold text-[#586474]">{k.caption}</div>
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-5">
        <section className="flex min-w-0 flex-[2_1_560px] flex-col rounded-[18px] border border-slate-200 bg-white px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-ink">Weekly attendance</h2>
            <span className="text-xs font-bold text-[#586474]">Present each day · last 7 days</span>
          </div>
          {/* The Live activity card beside this one is taller, so the chart takes whatever height is left
              (never less than 230px) and the three week-at-a-glance tiles sit under it — no empty gap. */}
          <div className="relative mt-[18px] min-h-[230px] flex-1">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 22, right: 8, left: 8, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fontWeight: 700, fill: '#586474' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis hide allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v: number) => [`${v} present`, '']}
                />
                <Bar dataKey="present" radius={[8, 8, 3, 3]} maxBarSize={56} label={{ position: 'top', fontSize: 12, fontWeight: 800, fill: '#334155' }}>
                  {trend.map((d, i) => (
                    // Today in full emerald, the six days before it lighter.
                    <Cell key={`${d.day}-${i}`} fill={i === trend.length - 1 ? '#047857' : '#a7d0c4'} />
                  ))}
                </Bar>
              </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
            {weekGlance.map(g => (
              <div key={g.label} className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                <span className="block text-xs font-bold text-[#586474]">{g.label}</span>
                <span className="mt-0.5 block text-xl font-extrabold leading-tight" style={{ color: g.ink }}>
                  {g.value}
                </span>
                <span className="block text-xs font-semibold text-[#586474]">{g.sub}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="min-w-0 flex-[1_1_340px] rounded-[18px] border border-slate-200 bg-white px-5 py-[18px]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-ink">Live activity</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#15803d]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#15803d]" />
              Live
            </span>
          </div>
          <div className="mt-1.5 flex flex-col">
            {feed.length === 0 && <p className="py-3 text-sm text-slate-400">No punches yet.</p>}
            {feed.map((item, i) => {
              const [bg, fg] = AVATAR_COLORS[i % AVATAR_COLORS.length];
              const device = item.device_id ? deviceById.get(item.device_id) : undefined;
              const where = device ? (branchName(device.branch_id) ?? device.name) : null;
              const isToday = dateKey(item.punch_time) === today;
              return (
                <div key={item.id} className="flex items-center gap-3 border-b border-slate-100 py-2.5">
                  <span
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-xs font-extrabold"
                    style={{ backgroundColor: bg, color: fg }}
                  >
                    {initialsOf(item.employee_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">
                      {item.employee_name} {PUNCH_VERB[item.punch_type] ?? 'punched'}
                    </span>
                    <span className="block truncate text-xs font-semibold text-[#586474]">
                      {METHOD_LABEL[item.method] ?? item.method}
                      {where ? ` · ${where}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs font-bold text-[#586474]">
                    {isToday ? timeOf(item.punch_time) : `${formatAdDate(dateKey(item.punch_time), system)} ${timeOf(item.punch_time)}`}
                  </span>
                </div>
              );
            })}
            <Link href="/attendance" className="mt-2.5 text-[13px] font-extrabold text-brand hover:underline">
              Full attendance logs
            </Link>
          </div>
        </section>
      </div>

      <div className="mt-5 flex flex-wrap gap-5">
        <section className="min-w-0 flex-[1_1_420px] rounded-[18px] border border-slate-200 bg-white px-[22px] py-[18px]">
          <h2 className="text-base font-extrabold text-ink">Departments</h2>
          {deptBreakdown.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No employees yet.</p>
          ) : (
            <div className="mt-3.5 flex flex-col gap-3">
              {deptBreakdown.map(d => (
                <div key={d.name} className="flex items-center gap-3">
                  <span className="w-[110px] shrink-0 truncate text-[13px] font-bold text-ink">{d.name}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${(d.value / maxDept) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right text-[13px] font-extrabold text-ink">{d.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 flex-[1_1_420px] rounded-[18px] border border-slate-200 bg-white px-[22px] py-[18px]">
          <h2 className="text-base font-extrabold text-ink">Biometric devices</h2>
          <div className="mt-2 flex flex-col">
            {devices.length === 0 && <p className="py-3 text-sm text-slate-400">No devices registered.</p>}
            {devices.map((d, i) => (
              <div key={d.id} className={`flex items-center gap-3 py-3 ${i < devices.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{d.name}</span>
                  <span className="block text-xs font-semibold text-[#586474]">
                    {branchName(d.branch_id) ?? d.ip_address} · {d.last_sync ? `synced ${timeAgo(d.last_sync)}` : 'never synced'}
                  </span>
                </span>
                <span
                  className={`rounded-full px-[9px] py-[3px] text-xs font-extrabold ${
                    d.status === 'online' ? 'bg-[#e2f3e8] text-[#14532d]' : 'bg-[#fde2e1] text-[#991b1b]'
                  }`}
                >
                  {d.status === 'online' ? 'Online' : 'Offline'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {detailKey && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDetailKey(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">{detailPanels[detailKey].title}</h3>
              <button
                onClick={() => setDetailKey(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            {detailPanels[detailKey].rows.length === 0 ? (
              <p className="text-sm text-slate-400">{detailPanels[detailKey].emptyText}</p>
            ) : (
              <ul className="space-y-2">
                {detailPanels[detailKey].rows.map(row => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-ink">{row.primary}</span>
                    {row.secondary && <span className="shrink-0 text-xs text-slate-500">{row.secondary}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Icons for the "Needs your approval" rows.
function PinGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function PencilGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function CheckCircleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}
function ClockGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
function CrossCircleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </svg>
  );
}
function MoonGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}
function UmbrellaGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 18 0Z" />
      <path d="M12 12v7a2 2 0 0 1-4 0" />
    </svg>
  );
}
