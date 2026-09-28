import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, listAllUsers, supabaseAdminConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// Not human-typed anywhere — this only needs to look like a valid email
// address to Supabase Auth, nobody ever receives mail at it.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 24) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  return out;
}

async function requireAdmin(req: NextRequest, admin: ReturnType<typeof getSupabaseAdmin>) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return { error: NextResponse.json({ error: 'Missing session token.' }, { status: 401 }) } as const;
  }
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return { error: NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 }) } as const;
  }
  const { data: callerProfile } = await admin.from('profiles').select('role, company_id').eq('id', callerData.user.id).single();
  if (callerProfile?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Only admins can manage device bridge credentials.' }, { status: 403 }) } as const;
  }
  return { companyId: callerProfile.company_id as string } as const;
}

// Lists this company's bridge credentials (id/email/created_at) — the
// Devices page uses this to show what's already been issued, so an admin
// isn't left guessing whether one exists before generating another.
export async function GET(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = getSupabaseAdmin();
  const auth = await requireAdmin(req, admin);
  if ('error' in auth) return auth.error;

  const { data: bridgeProfiles, error } = await admin
    .from('profiles')
    .select('id, created_at')
    .eq('company_id', auth.companyId)
    .eq('is_device_bridge', true)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bridgeProfiles || bridgeProfiles.length === 0) return NextResponse.json({ credentials: [] });

  const { users, error: usersError } = await listAllUsers(admin);
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });
  const emailById = new Map(users.map(u => [u.id, u.email ?? '']));

  const credentials = bridgeProfiles.map(p => ({
    id: p.id,
    email: emailById.get(p.id) ?? '',
    createdAt: p.created_at,
  }));
  return NextResponse.json({ credentials });
}

// Creates a new scoped credential: a real Supabase Auth user + a
// role='admin', is_device_bridge=true profiles row tied to the caller's own
// company_id — never the caller's choice, always the caller's own, so an
// admin can only ever issue a credential for their own company. Returns the
// password (and a ready-to-download .env) exactly once; it's not retrievable
// again afterwards, same as any other generated-secret flow.
export async function POST(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = getSupabaseAdmin();
  const auth = await requireAdmin(req, admin);
  if ('error' in auth) return auth.error;

  const email = `bridge-${randomUUID()}@device-bridge.internal`;
  const password = generatePassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { company_id: auth.companyId, is_device_bridge: true },
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'Could not create the credential.' }, { status: 400 });
  }

  const { error: linkError } = await admin
    .from('profiles')
    .upsert({ id: created.user.id, role: 'admin', company_id: auth.companyId, is_device_bridge: true }, { onConflict: 'id' });
  if (linkError) {
    // Same rollback pattern as create-login: don't leave an orphaned auth
    // user nobody can see or manage from this page.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  const envFile = [
    `SUPABASE_URL=${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}`,
    `SUPABASE_ANON_KEY=${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
    `BRIDGE_EMAIL=${email}`,
    `BRIDGE_PASSWORD=${password}`,
    '',
  ].join('\n');

  return NextResponse.json({ id: created.user.id, email, password, envFile });
}

// Revokes a credential (deletes the auth user; profiles row cascades via its
// `references auth.users(id) on delete cascade`) — for a lost/compromised
// machine, or just retiring an old one after issuing a replacement.
export async function DELETE(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = getSupabaseAdmin();
  const auth = await requireAdmin(req, admin);
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  // Scope the lookup to this admin's own company before deleting anything —
  // otherwise a guessed/leaked id from another company could be revoked by
  // an admin who has no business touching it.
  const { data: target } = await admin.from('profiles').select('company_id, is_device_bridge').eq('id', id).maybeSingle();
  if (!target || !target.is_device_bridge || target.company_id !== auth.companyId) {
    return NextResponse.json({ error: 'Credential not found.' }, { status: 404 });
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
