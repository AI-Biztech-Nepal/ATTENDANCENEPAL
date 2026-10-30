import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';
import { listAllUsers } from '@/lib/supabase-admin';
import { fetchAll } from '@/lib/leaveBalance';
import { weekOffDatesByGender } from '@/lib/weekOff';
import { buildWeeklyPatternByEmployee, nepalDateTimeToUtcMs, nepalTodayIso, type DailyShiftByDate } from '@/lib/shift';
import { todayStatusByEmployee } from '@/lib/todayStatus';
import type { AttendanceLog, CompanyHoliday, Employee, Shift } from '@/lib/types';

export const runtime = 'nodejs';

// Single-company detail (GET, read-only) plus the two superadmin management
// actions on a company: PATCH to suspend/reactivate (soft, reversible — bans
// or unbans every login under the company via the Auth Admin API, same as
// used elsewhere in this codebase for account lifecycle, e.g.
// bridge-credentials) and DELETE to permanently destroy it (hard, no undo —
// see superadmin_delete_company() in
// 20260827100000_superadmin_company_status_and_delete.sql for why this is a
// single DB transaction rather than a series of client-side deletes).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;
  const { id: companyId } = await params;

  const today = nepalTodayIso();
  const todayStart = new Date(nepalDateTimeToUtcMs(today, '00:00')).toISOString();

  const [
    companyRes,
    profilesRes,
    employeesRes,
    devicesRes,
    syncEventsRes,
    shiftsRes,
    todayLogs,
    leaveRes,
    rosterRes,
    weeklyPatternRes,
    holidaysRes,
  ] = await Promise.all([
    admin.from('companies').select('id, name, created_at, status, suspended_at, weekly_off_day').eq('id', companyId).maybeSingle(),
    admin.from('profiles').select('id, full_name, role, employee_id').eq('company_id', companyId),
    admin.from('employees').select('*').eq('company_id', companyId),
    admin.from('devices').select('id, name, ip_address, status, last_sync').eq('company_id', companyId).order('name'),
    admin
      .from('device_sync_events')
      .select('id, device_id, sync_type, status, requested_at, completed_at, error')
      .eq('company_id', companyId)
      .order('requested_at', { ascending: false })
      .limit(100),
    // Today's attendance per employee — same inputs as the company's own
    // Dashboard, see lib/todayStatus.ts.
    admin.from('shifts').select('*').eq('company_id', companyId),
    fetchAll<AttendanceLog>((a, b) =>
      admin
        .from('attendance_logs')
        .select('id, employee_id, punch_time, punch_type')
        .eq('company_id', companyId)
        .gte('punch_time', todayStart)
        .order('id')
        .range(a, b)
    ),
    admin
      .from('leave_requests')
      .select('employee_id')
      .eq('company_id', companyId)
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today),
    admin.from('employee_daily_shifts').select('employee_id, shift_id').eq('company_id', companyId).eq('work_date', today),
    admin.from('employee_weekly_pattern').select('employee_id, weekday, shift_id').eq('company_id', companyId),
    admin.from('company_holidays').select('*').eq('company_id', companyId).eq('holiday_date', today),
  ]);

  if (!companyRes.data) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }

  const allEmployees = (employeesRes.data ?? []) as Employee[];
  const dailyShiftByDate: DailyShiftByDate = new Map();
  for (const r of rosterRes.data ?? []) {
    dailyShiftByDate.set(r.employee_id, new Map([[today, r.shift_id]]));
  }
  const todayStatuses = todayStatusByEmployee({
    activeEmployees: allEmployees.filter(e => e.status === 'active'),
    shifts: (shiftsRes.data ?? []) as Shift[],
    logs: todayLogs,
    onLeaveIds: new Set((leaveRes.data ?? []).map(l => l.employee_id)),
    today,
    dailyShiftByDate,
    weeklyPattern: buildWeeklyPatternByEmployee(weeklyPatternRes.data ?? []),
    weekOffDatesFor: weekOffDatesByGender(today, today, companyRes.data.weekly_off_day, (holidaysRes.data ?? []) as CompanyHoliday[]),
  });

  const { users: authUsers } = await listAllUsers(admin);
  const emailById = new Map(authUsers.map(u => [u.id, u.email ?? '']));

  // Employee-role logins are created via /api/create-login, which links
  // employee_id but never sets profiles.full_name (the real name lives on
  // the employees row instead) — resolve it from there rather than showing
  // "(no name set)" for every employee login, which is the common case.
  const employeeNameById = new Map(allEmployees.map(e => [e.id, e.name]));

  const users = (profilesRes.data ?? []).map(p => ({
    id: p.id,
    name: p.full_name || (p.employee_id ? employeeNameById.get(p.employee_id) : undefined) || '(no name set)',
    email: emailById.get(p.id) ?? '(unknown)',
    role: p.role,
  }));

  // Per-device activity summary: last successful/failed pull (sync_type
  // 'logs' — pulling attendance punches off the device) and last user-list
  // push (sync_type 'users'), each derived from the most recent completed
  // event of that type. "Last active" is devices.last_sync itself, the same
  // field the tenant Devices page already uses to compute online/offline.
  type SyncEvent = {
    id: string;
    device_id: string;
    sync_type: 'users' | 'logs';
    status: string;
    requested_at: string;
    completed_at: string | null;
    error: string | null;
  };
  const eventsByDevice = new Map<string, SyncEvent[]>();
  for (const e of (syncEventsRes.data ?? []) as SyncEvent[]) {
    const list = eventsByDevice.get(e.device_id) ?? [];
    list.push(e);
    eventsByDevice.set(e.device_id, list);
  }
  function lastCompletedOf(deviceId: string, syncType: 'users' | 'logs') {
    const events = eventsByDevice.get(deviceId) ?? [];
    return events.find(e => e.sync_type === syncType && (e.status === 'success' || e.status === 'failed')) ?? null;
  }

  const devices = (devicesRes.data ?? []).map(d => {
    const lastPull = lastCompletedOf(d.id, 'logs');
    const lastUserSync = lastCompletedOf(d.id, 'users');
    return {
      ...d,
      lastPull: lastPull ? { at: lastPull.completed_at ?? lastPull.requested_at, status: lastPull.status, error: lastPull.error } : null,
      lastUserSync: lastUserSync ? { at: lastUserSync.completed_at ?? lastUserSync.requested_at, status: lastUserSync.status, error: lastUserSync.error } : null,
    };
  });

  return NextResponse.json({
    company: {
      id: companyRes.data.id,
      name: companyRes.data.name,
      createdAt: companyRes.data.created_at,
      status: companyRes.data.status as 'active' | 'suspended',
      suspendedAt: companyRes.data.suspended_at,
    },
    users,
    // Only the columns the modal shows — the row was fetched with '*' for
    // the shift/gender/exempt fields todayStatusByEmployee needs, and the
    // rest (salary, bank details, …) has no business in this response.
    employees: allEmployees
      .map(e => ({
        id: e.id,
        employee_code: e.employee_code,
        name: e.name,
        department: e.department,
        designation: e.designation,
        status: e.status,
        date_of_joining: e.date_of_joining,
        todayStatus: todayStatuses.get(e.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    devices,
  });
}

// 100 years — GoTrue's own documented example of an effectively-permanent
// ban (there's no literal "forever" value). Reactivate sets it back to
// 'none' to lift the ban.
const SUSPEND_BAN_DURATION = '876000h';

// Suspend (ban every login under the company; data untouched, fully
// reversible) or reactivate (unban). Banning is enforced by Supabase Auth
// itself at sign-in — a banned user gets a clear rejection there, rather
// than signing in successfully and hitting a confusing wall of empty data,
// which is what would happen if this instead tried to enforce suspension
// through RLS/my_company_id() (that function gates the company's own row
// too, so a suspended company's admin couldn't even read back *why* they
// were locked out).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;
  const { id: companyId } = await params;

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action !== 'suspend' && action !== 'reactivate') {
    return NextResponse.json({ error: 'action must be "suspend" or "reactivate".' }, { status: 400 });
  }

  const { data: company } = await admin.from('companies').select('id, name').eq('id', companyId).maybeSingle();
  if (!company) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }

  const { data: profiles, error: profilesError } = await admin.from('profiles').select('id').eq('company_id', companyId);
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const banDuration = action === 'suspend' ? SUSPEND_BAN_DURATION : 'none';
  const results = await Promise.all(
    (profiles ?? []).map(p => admin.auth.admin.updateUserById(p.id, { ban_duration: banDuration }))
  );
  const failedCount = results.filter(r => r.error).length;

  const { error: updateError } = await admin
    .from('companies')
    .update(
      action === 'suspend' ? { status: 'suspended', suspended_at: new Date().toISOString() } : { status: 'active', suspended_at: null }
    )
    .eq('id', companyId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: syncErr } = await admin.schema('core').rpc('set_service_status', {
    p_org: companyId,
    p_service: 'attendance',
    p_status: action === 'suspend' ? 'suspended' : 'active',
  });
  if (syncErr) {
    return NextResponse.json(
      { error: `The company row was updated, but mirroring the status into the portal failed: ${syncErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: action === 'suspend' ? 'suspended' : 'active',
    accountsUpdated: (profiles ?? []).length - failedCount,
    accountsFailed: failedCount,
  });
}

// Permanent, cascading delete — see the migration this calls for the full
// reasoning. Requires the caller to already have fetched the company's exact
// name and echo it back as confirmName; this is a second, server-side
// verification independent of whatever the client's own confirmation UI
// does (a client-only check is trivially bypassed by anyone driving the API
// directly), on top of the client-side "type the company name" step the
// superadmin panel itself requires before ever sending this request.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;
  const { id: companyId } = await params;

  const body = await req.json().catch(() => ({}));
  const confirmName = typeof body?.confirmName === 'string' ? body.confirmName : '';

  const { data: company } = await admin.from('companies').select('id, name').eq('id', companyId).maybeSingle();
  if (!company) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }
  if (confirmName !== company.name) {
    return NextResponse.json({ error: 'Confirmation text did not match the company name exactly.' }, { status: 400 });
  }

  // Collected BEFORE the data cascade — once it commits, these profile rows
  // (and therefore the join used to look this up) are gone.
  const { data: profiles, error: profilesError } = await admin.from('profiles').select('id').eq('company_id', companyId);
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }
  const profileIds = (profiles ?? []).map(p => p.id);

  // Single DB transaction: employees, devices, attendance history, payroll,
  // everything company-scoped, and the company row itself. Either all of it
  // goes or none of it does — see the migration for the full table list and
  // ordering.
  const { error: rpcError } = await admin.rpc('superadmin_delete_company', { target_company_id: companyId });
  if (rpcError) {
    return NextResponse.json({ error: `Delete failed, nothing was removed: ${rpcError.message}` }, { status: 500 });
  }

  const { error: removeErr } = await admin.schema('core').rpc('remove_org_service', {
    p_org: companyId,
    p_service: 'attendance',
  });
  if (removeErr) console.error('remove_org_service failed after company delete:', removeErr.message);

  // Best-effort cleanup of the now-orphaned login accounts (no profile, no
  // company, no employee left for any of them) — the data itself is already
  // gone regardless of how this part goes, so a partial failure here just
  // means a few leftover unusable logins, not a half-deleted company.
  const authResults = await Promise.all(profileIds.map(id => admin.auth.admin.deleteUser(id)));
  const authFailed = authResults.filter(r => r.error).length;

  return NextResponse.json({
    ok: true,
    authAccountsDeleted: profileIds.length - authFailed,
    authAccountsFailed: authFailed,
  });
}
