'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatAdDate, formatDateTime, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
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
// Everything here is a real, unfiltered count, a real timestamp, or a real
// admin/hr roster — no subscription plans/status/renewal/revenue (that
// piece was removed: not useful without real payment gateway credentials).
export default function SuperadminDashboardPage() {
  const { system } = useCalendarSystem();
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

  // Keyed by companyId so each company's own card can show its activity
  // pulse inline instead of duplicating the same company names in a
  // separate "Live Activity" list next to the one they're already in.
  const activityByCompany = new Map<string, RecentActivity>(recentActivity?.map(a => [a.companyId, a]) ?? []);

  return (
    <div>
      <h1 className="mb-6 text-lg font-bold text-ink sm:text-2xl">Dashboard</h1>
      {error && <p className="mb-4 text-sm text-critical">{error}</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">
                All Companies
                {stats && <span className="ml-1 text-[10px] font-normal text-slate-500">({stats.totalCompanies})</span>}
              </h2>
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
                  <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-base font-semibold text-ink">{c.name}</span>
                          {c.status === 'suspended' && <Badge tone="critical">Suspended</Badge>}
                        </div>
                        <div className="truncate text-xs text-slate-500">Signed up {formatAdDate(localDateKey(c.createdAt), system)}</div>
                      </div>
                    </div>
                    {activityByCompany.has(c.id) && (
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
                          </span>
                          {formatRelativeTime(activityByCompany.get(c.id)!.lastPunchAt)}
                        </span>
                        <span className="whitespace-nowrap text-[10px] text-slate-400">
                          {formatDateTime(activityByCompany.get(c.id)!.lastPunchAt, system)}
                        </span>
                      </div>
                    )}
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
                      <div className="truncate text-xs text-slate-500">Signed up {formatAdDate(localDateKey(c.createdAt), system)}</div>
                    </div>
                  </div>

                  <div className="flex w-32 shrink-0 flex-col items-center gap-0.5">
                    {activityByCompany.has(c.id) && (
                      <>
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
                          </span>
                          {formatRelativeTime(activityByCompany.get(c.id)!.lastPunchAt)}
                        </span>
                        <span className="whitespace-nowrap text-[10px] text-slate-400">
                          {formatDateTime(activityByCompany.get(c.id)!.lastPunchAt, system)}
                        </span>
                      </>
                    )}
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
                      <span className="shrink-0 text-xs text-slate-500">{formatAdDate(localDateKey(c.createdAt), system)}</span>
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
