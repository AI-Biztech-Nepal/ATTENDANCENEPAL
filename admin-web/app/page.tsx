'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import StatCard from '@/components/StatCard';
import Badge from '@/components/Badge';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { AttendanceLog, CompanyHoliday, Device, Employee, LeaveRequest, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';
import { dateKey, firstCheckIn, isLate, last7Days, presentEmployeeIds, WEEKDAY_LABEL } from '@/lib/metrics';
import { fetchMyCompanyWeekOffConfig, weekOffDatesByGender } from '@/lib/weekOff';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  isWeekOff,
  nepalTodayIso,
  punchTypeLabel,
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
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode }) => {
      setWeeklyOffDay(weeklyOffDay);
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
    supabase.from('company_holidays').select('*').eq('holiday_date', today).maybeSingle().then(({ data }) => setTodayHoliday(data ?? null));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .gte('punch_time', since.toISOString())
      .order('punch_time', { ascending: false })
      .then(({ data }) => setLogs(data ?? []));

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
  // (an employee_daily_shifts row, or an employee_weekly_pattern row in
  // 'weekly' roster_mode) with no company-wide off day in effect at all.
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
    return Array.from(counts.entries()).map(([name, value]) => ({
      name,
      value,
      color: DEPT_COLORS[name] ?? OTHER_COLOR,
    }));
  }, [activeEmployees]);

  if (checkingSuperadmin) {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  return (
    <AppShell title="Dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        <StatCard label="Total Employees" value={String(activeEmployees.length)} hint="Active rosters" onClick={() => setDetailKey('total')} />
        <StatCard label="Present Today" value={String(presentIds.size)} hint={`${attendancePct}% attendance`} onClick={() => setDetailKey('present')} />
        <StatCard label="Late Arrivals" value={String(lateCount)} hint="Past grace period" onClick={() => setDetailKey('late')} />
        <StatCard label="On Leave" value={String(onLeaveIds.size)} hint="Approved today" onClick={() => setDetailKey('leave')} />
        <StatCard
          label="Week-off Today"
          value={String(weekOffCount)}
          hint={todayIsWeekOff ? (todayHoliday?.name ?? 'Recurring weekly day') : 'Employees off today'}
          onClick={() => setDetailKey('weekOff')}
        />
        <StatCard label="Absent Today" value={String(absentCount)} hint="No punch, not on leave" onClick={() => setDetailKey('absent')} />
        <StatCard label="Total Work Hours" value={todayWorkHours.toFixed(1)} hint="Today, all staff" onClick={() => setDetailKey('hours')} />
        <StatCard
          className="col-span-2 sm:col-span-1"
          label="Overtime"
          value={`${todayOvertimeHours.toFixed(1)} hrs`}
          hint="Today, all staff"
          onClick={() => setDetailKey('overtime')}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-ink">Weekly Attendance Trend</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                formatter={(v: number) => [`${v} present`, '']}
              />
              <Line
                type="monotone"
                dataKey="present"
                name="Present"
                stroke="#0d9488"
                strokeWidth={2}
                dot={{ r: 4, fill: '#0d9488' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Live Biometric Feed</h2>
            <span className="flex items-center gap-1.5 text-xs font-medium text-good">
              <span className="h-1.5 w-1.5 rounded-full bg-good" />
              Realtime
            </span>
          </div>
          <ul className="space-y-3">
            {feed.length === 0 && <li className="text-sm text-slate-400">No punches yet.</li>}
            {feed.map(item => (
              <li key={item.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium text-ink">{item.employee_name}</div>
                  <div className="text-xs text-slate-500">{item.method}</div>
                </div>
                <div className="text-right">
                  <Badge tone={item.punch_type === '0' ? 'good' : item.punch_type === '1' ? 'info' : 'warning'}>
                    {punchTypeLabel(item.punch_type)}
                  </Badge>
                  <div className="mt-1 text-xs text-slate-500">
                    ({formatAdDate(localDateKey(item.punch_time), system)}{' '}
                    {new Date(item.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">Department Breakdown</h2>
          {deptBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400">No employees yet.</p>
          ) : (
            // A right-side vertical legend fights the pie for width on a
            // narrow phone (single-column below lg) — bottom-horizontal
            // works at every width instead of needing a JS breakpoint check.
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={deptBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {deptBreakdown.map(d => (
                    <Cell key={d.name} fill={d.color} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(value: string) => <span className="text-sm text-slate-600">{value}</span>}
                />
                <Tooltip formatter={(v: number, n: string) => [`${v} staff`, n]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">Device Sync Activity</h2>
          <ul className="space-y-3">
            {devices.length === 0 && <li className="text-sm text-slate-400">No devices registered.</li>}
            {devices.map(d => (
              <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-ink">{d.name}</div>
                  <div className="text-xs text-slate-500">
                    {d.ip_address} · Sync: {d.last_sync ? new Date(d.last_sync).toLocaleTimeString() : 'never'}
                  </div>
                </div>
                <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
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
    </AppShell>
  );
}
