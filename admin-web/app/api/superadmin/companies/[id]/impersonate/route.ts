import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';
import { listAllUsers } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

const ROLE_PRIORITY: Record<string, number> = { admin: 0, hr: 1, employee: 2 };

// Real "View their account" — generates an actual session as one of this
// company's own logins (preferring admin, then hr, then employee), so the
// superadmin lands in the exact same app a tenant admin would, with the same
// real read-write power (approve leave, correct attendance, edit payroll —
// everything). Not a preview: whatever the superadmin does after this call
// really happens to the tenant's data.
//
// Passwordless by construction: generateLink()/verifyOtp() is Supabase's own
// documented admin "sign in as this user" mechanism (a magic-link token the
// admin API mints out-of-band, never sent anywhere, verified straight from
// the browser) — nothing here reads, resets, or even touches the target
// user's actual password.
//
// The audit row is written BEFORE generateLink(), not after — a failure
// past this point still leaves a record that authority was granted.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin, user: caller } = result;
  const { id: companyId } = await params;

  const { data: company } = await admin.from('companies').select('id, name, status').eq('id', companyId).maybeSingle();
  if (!company) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }
  if (company.status === 'suspended') {
    return NextResponse.json({ error: 'This company is suspended — reactivate it first to view their account.' }, { status: 409 });
  }

  const { data: profiles } = await admin.from('profiles').select('id, role').eq('company_id', companyId);
  const target = (profiles ?? [])
    .slice()
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9))[0];
  if (!target) {
    return NextResponse.json({ error: 'This company has no logins to view as.' }, { status: 404 });
  }

  const { users: authUsers, error: listError } = await listAllUsers(admin);
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }
  const targetEmail = authUsers.find(u => u.id === target.id)?.email;
  if (!targetEmail) {
    return NextResponse.json({ error: "Could not find this login's email." }, { status: 404 });
  }

  const { error: auditError } = await admin.from('superadmin_impersonation_log').insert({
    superadmin_email: caller.email,
    company_id: company.id,
    company_name: company.name,
    target_user_id: target.id,
    target_email: targetEmail,
    target_role: target.role,
  });
  if (auditError) {
    return NextResponse.json({ error: `Could not record the audit log, so this was not allowed to proceed: ${auditError.message}` }, { status: 500 });
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: targetEmail });
  if (linkError || !linkData) {
    return NextResponse.json({ error: linkError?.message ?? 'Could not generate a session.' }, { status: 500 });
  }

  return NextResponse.json({
    company: { id: company.id, name: company.name },
    asUser: { email: targetEmail, role: target.role },
    tokenHash: linkData.properties.hashed_token,
  });
}
