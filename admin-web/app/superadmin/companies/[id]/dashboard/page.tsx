'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import StatCard from '@/components/StatCard';
import Badge from '@/components/Badge';

type DetailRow = { id: string; primary: string; secondary?: string };
type DetailKey = 'total' | 'present' | 'late' | 'leave' | 'weekOff' | 'absent' | 'hours' | 'overtime';
type FeedItem = { id: string; employeeName: string; punchType: '0' | '1' | '2' | '3'; punchTime: string; method: string };
type DeviceRow = { id: string; name: string; ipAddress: string; status: 'online' | 'offline'; lastSync: string | null };
type Data = {
  company: { id: string; name: string; createdAt: string };
  stats: {
    totalEmployees: number;
    presentToday: number;
    lateToday: number;
    onLeaveToday: number;
    weekOffToday: number;
    absentToday: number;
    workHoursToday: number;
    overtimeToday: number;
    attendancePct: number;
  };
  todayIsWeekOff: boolean;
  todayHolidayName: string | null;
  details: Record<DetailKey, DetailRow[]>;
  trend: { day: string; present: number }[];
  deptBreakdown: { name: string; value: number; color: string }[];
  devices: DeviceRow[];
  feed: FeedItem[];
};

const DETAIL_TITLES: Record<DetailKey, string> = {
  total: 'Total Employees',
  present: 'Present Today',
  late: 'Late Arrivals',
  leave: 'On Leave Today',
  weekOff: 'Week-off Today',
  absent: 'Absent Today',
  hours: 'Total Work Hours',
  overtime: 'Overtime',
};

function punchTypeLabel(punchType: FeedItem['punchType']) {
  if (punchType === '0') return 'Check-in';
  if (punchType === '1') return 'Check-out';
  return 'Punch';
}

// Full read-only mirror of what this one company's own admin sees on their
// Dashboard — every stat card, both charts, and Device Sync Activity — built
// for support/onboarding ("guide them through the page"), not a real login.
// Data comes from /api/superadmin/companies/[id]/dashboard, which reuses the
// tenant dashboard's own lib/metrics.ts + lib/shift.ts + lib/weekOff.ts logic
// against this companyId specifically, so the numbers match exactly what
// that company's own admin sees. Nothing here is clickable in a way that
// changes data — stat cards only open a read-only detail list, same as the
// real Dashboard's own click-to-drill-down panels.
export default function SuperadminCompanyDashboardPreviewPage() {
  const { system } = useCalendarSystem();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<DetailKey | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      const token = sessionData.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/superadmin/companies/${params.id}/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!active) return;
      if (!res.ok) {
        setError(body.error ?? 'Could not load this company’s dashboard.');
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
        Read-only view — this is what <strong>{data?.company.name ?? '…'}</strong>&rsquo;s own admin sees on their Dashboard. Nothing here is
        editable, and no action here can affect their real data.
      </div>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {data && (
        <>
          <div className="mb-6">
            <h1 className="text-lg font-bold text-ink sm:text-2xl">Dashboard</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {data.company.name} · Registered on this platform {formatAdDate(localDateKey(data.company.createdAt), system)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            <StatCard label="Total Employees" value={String(data.stats.totalEmployees)} hint="Active rosters" onClick={() => setDetailKey('total')} />
            <StatCard
              label="Present Today"
              value={String(data.stats.presentToday)}
              hint={`${data.stats.attendancePct}% attendance`}
              onClick={() => setDetailKey('present')}
            />
            <StatCard label="Late Arrivals" value={String(data.stats.lateToday)} hint="Past grace period" onClick={() => setDetailKey('late')} />
            <StatCard label="On Leave" value={String(data.stats.onLeaveToday)} hint="Approved today" onClick={() => setDetailKey('leave')} />
            <StatCard
              label="Week-off Today"
              value={String(data.stats.weekOffToday)}
              hint={data.todayIsWeekOff ? (data.todayHolidayName ?? 'Recurring weekly day') : 'Employees off today'}
              onClick={() => setDetailKey('weekOff')}
            />
            <StatCard label="Absent Today" value={String(data.stats.absentToday)} hint="No punch, not on leave" onClick={() => setDetailKey('absent')} />
            <StatCard label="Total Work Hours" value={data.stats.workHoursToday.toFixed(1)} hint="Today, all staff" onClick={() => setDetailKey('hours')} />
            <StatCard
              className="col-span-2 sm:col-span-1"
              label="Overtime"
              value={`${data.stats.overtimeToday.toFixed(1)} hrs`}
              hint="Today, all staff"
              onClick={() => setDetailKey('overtime')}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
              <h2 className="mb-4 text-base font-semibold text-ink">Weekly Attendance Trend</h2>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: number) => [`${v} present`, '']} />
                  <Line type="monotone" dataKey="present" name="Present" stroke="#0d9488" strokeWidth={2} dot={{ r: 4, fill: '#0d9488' }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">Live Biometric Feed</h2>
              </div>
              <ul className="space-y-3">
                {data.feed.length === 0 && <li className="text-sm text-slate-400">No punches yet.</li>}
                {data.feed.map(item => (
                  <li key={item.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="text-sm font-medium text-ink">{item.employeeName}</div>
                      <div className="text-xs text-slate-500">{item.method}</div>
                    </div>
                    <div className="text-right">
                      <Badge tone={item.punchType === '0' ? 'good' : item.punchType === '1' ? 'info' : 'warning'}>{punchTypeLabel(item.punchType)}</Badge>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(item.punchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <h2 className="mb-4 text-base font-semibold text-ink">Department Breakdown</h2>
              {data.deptBreakdown.length === 0 ? (
                <p className="text-sm text-slate-400">No employees yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={data.deptBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {data.deptBreakdown.map(d => (
                        <Cell key={d.name} fill={d.color} stroke="#fff" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Legend
                      layout="horizontal"
                      verticalAlign="bottom"
                      align="center"
                      iconType="circle"
                      wrapperStyle={{ paddingTop: 12 }}
                      formatter={(value: string) => <span className="text-sm text-slate-600">{value}</span>}
                    />
                    <Tooltip formatter={(v: number, n: string) => [`${v} staff`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <h2 className="mb-4 text-base font-semibold text-ink">Device Sync Activity</h2>
              <ul className="space-y-3">
                {data.devices.length === 0 && <li className="text-sm text-slate-400">No devices registered.</li>}
                {data.devices.map(d => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-medium text-ink">{d.name}</div>
                      <div className="text-xs text-slate-500">
                        {d.ipAddress} · Sync: {d.lastSync ? new Date(d.lastSync).toLocaleTimeString() : 'never'}
                      </div>
                    </div>
                    <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {detailKey && (
            <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setDetailKey(null)}>
              <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink">{DETAIL_TITLES[detailKey]}</h3>
                  <button onClick={() => setDetailKey(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                    ✕
                  </button>
                </div>
                {data.details[detailKey].length === 0 ? (
                  <p className="text-sm text-slate-400">Nothing to show here.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.details[detailKey].map(row => (
                      <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                        <span className="font-medium text-ink">{row.primary}</span>
                        {row.secondary && <span className="shrink-0 text-xs text-slate-500">{row.secondary}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
