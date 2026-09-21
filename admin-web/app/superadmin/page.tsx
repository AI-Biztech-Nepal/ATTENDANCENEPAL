'use client';

import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';
import StatCard from '@/components/StatCard';
import CompanyDetailModal from '@/components/CompanyDetailModal';
import Badge from '@/components/Badge';

type AdminUser = { id: string; name: string; email: string; role: string };
type Company = {
  id: string;
  name: string;
  createdAt: string;
  status: 'active' | 'suspended';
  userCount: number;
  employeeCount: number;
  deviceCount: number;
  adminUsers: AdminUser[];
};
type Stats = {
  totalCompanies: number;
  totalUsers: number;
  totalEmployees: number;
  totalDevices: number;
  roleCounts: { admin: number; hr: number; employee: number };
};
type RecentActivity = { companyId: string; companyName: string; lastPunchAt: string };

const RECENT_ACTIVITY_POLL_MS = 15000;

function formatRelativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const AVATAR_COLORS = [
  'bg-violet-50 text-violet-600',
  'bg-accent-light text-accent',
  'bg-info-bg text-info',
  'bg-warning-bg text-warning',
  'bg-pink-50 text-pink-600',
  'bg-blue-50 text-blue-600',
];
const ROLE_COLORS: Record<string, string> = { admin: '#7c3aed', hr: '#0d9488', employee: '#2563eb' };
const ROLE_LABELS: Record<string, string> = { admin: 'Admin', hr: 'HR', employee: 'Employee' };

