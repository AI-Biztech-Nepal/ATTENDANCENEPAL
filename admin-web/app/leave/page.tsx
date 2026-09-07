'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, LeaveRequest } from '@/lib/types';

export default function LeavePage() {
  const { system } = useCalendarSystem();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRequests(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

  const filtered = useMemo(
    () => (filter === 'All' ? requests : requests.filter(r => r.status === filter)),
    [requests, filter]
  );

  async function review(id: string, status: 'approved' | 'rejected') {
    setBusyId(id);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from('leave_requests')
      .update({ status, reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    reload();
  }

  function daysBetween(start: string, end: string) {
    return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
  }

  return (
    <AppShell title="Leave Requests">
      {error && <p className="mb-4 text-sm text-critical">{error}</p>}
      <div className="mb-5 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected', 'All'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
              filter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100 md:hidden">
          {filtered.map(r => (
            <div key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{employeeName(r.employee_id)}</div>
                  <div className="text-xs capitalize text-slate-500">{r.leave_type}</div>
                </div>
                <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'critical' : 'warning'}>{r.status}</Badge>
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {formatAdDate(r.start_date, system)} → {formatAdDate(r.end_date, system)}
                <span className="text-slate-400"> · {daysBetween(r.start_date, r.end_date)}d</span>
              </div>
              {r.reason && <div className="mt-1 text-xs text-slate-500">{r.reason}</div>}
              {r.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busyId === r.id}
                    onClick={() => review(r.id, 'approved')}
                    className="rounded-md bg-good px-3 py-1.5 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => review(r.id, 'rejected')}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">No {filter !== 'All' ? filter : ''} leave requests.</p>
          )}
        </div>

        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Dates</th>
              <th className="px-5 py-3 font-medium">Days</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{employeeName(r.employee_id)}</td>
                <td className="px-5 py-3 capitalize text-slate-600">{r.leave_type}</td>
                <td className="px-5 py-3 text-slate-600">
                  {formatAdDate(r.start_date, system)} → {formatAdDate(r.end_date, system)}
                </td>
                <td className="px-5 py-3 text-slate-600">{daysBetween(r.start_date, r.end_date)}</td>
                <td className="px-5 py-3 max-w-xs truncate text-slate-600">{r.reason ?? '—'}</td>
                <td className="px-5 py-3">
                  <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'critical' : 'warning'}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-5 py-3">
                  {r.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === r.id}
                        onClick={() => review(r.id, 'approved')}
                        className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => review(r.id, 'rejected')}
                        className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Reviewed</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                  No {filter !== 'All' ? filter : ''} leave requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </AppShell>
  );
}
