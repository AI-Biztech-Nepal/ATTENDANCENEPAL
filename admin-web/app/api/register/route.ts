import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, supabaseAdminConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// Creates the auth user pre-confirmed (email_confirm: true) so self-service
// signup skips Supabase's confirmation email entirely — the client signs the
// new user in immediately after this returns. handle_new_user() (see
// supabase/migrations/20260817190000_signup_location.sql) still does the
// company + profile creation from user_metadata, same as it did for
// supabase.auth.signUp() before this route existed.
export async function POST(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Ask the app owner to set it in Vercel.' },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const companyName = typeof body?.companyName === 'string' ? body.companyName.trim() : '';
  const location = typeof body?.location === 'string' ? body.location.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!fullName || !companyName || !email || password.length < 6) {
    return NextResponse.json(
      { error: 'Full name, company name, email, and a password of at least 6 characters are required.' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, company_name: companyName, location: location || null },
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'Could not create the account.' }, { status: 400 });
  }

  return NextResponse.json({ email });
}
