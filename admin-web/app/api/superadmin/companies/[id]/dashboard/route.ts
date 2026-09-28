import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';
import { dateKey, isLate, presentEmployeeIds } from '@/lib/metrics';
import { nepalTodayIso } from '@/lib/shift';
import type { AttendanceLog, Employee, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';

export const runtime = 'nodejs';

// Read-only preview of what this one company's admin Dashboard looks like —
// built for support/onboarding ("guide them through the page"), not as a
// real login. Reuses the exact same lib/metrics.ts + lib/shift.ts functions
// the real tenant dashboard uses, so the numbers are genuinely accurate, not
// a simplified approximation — the one deliberate simplification is that
// week-off/company-holiday config isn't factored into shift resolution here
// (those optional params are left undefined, which lib/shift.ts's own
// resolveShiftForDate() already treats as "just use the normal
// own-shift/department/default chain"), so a company on a scheduled Week Off
// today may show a small number of "late" false positives here that its
// real dashboard would correctly exclude. Nothing here is writable — no
// action taken on this page can affect the real company's data.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;
  const { id: companyId } = await params;

  const { data: company } = await admin.from('companies').select('id, name').eq('id', companyId).maybeSingle();
  if (!company) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }

  const today = nepalTodayIso();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);

  const [employeesRes, shiftsRes, logsRes, leaveRes] = await Promise.all([
    admin.from('employees').select('*').eq('company_id', companyId),
    admin.from('shifts').select('*').eq('company_id', companyId),
    admin.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).eq('company_id', companyId).gte('punch_time', since.toISOString()).order('punch_time', { ascending: false }),
    admin.from('leave_requests').select('employee_id').eq('company_id', companyId).eq('status', 'approved').lte('start_date', today).gte('end_date', today),
  ]);

  const employees = (employeesRes.data ?? []) as Employee[];
  const shifts = (shiftsRes.data ?? []) as Shift[];
  const logs = (logsRes.data ?? []) as AttendanceLog[];
  const activeEmployees = employees.filter(e => e.status === 'active');
  const todayLogs = logs.filter(l => dateKey(l.punch_time) === today);
  const presentIds = presentEmployeeIds(logs, today);
  const onLeaveIds = new Set((leaveRes.data ?? []).map(l => l.employee_id));

  let lateCount = 0;
  for (const emp of activeEmployees) {
    const empLogs = todayLogs.filter(l => l.employee_id === emp.id);
    if (empLogs.length && isLate(emp, shifts, empLogs, today)) lateCount++;
  }
  const absentCount = activeEmployees.filter(e => !presentIds.has(e.id) && !onLeaveIds.has(e.id) && !e.attendance_exempt).length;

  const employeeNameById = new Map(employees.map(e => [e.id, e.name]));
  const feed = logs.slice(0, 8).map(l => ({
    id: l.id,
    employeeName: employeeNameById.get(l.employee_id) ?? 'Unknown',
    punchType: l.punch_type,
    punchTime: l.punch_time,
    method: l.method,
  }));

  return NextResponse.json({
    company: { id: company.id, name: company.name },
    totalEmployees: activeEmployees.length,
    presentToday: presentIds.size,
    lateToday: lateCount,
    onLeaveToday: onLeaveIds.size,
    absentToday: absentCount,
    feed,
  });
}
