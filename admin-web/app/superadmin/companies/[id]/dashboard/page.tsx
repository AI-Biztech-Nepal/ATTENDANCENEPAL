'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import StatCard from '@/components/StatCard';
import Badge from '@/components/Badge';

type FeedItem = { id: string; employeeName: string; punchType: '0' | '1'; punchTime: string; method: string };
type Data = {
  company: { id: string; name: string };
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  onLeaveToday: number;
  absentToday: number;
  feed: FeedItem[];
};

// Read-only preview of what this company's own admin Dashboard looks like —
// for support/onboarding ("guide them through the page"), not a real login.
// Every number comes from /api/superadmin/companies/[id]/dashboard, which
// reuses the tenant dashboard's own lib/metrics.ts + lib/shift.ts logic —
// see that route's comment for the one deliberate simplification (week-off
// config isn't factored in). Nothing on this page is clickable/editable.
export default function SuperadminCompanyDashboardPreviewPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      const token = sessionData.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/superadmin/companies/${params.id}/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!active) return;
      if (!res.ok) {
        setError(body.error ?? 'Could not load this company’s dashboard preview.');
        return;
      }
      setData(body);
    });
    return () => {
      active = false;
    };
  }, [params.id]);

  return (
    <div>
      <div className="mb-4">
        <Link href="/superadmin/companies" className="text-xs font-medium text-accent hover:underline">
          ← Back to Companies
        </Link>
      </div>

      <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800">
        Read-only preview — this is what <strong>{data?.company.name ?? '…'}</strong>&rsquo;s own admin sees on their Dashboard. Nothing here is
        clickable or editable, and no action here can affect their real data.
      </div>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {data && (
        <>
          <h1 className="mb-6 text-lg font-bold text-ink sm:text-2xl">Dashboard</h1>
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Total Employees" value={String(data.totalEmployees)} hint="Active rosters" />
            <StatCard label="Present Today" value={String(data.presentToday)} />
            <StatCard label="Late Arrivals" value={String(data.lateToday)} hint="Past grace period" />
            <StatCard label="On Leave" value={String(data.onLeaveToday)} hint="Approved today" />
            <StatCard label="Absent Today" value={String(data.absentToday)} hint="No punch, not on leave" />
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-4 text-base font-semibold text-ink">Live Biometric Feed</h2>
            <ul className="space-y-3">
              {data.feed.length === 0 && <li className="text-sm text-slate-400">No punches yet.</li>}
              {data.feed.map(item => (
                <li key={item.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium text-ink">{item.employeeName}</div>
                    <div className="text-xs text-slate-500">{item.method}</div>
                  </div>
                  <div className="text-right">
                    <Badge tone={item.punchType === '0' ? 'good' : 'info'}>{item.punchType === '0' ? 'Check-in' : 'Check-out'}</Badge>
                    <div className="mt-1 text-xs text-slate-500">{new Date(item.punchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
