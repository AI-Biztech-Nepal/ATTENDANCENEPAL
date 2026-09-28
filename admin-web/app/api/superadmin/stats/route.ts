import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';

export const runtime = 'nodejs';

// Read-only, unfiltered counts across every company — the service-role
// client bypasses RLS, which is exactly the point here (a tenant admin's own
// queries are always scoped to their own company_id; this deliberately
// isn't). No writes anywhere in this route.
export async function GET(req: NextRequest) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;

  const [companies, users, employees, devices, roleRows] = await Promise.all([
    admin.from('companies').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('employees').select('id', { count: 'exact', head: true }),
    admin.from('devices').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('role'),
  ]);

  // Real role breakdown (admin/hr/employee logins), not a fabricated
  // subscription-tier split — used for the dashboard's donut chart.
  const roleCounts: { admin: number; hr: number; employee: number } = { admin: 0, hr: 0, employee: 0 };
  for (const row of roleRows.data ?? []) {
    if (row.role === 'admin') roleCounts.admin++;
    else if (row.role === 'hr') roleCounts.hr++;
    else if (row.role === 'employee') roleCounts.employee++;
  }

  return NextResponse.json({
    totalCompanies: companies.count ?? 0,
    totalUsers: users.count ?? 0,
    totalEmployees: employees.count ?? 0,
    totalDevices: devices.count ?? 0,
    roleCounts,
  });
}
