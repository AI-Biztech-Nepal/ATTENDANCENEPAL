import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';
import { presentEmployeeIds } from '@/lib/metrics';
import { fetchAll } from '@/lib/leaveBalance';
import { weekOffDatesByGender } from '@/lib/weekOff';
import { buildWeeklyPatternByEmployee, nepalDateTimeToUtcMs, nepalTodayIso, type DailyShiftByDate } from '@/lib/shift';
import { todayStatusByEmployee } from '@/lib/todayStatus';
import type { AttendanceLog, CompanyHoliday, Employee, Shift } from '@/lib/types';

export const runtime = 'nodejs';

type TodayAttendanceRow = {
  companyId: string;
  totalEmployees: number;
  present: number;
  late: number;
  onLeave: number;
  absent: number;
  todayIsWeekOff: boolean;
};

function groupByCompany<T extends { company_id: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.company_id) continue;
    const list = map.get(row.company_id);
    if (list) list.push(row);
    else map.set(row.company_id, [row]);
  }
  return map;
}

// Read-only, cross-tenant: today's Present / Late / On Leave / Absent for
// every company at once, for the cards on the superadmin Dashboard. Same
// rules as the per-company preview (companies/[id]/dashboard/route.ts) and
// the tenant's own Dashboard — same lib/metrics.ts + lib/shift.ts +
// lib/weekOff.ts calls — just fetched platform-wide in one pass and then
// bucketed by company_id, instead of one full dashboard query per card.
//
// Shifts and holidays MUST be grouped per company before resolving:
// resolveShift() matches department shifts by department name alone, so an
// unscoped list would hand one company's "Engineering" shift to another's.
export async function GET(req: NextRequest) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;

  const today = nepalTodayIso();
  const todayStart = new Date(nepalDateTimeToUtcMs(today, '00:00')).toISOString();

  const [companiesRes, employees, shiftsRes, logs, leaveRes, rosterRes, weeklyPatternRows, holidaysRes] = await Promise.all([
    admin.from('companies').select('id, weekly_off_day'),
    fetchAll<Employee & { company_id: string | null }>((a, b) => admin.from('employees').select('*').order('id').range(a, b)),
    admin.from('shifts').select('*'),
    // Platform-wide punches for one day can pass PostgREST's 1000-row cap.
    fetchAll<AttendanceLog>((a, b) =>
      admin
        .from('attendance_logs')
        .select('id, employee_id, company_id, punch_time, punch_type')
        .gte('punch_time', todayStart)
        .order('id')
        .range(a, b)
    ),
    admin
      .from('leave_requests')
      .select('employee_id, company_id')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today),
    admin.from('employee_daily_shifts').select('employee_id, shift_id').eq('work_date', today),
    fetchAll<{ employee_id: string; weekday: number; shift_id: string | null }>((a, b) =>
      admin.from('employee_weekly_pattern').select('employee_id, weekday, shift_id').order('employee_id').range(a, b)
    ),
    admin.from('company_holidays').select('*').eq('holiday_date', today),
  ]);

  if (companiesRes.error) {
    return NextResponse.json({ error: companiesRes.error.message }, { status: 500 });
  }

  const employeesByCompany = groupByCompany(employees);
  const shiftsByCompany = groupByCompany((shiftsRes.data ?? []) as (Shift & { company_id: string | null })[]);
  const logsByCompany = groupByCompany(logs as (AttendanceLog & { company_id: string | null })[]);
  const leaveByCompany = groupByCompany((leaveRes.data ?? []) as { employee_id: string; company_id: string | null }[]);
  const holidaysByCompany = groupByCompany((holidaysRes.data ?? []) as CompanyHoliday[]);

  // Keyed by employee_id, which is already unique platform-wide — no
  // per-company split needed for these two.
  const dailyShiftByDate: DailyShiftByDate = new Map();
  for (const r of rosterRes.data ?? []) {
    dailyShiftByDate.set(r.employee_id, new Map([[today, r.shift_id]]));
  }
  const weeklyPattern = buildWeeklyPatternByEmployee(weeklyPatternRows);

  const rows: TodayAttendanceRow[] = (companiesRes.data ?? []).map(c => {
    const activeEmployees = (employeesByCompany.get(c.id) ?? []).filter(e => e.status === 'active');
    const shifts = shiftsByCompany.get(c.id) ?? [];
    const companyLogs = logsByCompany.get(c.id) ?? [];
    const presentIds = presentEmployeeIds(companyLogs, today);
    const onLeaveIds = new Set((leaveByCompany.get(c.id) ?? []).map(l => l.employee_id));
    const weekOffDatesFor = weekOffDatesByGender(today, today, c.weekly_off_day, holidaysByCompany.get(c.id) ?? []);
    const todayIsWeekOff = weekOffDatesFor(null).has(today);

    const statuses = todayStatusByEmployee({
      activeEmployees,
      shifts,
      logs: companyLogs,
      onLeaveIds,
      today,
      dailyShiftByDate,
      weeklyPattern,
      weekOffDatesFor,
    });
    let late = 0;
    let absent = 0;
    for (const status of statuses.values()) {
      if (status === 'late') late++;
      else if (status === 'absent') absent++;
    }

    return {
      companyId: c.id,
      totalEmployees: activeEmployees.length,
      present: presentIds.size,
      late,
      onLeave: onLeaveIds.size,
      absent,
      todayIsWeekOff,
    };
  });

  return NextResponse.json({ today, companies: rows });
}
