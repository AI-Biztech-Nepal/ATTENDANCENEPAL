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

  // Ordered scan capped at a bounded window — a single company spamming
  // punches can't push every other company off this list, since we stop
  // as soon as MAX_COMPANIES distinct company_ids have been seen rather
  // than scanning a fixed row count that a busy company could dominate.
  const MAX_COMPANIES = 10;
  const PAGE = 200;
  const seen = new Map<string, string>(); // company_id -> most recent created_at
  for (let from = 0; seen.size < MAX_COMPANIES && from < 2000; from += PAGE) {
    const { data, error } = await admin
      .from('attendance_logs')
      .select('company_id, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.company_id || seen.has(row.company_id)) continue;
      seen.set(row.company_id, row.created_at);
    }
    if (data.length < PAGE) break;
  }

  if (seen.size === 0) return NextResponse.json({ companies: [] });

  const { data: companies, error: companiesError } = await admin
    .from('companies')
    .select('id, name')
    .in('id', [...seen.keys()]);
  if (companiesError) return NextResponse.json({ error: companiesError.message }, { status: 500 });
  const nameById = new Map((companies ?? []).map(c => [c.id, c.name]));

  const rows: RecentActivityRow[] = [...seen.entries()]
    .map(([companyId, lastPunchAt]) => ({ companyId, companyName: nameById.get(companyId) ?? '(unknown)', lastPunchAt }))
    .sort((a, b) => new Date(b.lastPunchAt).getTime() - new Date(a.lastPunchAt).getTime())
    .slice(0, MAX_COMPANIES);

  return NextResponse.json({ companies: rows });
}
