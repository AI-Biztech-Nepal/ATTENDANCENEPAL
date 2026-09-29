import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';
import { dateKey, firstCheckIn, isLate, last7Days, presentEmployeeIds, WEEKDAY_LABEL } from '@/lib/metrics';
import { fetchAll } from '@/lib/leaveBalance';
import { weekOffDatesByGender } from '@/lib/weekOff';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '@/lib/shift';
import type { AttendanceLog, CompanyHoliday, Device, Employee, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';

export const runtime = 'nodejs';

const DEPT_COLORS: Record<string, string> = {
  Engineering: '#0d9488',
  Operations: '#2563eb',
  Marketing: '#f97316',
  Sales: '#a855f7',
  Support: '#ec4899',
};
const OTHER_COLOR = '#94a3b8';

type DetailRow = { id: string; primary: string; secondary?: string };

// Full read-only mirror of this one company's own admin Dashboard — every
// stat card, both charts, and Device Sync Activity, not just a partial
// summary — built for support/onboarding ("guide them through the page"),
// not as a real login. Reuses the exact same lib/metrics.ts + lib/shift.ts +
// lib/weekOff.ts functions the real tenant dashboard uses (see
// app/(admin)/page.tsx), against data fetched with the service-role client
// scoped to this companyId instead of the caller's own company via RLS, so
// the numbers here are the same numbers this company's own admin would see.
// Nothing here is writable — no action on this page can affect the real
// company's data.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;
  const { id: companyId } = await params;

  const { data: company } = await admin.from('companies').select('id, name, weekly_off_day, created_at').eq('id', companyId).maybeSingle();
  if (!company) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }

  const today = nepalTodayIso();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);

  const [employeesRes, shiftsRes, logs, leaveRes, devicesRes, todayRosterRes, weeklyPatternRes, todayHolidayRes] = await Promise.all([
    admin.from('employees').select('*').eq('company_id', companyId),
    admin.from('shifts').select('*').eq('company_id', companyId),
    // A week of punches for a busy company can pass PostgREST's default
    // 1000-row cap on a plain select() — silently truncated, not errored —
    // which would quietly wrong every stat below. fetchAll pages through
    // every row instead, same as the tenant Dashboard.
    fetchAll<AttendanceLog>((a, b) =>
      admin
        .from('attendance_logs')
        .select(ATTENDANCE_LOG_COLUMNS)
        .eq('company_id', companyId)
        .gte('punch_time', since.toISOString())
        .order('punch_time', { ascending: false })
        .range(a, b)
    ),
    admin
      .from('leave_requests')
      .select('employee_id, leave_type, end_date')
      .eq('company_id', companyId)
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today),
    admin.from('devices').select('*').eq('company_id', companyId),
    admin.from('employee_daily_shifts').select('employee_id, shift_id').eq('company_id', companyId).eq('work_date', today),
    admin.from('employee_weekly_pattern').select('employee_id, weekday, shift_id').eq('company_id', companyId),
    admin.from('company_holidays').select('*').eq('company_id', companyId).eq('holiday_date', today).maybeSingle(),
  ]);

  const employees = (employeesRes.data ?? []) as Employee[];
  const shifts = (shiftsRes.data ?? []) as Shift[];
  const devices = (devicesRes.data ?? []) as Device[];
  const activeEmployees = employees.filter(e => e.status === 'active');
  const employeeNameById = new Map(employees.map(e => [e.id, e.name]));

  const todayLogs = logs.filter(l => dateKey(l.punch_time) === today);
  const presentIds = presentEmployeeIds(logs, today);
  const onLeave = (leaveRes.data ?? []) as { employee_id: string; leave_type: string; end_date: string }[];
  const onLeaveIds = new Set(onLeave.map(l => l.employee_id));
  const todayHoliday = (todayHolidayRes.data ?? null) as CompanyHoliday | null;

  const dailyShiftByDate: DailyShiftByDate = new Map();
  for (const r of todayRosterRes.data ?? []) {
    let perDate = dailyShiftByDate.get(r.employee_id);
    if (!perDate) {
      perDate = new Map();
      dailyShiftByDate.set(r.employee_id, perDate);
    }
    perDate.set(today, r.shift_id);
  }
  const weeklyPattern = buildWeeklyPatternByEmployee(weeklyPatternRes.data ?? []);
  const weekOffDatesFor = weekOffDatesByGender(today, today, company.weekly_off_day, todayHoliday ? [todayHoliday] : []);
  const todayIsWeekOff = weekOffDatesFor(null).has(today);

  const totalRows: DetailRow[] = activeEmployees.map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? emp.employee_code }));

  const presentRows: DetailRow[] = [];
  for (const emp of activeEmployees) {
    if (!presentIds.has(emp.id)) continue;
    const checkIn = firstCheckIn(todayLogs.filter(l => l.employee_id === emp.id));
    presentRows.push({
      id: emp.id,
      primary: emp.name,
      secondary: checkIn ? `In at ${new Date(checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined,
    });
  }

  const lateRows: DetailRow[] = [];
  for (const emp of activeEmployees) {
    const empLogs = todayLogs.filter(l => l.employee_id === emp.id);
    if (!empLogs.length || !isLate(emp, shifts, empLogs, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern)) continue;
    const checkIn = firstCheckIn(empLogs);
    lateRows.push({
      id: emp.id,
      primary: emp.name,
      secondary: checkIn ? `In at ${new Date(checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined,
    });
  }

  const leaveRows: DetailRow[] = onLeave.map(l => ({
    id: l.employee_id,
    primary: employeeNameById.get(l.employee_id) ?? 'Unknown',
    secondary: `${l.leave_type} · until ${l.end_date}`,
  }));

  const weekOffRows: DetailRow[] = activeEmployees
    .filter(emp => isWeekOff(resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern)))
    .map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? undefined }));

  const absentRows: DetailRow[] = todayIsWeekOff
    ? []
    : activeEmployees
        .filter(
          emp =>
            !presentIds.has(emp.id) &&
            !onLeaveIds.has(emp.id) &&
            !emp.attendance_exempt &&
            !isWeekOff(resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern))
        )
        .map(emp => ({ id: emp.id, primary: emp.name, secondary: emp.department ?? undefined }));

  // payroll_summaries only gets a row for a date once the nightly job has
  // processed it — for TODAY that row never exists yet, so hours/overtime
  // are computed live from raw punches, same as the tenant Dashboard.
  const todayDayStatus = new Map<string, ReturnType<typeof computeDayStatusForResolvedShift>>();
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
    todayDayStatus.set(emp.id, computeDayStatusForResolvedShift(dayLogs, resolved));
  }

  let todayWorkHours = 0;
  const hoursEntries: { id: string; name: string; hours: number }[] = [];
  let todayOvertimeHours = 0;
  const overtimeEntries: { id: string; name: string; ot: number }[] = [];
  for (const emp of activeEmployees) {
    const status = todayDayStatus.get(emp.id);
    if (!status) continue;
    todayOvertimeHours += status.overtimeMinutes / 60;
    if (status.overtimeMinutes > 0) overtimeEntries.push({ id: emp.id, name: emp.name, ot: status.overtimeMinutes / 60 });
    if (!status.hasOut) continue;
    todayWorkHours += status.totalMinutes / 60;
    hoursEntries.push({ id: emp.id, name: emp.name, hours: status.totalMinutes / 60 });
  }
  const workHoursRows: DetailRow[] = hoursEntries
    .sort((a, b) => b.hours - a.hours)
    .map(e => ({ id: e.id, primary: e.name, secondary: `${e.hours.toFixed(1)} hrs` }));
  const overtimeRows: DetailRow[] = overtimeEntries
    .sort((a, b) => b.ot - a.ot)
    .map(e => ({ id: e.id, primary: e.name, secondary: `${e.ot.toFixed(1)} hrs OT` }));

  const trend = last7Days().map(day => ({
    day: WEEKDAY_LABEL[new Date(day + 'T00:00:00Z').getUTCDay()],
    present: presentEmployeeIds(logs, day).size,
  }));

  const deptCounts = new Map<string, number>();
  for (const emp of activeEmployees) {
    const key = emp.department && DEPT_COLORS[emp.department] ? emp.department : emp.department ? 'Other' : 'Unassigned';
    deptCounts.set(key, (deptCounts.get(key) ?? 0) + 1);
  }
  const deptBreakdown = Array.from(deptCounts.entries()).map(([name, value]) => ({ name, value, color: DEPT_COLORS[name] ?? OTHER_COLOR }));

  const feed = logs.slice(0, 8).map(l => ({
    id: l.id,
    employeeName: employeeNameById.get(l.employee_id) ?? 'Unknown',
    punchType: l.punch_type,
    punchTime: l.punch_time,
    method: l.method,
  }));

  const deviceRows = devices.map(d => ({ id: d.id, name: d.name, ipAddress: d.ip_address, status: d.status, lastSync: d.last_sync }));

  return NextResponse.json({
    company: { id: company.id, name: company.name, createdAt: company.created_at },
    stats: {
      totalEmployees: activeEmployees.length,
      presentToday: presentIds.size,
      lateToday: lateRows.length,
      onLeaveToday: onLeaveIds.size,
      weekOffToday: weekOffRows.length,
      absentToday: absentRows.length,
      workHoursToday: todayWorkHours,
      overtimeToday: todayOvertimeHours,
      attendancePct: activeEmployees.length ? Math.round((presentIds.size / activeEmployees.length) * 100) : 0,
    },
    todayIsWeekOff,
    todayHolidayName: todayHoliday?.name ?? null,
    details: {
      total: totalRows,
      present: presentRows,
      late: lateRows,
      leave: leaveRows,
      weekOff: weekOffRows,
      absent: absentRows,
      hours: workHoursRows,
      overtime: overtimeRows,
    },
    trend,
    deptBreakdown,
    devices: deviceRows,
    feed,
  });
}
