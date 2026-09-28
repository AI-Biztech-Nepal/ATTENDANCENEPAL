'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';
import CompanyDetailModal from '@/components/CompanyDetailModal';

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

const AVATAR_COLORS = [
  'bg-violet-50 text-violet-600',
  'bg-accent-light text-accent',
  'bg-info-bg text-info',
  'bg-warning-bg text-warning',
  'bg-pink-50 text-pink-600',
  'bg-blue-50 text-blue-600',
];

export default function SuperadminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  async function loadCompanies() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch('/api/superadmin/companies', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Could not load companies.');
      return;
    }
    setCompanies(body.companies);
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies ?? [];
    return (companies ?? []).filter(c => c.name.toLowerCase().includes(q));
  }, [companies, search]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink sm:text-2xl">Companies</h1>
          <p className="text-sm text-slate-500">{companies ? `${companies.length} registered` : 'Overview of all registered companies'}</p>
        </div>
        <input
          type="text"
          placeholder="Search company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent sm:w-64"
        />
      </div>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}
      {!companies && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {companies?.length === 0 && <p className="text-sm text-slate-400">No companies yet.</p>}
      {companies && companies.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-slate-400">No companies match &ldquo;{search}&rdquo;.</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
            className="min-w-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-accent hover:shadow-md sm:p-5"
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

            <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 py-2.5 text-center">
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
                <ul className="space-y-2">
                  {c.adminUsers.map(u => (
                    <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{u.name}</div>
                        <div className="truncate text-xs text-slate-500">{u.email}</div>
                      </div>
                      <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{u.role}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedCompanyId && (
        <CompanyDetailModal
          companyId={selectedCompanyId}
          onClose={() => setSelectedCompanyId(null)}
          onChanged={loadCompanies}
          onDeleted={() => {
            setSelectedCompanyId(null);
            loadCompanies();
          }}
        />
      )}
    </div>
  );
}
