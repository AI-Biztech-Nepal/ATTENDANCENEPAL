import { createClient, type User } from '@supabase/supabase-js';

// Server-only: uses the service_role key, which bypasses Row Level Security
// entirely. Never import this file from a 'use client' component — only from
// app/api/**/route.ts handlers, which run exclusively on the server. The key
// itself must be set as a plain (non NEXT_PUBLIC_) env var so Next.js never
// bundles it into client-side JavaScript.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const supabaseAdminConfigured = Boolean(supabaseUrl && serviceRoleKey);

export function getSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not configured on the server.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** admin.auth.admin.listUsers() only returns one page (1000 users max) — this
 * lists auth users across the ENTIRE platform (every tenant company), not
 * just the caller's own, so a single-page call silently missed anyone past
 * that cutoff once total platform users crossed it. Pages through until an
 * empty page comes back. */
export async function listAllUsers(admin: ReturnType<typeof getSupabaseAdmin>) {
  const perPage = 1000;
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return { users, error };
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return { users, error: null };
}