// Everything here is a real, unfiltered count, a real timestamp, or a real
// admin/hr roster — no subscription plans/status/renewal/revenue (that
// piece was removed: not useful without real payment gateway credentials).
export default function SuperadminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'employees'>('newest');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[] | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'tile'>('grid');

  async function loadDashboard() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [statsRes, companiesRes] = await Promise.all([
      fetch('/api/superadmin/stats', { headers }),
      fetch('/api/superadmin/companies', { headers }),
    ]);
    const statsBody = await statsRes.json().catch(() => ({}));
    const companiesBody = await companiesRes.json().catch(() => ({}));
    if (!statsRes.ok) {
      setError(statsBody.error ?? 'Could not load stats.');
      return;
    }
    setStats(statsBody);
    if (companiesRes.ok) setCompanies(companiesBody.companies);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  // Polled, not a Realtime subscription: "superadmin" is a server-side email
  // allowlist (see requireSuperadmin), not a role any RLS policy grants
  // cross-tenant SELECT to — a client-side .channel() subscription against
  // attendance_logs would only ever see this admin's own company's rows (if
  // any), same as every other RLS-scoped table. Only the service-role API
  // route can see across every company, so live-ness here comes from
  // refetching it on an interval instead.
  useEffect(() => {
    async function loadRecentActivity() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/superadmin/recent-activity', { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setRecentActivity(body.companies);
    }
    loadRecentActivity();
    const id = setInterval(loadRecentActivity, RECENT_ACTIVITY_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let rows = companies ?? [];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(c => c.name.toLowerCase().includes(q));
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'employees') return b.employeeCount - a.employeeCount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return rows;
  }, [companies, search, sortBy]);

  const recentCompanies = [...(companies ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const roleBreakdown = stats
    ? (['admin', 'hr', 'employee'] as const)
        .map(role => ({ role, name: ROLE_LABELS[role], value: stats.roleCounts[role], color: ROLE_COLORS[role] }))
        .filter(r => r.value > 0)
    : [];

  return (
    <div>
      <h1 className="mb-6 text-lg font-bold text-ink sm:text-2xl">Dashboard</h1>
      {error && <p className="mb-4 text-sm text-critical">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Companies"
          value={stats ? String(stats.totalCompanies) : '—'}
          hint="All time"
          icon={<BuildingIcon className="h-5 w-5" />}
          iconClassName="bg-violet-50 text-violet-600"
        />
        <StatCard
          label="Total Employees"
          value={stats ? String(stats.totalEmployees) : '—'}
          hint="Across all companies"
          icon={<BriefcaseIcon className="h-5 w-5" />}
          iconClassName="bg-info-bg text-info"
        />
        <StatCard
          label="Registered Devices"
          value={stats ? String(stats.totalDevices) : '—'}
          hint="Biometric terminals"
          icon={<DeviceIcon className="h-5 w-5" />}
          iconClassName="bg-warning-bg text-warning"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">All Companies</h2>
              <p className="text-xs text-slate-500">Overview of all registered companies</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                placeholder="Search company…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent sm:w-48"
              />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="newest">Newest first</option>
                <option value="name">Name (A–Z)</option>
                <option value="employees">Employees (most first)</option>
              </select>
              <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  className={`rounded-md p-1.5 ${viewMode === 'grid' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <GridIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('tile')}
                  title="Tile view"
                  aria-pressed={viewMode === 'tile'}
                  className={`rounded-md p-1.5 ${viewMode === 'tile' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <ListIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {!companies && !error && <p className="text-sm text-slate-400">Loading…</p>}
          {companies?.length === 0 && <p className="text-sm text-slate-400">No companies yet.</p>}
          {companies && companies.length > 0 && filtered.length === 0 && <p className="text-sm text-slate-400">No companies match your search.</p>}

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((c, i) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedCompanyId(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedCompanyId(c.id);
                    }
                  }}
                  className="min-w-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-accent hover:shadow-md"
                >
                  <div className="mb-3 flex min-w-0 items-center gap-3">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-base font-semibold text-ink">{c.name}</span>
                        {c.status === 'suspended' && <Badge tone="critical">Suspended</Badge>}
                      </div>
                      <div className="truncate text-xs text-slate-500">Signed up {new Date(c.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 py-2.5 text-center">
                    <div>
                      <div className="text-sm font-bold text-ink">{c.userCount}</div>
                      <div className="text-[11px] text-slate-500">Users</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-ink">{c.employeeCount}</div>
                      <div className="text-[11px] text-slate-500">Employees</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-ink">{c.deviceCount}</div>
                      <div className="text-[11px] text-slate-500">Devices</div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Admin / HR users</div>
                    {c.adminUsers.length === 0 ? (
                      <p className="text-xs text-slate-400">None found.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {c.adminUsers.map(u => (
                          <li key={u.id} className="min-w-0 text-sm">
                            <div className="truncate font-medium text-ink">{u.name}</div>
                            <div className="truncate text-xs text-slate-500">{u.email}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((c, i) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedCompanyId(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedCompanyId(c.id);
                    }
                  }}
                  className="flex min-w-0 cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-accent hover:shadow-md sm:flex-row sm:items-center sm:gap-5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                    >
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
                        {c.status === 'suspended' && <Badge tone="critical">Suspended</Badge>}
                      </div>
                      <div className="truncate text-xs text-slate-500">Signed up {new Date(c.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4 sm:gap-6">
                    <div className="text-center">
                      <div className="text-sm font-bold text-ink">{c.userCount}</div>
                      <div className="text-[11px] text-slate-500">Users</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-ink">{c.employeeCount}</div>
                      <div className="text-[11px] text-slate-500">Employees</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-ink">{c.deviceCount}</div>
                      <div className="text-[11px] text-slate-500">Devices</div>
                    </div>
                  </div>

                  <div className="min-w-0 shrink-0 border-t border-slate-100 pt-3 sm:w-48 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Admin / HR</div>
                    {c.adminUsers.length === 0 ? (
                      <p className="text-xs text-slate-400">None found.</p>
                    ) : (
                      <p className="truncate text-sm font-medium text-ink">
                        {c.adminUsers[0].name}
                        {c.adminUsers.length > 1 && <span className="text-xs font-normal text-slate-500"> +{c.adminUsers.length - 1} more</span>}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Showing all {filtered.length} companies
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">System Overview</h2>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-slate-500">Total Users</span>
                <span className="font-semibold text-ink">{stats ? stats.totalUsers : '—'}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-500">Total Employees</span>
                <span className="font-semibold text-ink">{stats ? stats.totalEmployees : '—'}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-500">Registered Devices</span>
                <span className="font-semibold text-ink">{stats ? stats.totalDevices : '—'}</span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">User Roles (platform-wide)</h2>
            {roleBreakdown.length === 0 ? (
              <p className="text-sm text-slate-400">No users yet.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={roleBreakdown} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65} paddingAngle={2}>
                      {roleBreakdown.map(r => (
                        <Cell key={r.role} fill={r.color} stroke="#fff" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [`${v} users`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 space-y-1.5 text-xs">
                  {roleBreakdown.map(r => (
                    <li key={r.role} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                        {r.name}
                      </span>
                      <span className="font-medium text-ink">{r.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-good" />
              </span>
              <h2 className="text-sm font-semibold text-ink">Live Activity</h2>
            </div>
            {recentActivity === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : recentActivity.length === 0 ? (
              <p className="text-sm text-slate-400">No punches recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {recentActivity.map(a => (
                  <li key={a.companyId}>
                    <button
                      onClick={() => setSelectedCompanyId(a.companyId)}
                      className="flex w-full items-center justify-between gap-2 text-left text-sm hover:text-accent"
                    >
                      <span className="truncate font-medium text-ink">{a.companyName}</span>
                      <span className="shrink-0 text-xs text-slate-500">{formatRelativeTime(a.lastPunchAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Recent Company Registrations</h2>
            {recentCompanies.length === 0 ? (
              <p className="text-sm text-slate-400">No companies yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {recentCompanies.map(c => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedCompanyId(c.id)}
                      className="flex w-full items-center justify-between gap-2 text-left text-sm hover:text-accent"
                    >
                      <span className="truncate font-medium text-ink">{c.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {selectedCompanyId && (
        <CompanyDetailModal
          companyId={selectedCompanyId}
          onClose={() => setSelectedCompanyId(null)}
          onChanged={loadDashboard}
          onDeleted={() => {
            setSelectedCompanyId(null);
            loadDashboard();
          }}
        />
      )}
    </div>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path strokeLinecap="round" d="M8 7h1M8 11h1M8 15h1M15 7h1M15 11h1M15 15h1M10 21v-3h4v3" />
    </svg>
  );
}
function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function DeviceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path strokeLinecap="round" d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}
function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}
function ListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
      <rect x="3" y="10.5" width="18" height="4.5" rx="1.5" />
      <rect x="3" y="17" width="18" height="4.5" rx="1.5" />
    </svg>
  );
}
