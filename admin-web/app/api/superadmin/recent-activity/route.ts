import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';

export const runtime = 'nodejs';

type RecentActivityRow = { companyId: string; companyName: string; lastPunchAt: string };

// Read-only, cross-tenant — same service-role bypass as the other
// /api/superadmin/* routes. attendance_logs.company_id is stamped by a
// trigger on insert (see stamp_company_id_from_employee in
// 20260805090000_companies_and_tenant_columns.sql), so this needs no join
// through employees to know which company a punch belongs to.
//
// created_at (server receipt time), not punch_time, is what "recently
// active" means here — punch_time can be backdated by hours during a
// device's first bulk history sync, which would make a company that just
// connected for the first time look like its most recent activity was
// whenever its oldest queued punch happened to occur.
export async function GET(req: NextRequest) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;

  // One "latest punch" lookup per company, all in parallel. This used to be
  // a paged scan of the newest punches that stopped once 10 distinct
  // companies had shown up — with fewer than 10 companies punching at all,
  // it never stopped early and read all 2000 rows in 10 sequential round
  // trips (1-3s) on every 15s poll. A per-company limit(1) also can't be
  // crowded out by one busy company, which the scan's 2000-row window could.
  const MAX_COMPANIES = 10;
  const { data: companies, error: companiesError } = await admin.from('companies').select('id, name');
  if (companiesError) return NextResponse.json({ error: companiesError.message }, { status: 500 });

  const latest = await Promise.all(
    (companies ?? []).map(c =>
      admin
        .from('attendance_logs')
        .select('created_at')
        .eq('company_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data, error }) => ({ company: c, lastPunchAt: data?.created_at as string | undefined, error }))
    )
  );
  const failed = latest.find(l => l.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const rows: RecentActivityRow[] = latest
    .filter(l => l.lastPunchAt)
    .map(l => ({ companyId: l.company.id, companyName: l.company.name, lastPunchAt: l.lastPunchAt! }))
    .sort((a, b) => new Date(b.lastPunchAt).getTime() - new Date(a.lastPunchAt).getTime())
    .slice(0, MAX_COMPANIES);

  return NextResponse.json({ companies: rows });
}
