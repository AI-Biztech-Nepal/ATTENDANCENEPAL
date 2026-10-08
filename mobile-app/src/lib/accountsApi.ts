import { supabase } from './supabase';

export const API_BASE = 'https://attendancenepal.vercel.app';

async function authedFetch(path: string, body: object) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Your session expired — please sign in again.' };
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json.error ?? 'Request failed.' };
  return { ok: true, data: json };
}

export function createLogin(employeeId: string, email: string, password: string) {
  return authedFetch('/api/create-login', { employeeId, email, password });
}
export function resetPassword(employeeId: string, password: string) {
  return authedFetch('/api/reset-password', { employeeId, password });
}
export function updateLoginEmail(employeeId: string, email: string) {
  return authedFetch('/api/update-login-email', { employeeId, email });
}

export async function fetchAccounts(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return {};
  const res = await fetch(`${API_BASE}/api/accounts`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return {};
  const map: Record<string, string> = {};
  for (const acc of body.accounts ?? []) if (acc.employeeId) map[acc.employeeId] = acc.email;
  return map;
}
