'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';

type User = { id: string; name: string; email: string; role: string };
type EmployeeRow = {
  id: string;
  employee_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  status: 'active' | 'inactive';
  date_of_joining: string | null;
};
type SyncSummary = { at: string; status: string; error: string | null } | null;
type DeviceRow = {
  id: string;
  name: string;
  ip_address: string;
  status: 'online' | 'offline';
  last_sync: string | null;
  lastPull: SyncSummary;
  lastUserSync: SyncSummary;
};
type Detail = {
  company: { id: string; name: string; createdAt: string; status: 'active' | 'suspended'; suspendedAt: string | null };
  users: User[];
  employees: EmployeeRow[];
  devices: DeviceRow[];
};

// Detail view for one company, fetched on open via
// /api/superadmin/companies/[id] — read-only except for the Danger Zone at
// the bottom (suspend/reactivate and permanent delete), both gated the same
// way as every other superadmin write: server-side requireSuperadmin() on
// the API route, not anything client-side here.
export default function CompanyDetailModal({
  companyId,
  onClose,
  onChanged,
  onDeleted,
}: {
  companyId: string;
  onClose: () => void;
  /** Called after a suspend/reactivate that succeeded — company list should refetch. */
  onChanged: () => void;
  /** Called after a successful permanent delete — company is gone, close this modal. */
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/superadmin/companies/${companyId}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Could not load company details.');
      return;
    }
    setDetail(body);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Suspend/reactivate: single confirm, since it's fully reversible.
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendConfirming, setSuspendConfirming] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  async function callAction(path: string, init: RequestInit) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('No session.');
    const res = await fetch(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Request failed.');
    return body;
  }

  async function handleSuspendToggle() {
    if (!detail) return;
    const action = detail.company.status === 'active' ? 'suspend' : 'reactivate';
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      await callAction(`/api/superadmin/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify({ action }) });
      setSuspendConfirming(false);
      await load();
      onChanged();
    } catch (e) {
      setSuspendError(e instanceof Error ? e.message : 'Could not update company status.');
    } finally {
      setSuspendBusy(false);
    }
  }

  // Hard delete: two steps on top of the server's own name-match check —
  // an explicit "I understand" step, then type-the-company-name-to-confirm
  // (only then does the Delete button even enable).
  const [deleteStep, setDeleteStep] = useState<'closed' | 'warn' | 'confirm'>('closed');
  const [deleteNameInput, setDeleteNameInput] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function closeDeleteFlow() {
    setDeleteStep('closed');
    setDeleteNameInput('');
    setDeleteError(null);
  }

  async function handleConfirmDelete() {
    if (!detail) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await callAction(`/api/superadmin/companies/${companyId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmName: deleteNameInput }),
      });
      onDeleted();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete company.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-ink">{detail?.company.name ?? 'Loading…'}</h3>
              {detail?.company.status === 'suspended' && <Badge tone="critical">Suspended</Badge>}
            </div>
            {detail && <p className="text-xs text-slate-500">Signed up {new Date(detail.company.createdAt).toLocaleDateString()}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-critical">{error}</p>}
        {!detail && !error && <p className="text-sm text-slate-400">Loading…</p>}

        {detail && (
          <div className="space-y-6">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">Admin / HR / Employee logins ({detail.users.length})</h4>
                <Link
                  href={`/superadmin/companies/${detail.company.id}/dashboard`}
                  className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                >
                  View their Dashboard (read-only)
                </Link>
              </div>
              {detail.users.length === 0 ? (
                <p className="text-xs text-slate-400">None found.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.users.map(u => (
                    <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{u.name}</div>
                        <div className="truncate text-xs text-slate-500">{u.email}</div>
                      </div>
                      <Badge tone={u.role === 'admin' ? 'info' : u.role === 'hr' ? 'good' : 'neutral'}>{u.role}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-ink">Employees ({detail.employees.length})</h4>
              {detail.employees.length === 0 ? (
                <p className="text-xs text-slate-400">No employees on record.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.employees.map(e => (
                    <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{e.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {e.employee_code}
                          {e.department ? ` · ${e.department}` : ''}
                          {e.designation ? ` · ${e.designation}` : ''}
                        </div>
                      </div>
                      <Badge tone={e.status === 'active' ? 'good' : 'neutral'}>{e.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-ink">Devices ({detail.devices.length})</h4>
              {detail.devices.length === 0 ? (
                <p className="text-xs text-slate-400">No devices registered.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.devices.map(d => (
                    <li key={d.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{d.name}</div>
                          <div className="truncate text-xs text-slate-500">{d.ip_address}</div>
                        </div>
                        <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
                      </div>
                      <div className="space-y-1 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
                        <div>Last active: {d.last_sync ? new Date(d.last_sync).toLocaleString() : 'never'}</div>
                        <div className="flex items-center gap-1.5">
                          Last pull (attendance logs):{' '}
                          {d.lastPull ? (
                            <>
                              {new Date(d.lastPull.at).toLocaleString()}
                              <Badge tone={d.lastPull.status === 'success' ? 'good' : 'critical'}>{d.lastPull.status}</Badge>
                            </>
                          ) : (
                            'never'
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          Last user sync:{' '}
                          {d.lastUserSync ? (
                            <>
                              {new Date(d.lastUserSync.at).toLocaleString()}
                              <Badge tone={d.lastUserSync.status === 'success' ? 'good' : 'critical'}>{d.lastUserSync.status}</Badge>
                            </>
                          ) : (
                            'never'
                          )}
                        </div>
                        {(d.lastPull?.error || d.lastUserSync?.error) && (
                          <div className="text-critical">Last error: {d.lastPull?.error ?? d.lastUserSync?.error}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-critical/30 bg-critical-bg/40 p-4">
              <h4 className="mb-3 text-sm font-semibold text-critical-text">Danger zone</h4>

              <div className="mb-4 flex items-center justify-between gap-3 border-b border-critical/20 pb-4">
                <div>
                  <div className="text-sm font-medium text-ink">
                    {detail.company.status === 'active' ? 'Suspend this company' : 'Reactivate this company'}
                  </div>
                  <p className="text-xs text-slate-500">
                    {detail.company.status === 'active'
                      ? "Bans every login under this company — they can't sign in until reactivated. All data stays intact."
                      : 'Unbans every login under this company. They can sign in again immediately.'}
                  </p>
                </div>
                {suspendConfirming ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => setSuspendConfirming(false)}
                      disabled={suspendBusy}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSuspendToggle}
                      disabled={suspendBusy}
                      className="rounded-lg bg-critical px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {suspendBusy ? 'Working…' : `Confirm ${detail.company.status === 'active' ? 'suspend' : 'reactivate'}`}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSuspendConfirming(true)}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-ink hover:bg-slate-50"
                  >
                    {detail.company.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                )}
              </div>
              {suspendError && <p className="mb-4 text-xs text-critical">{suspendError}</p>}

              {deleteStep === 'closed' && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-ink">Delete this company permanently</div>
                    <p className="text-xs text-slate-500">
                      Destroys every employee, device, attendance record, and login under this company. No undo.
                    </p>
                  </div>
                  <button
                    onClick={() => setDeleteStep('warn')}
                    className="shrink-0 rounded-lg bg-critical px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  >
                    Delete…
                  </button>
                </div>
              )}

              {deleteStep === 'warn' && (
                <div className="rounded-lg border border-critical/40 bg-white p-3">
                  <p className="mb-3 text-sm text-ink">
                    This permanently deletes <strong>{detail.company.name}</strong>: {detail.employees.length} employee
                    {detail.employees.length === 1 ? '' : 's'}, {detail.devices.length} device{detail.devices.length === 1 ? '' : 's'},{' '}
                    {detail.users.length} login{detail.users.length === 1 ? '' : 's'}, and all of their attendance/payroll/leave history.
                    This cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={closeDeleteFlow} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      Cancel
                    </button>
                    <button
                      onClick={() => setDeleteStep('confirm')}
                      className="rounded-lg bg-critical px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                    >
                      I understand, continue
                    </button>
                  </div>
                </div>
              )}

              {deleteStep === 'confirm' && (
                <div className="rounded-lg border border-critical/40 bg-white p-3">
                  <label className="mb-1.5 block text-xs text-ink">
                    Type <strong>{detail.company.name}</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    value={deleteNameInput}
                    onChange={e => setDeleteNameInput(e.target.value)}
                    autoFocus
                    className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-critical"
                  />
                  {deleteError && <p className="mb-3 text-xs text-critical">{deleteError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={closeDeleteFlow}
                      disabled={deleteBusy}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmDelete}
                      disabled={deleteBusy || deleteNameInput !== detail.company.name}
                      className="rounded-lg bg-critical px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deleteBusy ? 'Deleting…' : 'Permanently delete'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
