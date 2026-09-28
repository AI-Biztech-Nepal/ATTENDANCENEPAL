import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, supabaseAdminConfigured } from './supabase-admin';

// Platform-owner identity for the /superadmin panel — a server-only env var
// allowlist, not a `profiles` column. `profiles` already had to be locked
// down once against self-escalation (see the grant restricted to
// full_name/company_name/pan_no/location in the tenant_backfill migration);
// a DB column here would mean every future migration touching that grant has
// to remember, forever, never to include it. An env var (same pattern as
// SUPABASE_SERVICE_ROLE_KEY below) needs no such permanent vigilance and no
// schema change at all.
function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

// The single real security gate for every /api/superadmin/* route — client
// checks (the /superadmin layout, the nav) are UX only. Mirrors the
// caller-verification shape in app/api/create-login/route.ts, substituting
// the allowlist check for that route's `role === 'admin'` check.
export async function requireSuperadmin(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return {
      response: NextResponse.json(
        { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Ask the app owner to set it.' },
        { status: 500 }
      ),
    };
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return { response: NextResponse.json({ error: 'Missing session token.' }, { status: 401 }) };
  }

  const admin = getSupabaseAdmin();
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return { response: NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 }) };
  }
  if (!isSuperadminEmail(callerData.user.email)) {
    return { response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }

  return { admin, user: callerData.user };
}
