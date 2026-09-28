import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';

export const runtime = 'nodejs';

// This endpoint only answers a yes/no question and returns no data, so
// unlike the other /api/superadmin/* routes it always responds 200 — the
// /superadmin layout just checks the boolean, it never needs to branch on
// HTTP status.
export async function GET(req: NextRequest) {
  const result = await requireSuperadmin(req);
  if ('response' in result) {
    return NextResponse.json({ isSuperadmin: false });
  }
  return NextResponse.json({ isSuperadmin: true });
}
