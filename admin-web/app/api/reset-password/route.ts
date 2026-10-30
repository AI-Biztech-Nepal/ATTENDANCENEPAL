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

  // Verify the caller is a signed-in admin/HR before doing anything privileged.
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, company_id')
    .eq('id', callerData.user.id)
    .single();
  if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'hr') {
    return NextResponse.json({ error: 'Only admin/HR can reset a login password.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!employeeId || password.length < 8) {
    return NextResponse.json({ error: 'employeeId and a password of at least 8 characters are required.' }, { status: 400 });
  }

  const { data: employee } = await admin.from('employees').select('id, company_id').eq('id', employeeId).single();
  if (!employee || employee.company_id !== callerProfile.company_id) {
    return NextResponse.json({ error: 'This employee has no login to reset.' }, { status: 404 });
  }

  const { data: link, error: linkError } = await admin
    .from('profiles')
    .select('id')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (linkError || !link) {
    return NextResponse.json({ error: 'This employee has no login to reset.' }, { status: 404 });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(link.id, { password });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
