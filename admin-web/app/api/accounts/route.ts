import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, listAllUsers, supabaseAdminConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// Lists employee-linked login accounts (id/email/employeeId) — used by the
// Employees page to show/edit each employee's login username.
export async function GET(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Ask the app owner to set it in Vercel.' },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'Missing session token.' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }
  const { data: callerProfile } = await admin.from('profiles').select('role, company_id').eq('id', callerData.user.id).single();
  if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'hr') {
    return NextResponse.json({ error: 'Only admin/HR can view employee logins.' }, { status: 403 });
  }

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, role, employee_id, employees(name)')
    .eq('role', 'employee')
    .eq('company_id', callerProfile.company_id)
    .not('employee_id', 'is', null);
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const { users, error: usersError } = await listAllUsers(admin);
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const emailById = new Map(users.map(u => [u.id, u.email ?? '']));

  const accounts = (profiles ?? []).map(p => ({
    id: p.id,
    email: emailById.get(p.id) ?? '',
    role: p.role,
    employeeId: p.employee_id,
    employeeName: (p as unknown as { employees?: { name: string }[] | null }).employees?.[0]?.name ?? null,
  }));

  return NextResponse.json({ accounts });
}
