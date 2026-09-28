import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';
import { listAllUsers } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

type AdminUser = { id: string; name: string; email: string; role: string };
type CompanyRow = {
  id: string;
  name: string;
  createdAt: string;
  status: 'active' | 'suspended';
  userCount: number;
  employeeCount: number;
  deviceCount: number;
  adminUsers: AdminUser[];
};

function countByCompany(rows: { company_id: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.company_id) continue;
    counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
  }
  return counts;
}

// Read-only, no company_id filter — the entire point is a cross-tenant view.
// No writes anywhere in this route.
export async function GET(req: NextRequest) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;

  const [companiesRes, adminHrProfilesRes, allProfilesRes, employeesRes, devicesRes] = await Promise.all([
    admin.from('companies').select('id, name, created_at, status').order('created_at', { ascending: false }),
    admin.from('profiles').select('id, full_name, role, company_id').in('role', ['admin', 'hr']),
    admin.from('profiles').select('company_id'),
    admin.from('employees').select('company_id'),
    admin.from('devices').select('company_id'),
  ]);

  if (companiesRes.error) {
    return NextResponse.json({ error: companiesRes.error.message }, { status: 500 });
  }

  // profiles has no email column (email lives on auth.users) — resolve it
  // via listAllUsers(), paginated across the whole platform.
  const { users } = await listAllUsers(admin);
  const emailById = new Map(users.map(u => [u.id, u.email ?? '']));

  const userCounts = countByCompany(allProfilesRes.data ?? []);
  const employeeCounts = countByCompany(employeesRes.data ?? []);
  const deviceCounts = countByCompany(devicesRes.data ?? []);

  const adminUsersByCompany = new Map<string, AdminUser[]>();
  for (const p of adminHrProfilesRes.data ?? []) {
    if (!p.company_id) continue;
    const list = adminUsersByCompany.get(p.company_id) ?? [];
    list.push({ id: p.id, name: p.full_name || '(no name set)', email: emailById.get(p.id) ?? '(unknown)', role: p.role });
    adminUsersByCompany.set(p.company_id, list);
  }

  const companies: CompanyRow[] = (companiesRes.data ?? []).map(c => ({
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
    status: (c.status ?? 'active') as 'active' | 'suspended',
    userCount: userCounts.get(c.id) ?? 0,
    employeeCount: employeeCounts.get(c.id) ?? 0,
    deviceCount: deviceCounts.get(c.id) ?? 0,
    adminUsers: adminUsersByCompany.get(c.id) ?? [],
  }));

  return NextResponse.json({ companies });
}
