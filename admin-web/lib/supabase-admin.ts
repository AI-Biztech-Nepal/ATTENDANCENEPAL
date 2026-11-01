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

/** Removes every file under `prefix` in a storage bucket, folders included.
 * Storage can't list recursively, so this lists one level, removes the files
 * it finds, descends into the folders, and asks again until the prefix is
 * empty (a folder disappears on its own once its last file is gone). */
async function removeUnderPrefix(
  bucket: ReturnType<ReturnType<typeof getSupabaseAdmin>['storage']['from']>,
  prefix: string,
  depth = 0
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  for (let round = 0; round < 1000; round++) {
    const { data: entries, error } = await bucket.list(prefix, { limit: 100 });
    if (error) return { removed, failed: 1 };
    if (!entries || entries.length === 0) break;

    // A folder entry has no id; a file does.
    const files = entries.filter(e => e.id !== null).map(e => `${prefix}/${e.name}`);
    const folders = entries.filter(e => e.id === null).map(e => `${prefix}/${e.name}`);
    let progressed = false;

    if (files.length > 0) {
      const { error: removeError } = await bucket.remove(files);
      if (removeError) return { removed, failed: files.length };
      removed += files.length;
      progressed = true;
    }
    if (depth < 3) {
      for (const folder of folders) {
        const inner = await removeUnderPrefix(bucket, folder, depth + 1);
        removed += inner.removed;
        if (inner.failed > 0) return { removed, failed: inner.failed };
        if (inner.removed > 0) progressed = true;
      }
    }
    // Nothing was removed this round, so asking again would just loop.
    if (!progressed) break;
  }
  return { removed, failed: 0 };
}

/** Deletes every stored HR document of a company (<company id>/<employee id>/<file>
 * in the private employee-documents bucket) — used after the company itself is
 * deleted, since a database delete can't reach files in storage. */
export async function removeCompanyDocuments(admin: ReturnType<typeof getSupabaseAdmin>, companyId: string) {
  return removeUnderPrefix(admin.storage.from('employee-documents'), companyId);
}
