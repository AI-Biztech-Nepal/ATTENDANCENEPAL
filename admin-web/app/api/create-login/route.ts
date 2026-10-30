import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, supabaseAdminConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

  // Verify the caller is a signed-in admin before doing anything privileged.
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, company_id')
    .eq('id', callerData.user.id)
    .single();
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can create employee logins.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!employeeId || !email || password.length < 8) {
    return NextResponse.json(
      { error: 'employeeId, email, and a password of at least 8 characters are required.' },
      { status: 400 }
    );
  }

  const { data: employee, error: employeeError } = await admin
    .from('employees')
    .select('id, name, company_id')
    .eq('id', employeeId)
    .single();
  if (employeeError || !employee || employee.company_id !== callerProfile.company_id) {
    // 404, not 403 — don't confirm that a different company's employee exists.
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const { data: existingLink } = await admin
    .from('profiles')
    .select('id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (existingLink) {
    return NextResponse.json({ error: 'This employee already has a login.' }, { status: 409 });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { company_id: callerProfile.company_id },
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'Could not create the account.' }, { status: 400 });
  }

  // company_id must be included even though handle_new_user() already set it
  // on the row this upsert will match — Postgres validates NOT NULL on the
  // speculative INSERT row for ON CONFLICT DO UPDATE before it ever gets to
  // resolve the conflict, so omitting a NOT NULL column here fails even
  // though the existing row already has a value for it.
  const { error: linkError } = await admin
    .from('profiles')
    .upsert(
      { id: created.user.id, employee_id: employeeId, role: 'employee', company_id: callerProfile.company_id },
      { onConflict: 'id' }
    );
  // TODO(portal): after this upsert, call the portal function so the new user also gets, in the
  // portal project: core.memberships (user_id = created.user.id, org_id = callerProfile.company_id),
  // core.service_roles (service_key 'attendance', role 'employee'), and
  // core.profiles.active_org_id = callerProfile.company_id. Roll back like the deleteUser below if it fails.
  if (linkError) {
    // Roll back the orphaned auth user so a failed link doesn't leave a
    // dangling account nobody can see from the Employees page.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  return NextResponse.json({ email, employeeName: employee.name });
}
