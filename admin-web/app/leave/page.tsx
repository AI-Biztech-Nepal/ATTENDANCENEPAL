'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig } from '@/lib/weekOff';
import {
  NO_LEAVE_POLICY,
  fetchLeavePolicy,
  fiscalYearEnd,
  fiscalYearLabel,
  fiscalYearStart,
  formatLeaveDays,
  leavePolicyActive,
  loadLeaveLedgers,
  type LeaveEntry,
  type LeaveLedger,
  type LeavePolicy,
} from '@/lib/leaveBalance';
import type { Employee, LeaveRequest } from '@/lib/types';

const ENTRY_LABEL: Record<LeaveEntry['kind'], string> = {
  earned: 'Worked on Week Off',
  absent: 'Absent',
  leave: 'Approved leave',
  'unpaid-leave': 'Unpaid leave',
};

export default function LeavePage() {
  const { system } = useCalendarSystem();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const balanceScrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'requests' | 'balance'>('requests');
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Yearly paid-leave balance (lib/leaveBalance.ts). The saved policy, plus a
  // draft the admin edits on the Leave Balance tab.
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<LeavePolicy>(NO_LEAVE_POLICY);
  const [draftDays, setDraftDays] = useState('0');
  const [draftEarns, setDraftEarns] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [company, setCompany] = useState<{ weeklyOffDay: number | null; rosterMode: 'weekly' | 'monthly' } | null>(null);
  const [ledgers, setLedgers] = useState<Map<string, LeaveLedger>>(new Map());
  const [ledgersLoading, setLedgersLoading] = useState(false);
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);
  // Each employee's own yearly allowance, typed into the Yearly Leave cell.
  // Blank = the company default. Saved one row at a time.
  const [allowanceDraft, setAllowanceDraft] = useState<Record<string, string>>({});
  const [savingAllowanceId, setSavingAllowanceId] = useState<string | null>(null);
  const [allowanceError, setAllowanceError] = useState<string | null>(null);

  function reload() {
    supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRequests(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  useEffect(() => {
    fetchLeavePolicy().then(p => {
      setCompanyId(p.companyId);
      setPolicy(p);
      setDraftDays(String(p.daysPerYear));
      setDraftEarns(p.weekOffWorkEarnsLeave);
    });
    fetchMyCompanyWeekOffConfig().then(c => setCompany({ weeklyOffDay: c.weeklyOffDay, rosterMode: c.rosterMode }));
  }, []);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);

  // Rebuilt whenever the policy, the staff list or an approval changes — an
  // approved leave is drawn from the balance, so the numbers move with it.
  useEffect(() => {
    if (!company || !leavePolicyActive(policy, activeEmployees) || activeEmployees.length === 0) {
      setLedgers(new Map());
      return;
    }
    let cancelled = false;
    setLedgersLoading(true);
    loadLeaveLedgers({
      employees: activeEmployees,
      policy,
      weeklyOffDay: company.weeklyOffDay,
      rosterMode: company.rosterMode,
      until: nepalTodayIso(),
    }).then(m => {
      if (cancelled) return;
      setLedgers(m);
      setLedgersLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [company, policy, activeEmployees, requests]);

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

  const policyDirty = Number(draftDays) !== policy.daysPerYear || draftEarns !== policy.weekOffWorkEarnsLeave;

  async function savePolicy() {
    if (!companyId) return;
    const days = Number(draftDays);
    if (!Number.isFinite(days) || days < 0 || days > 366) {
      setPolicyError('Enter a number of days between 0 and 366.');
      return;
    }
    setSavingPolicy(true);
    setPolicyError(null);
    const { error: saveError } = await supabase
      .from('companies')
      .update({ paid_leave_days_per_year: days, week_off_work_earns_leave: draftEarns })
      .eq('id', companyId);
    setSavingPolicy(false);
    if (saveError) {
      setPolicyError(
        /paid_leave_days_per_year|week_off_work_earns_leave/.test(saveError.message)
          ? 'The leave-balance migration (20260911100000_company_paid_leave_balance.sql) has not been applied to the database yet.'
          : saveError.message
      );
      return;
    }
    setPolicy(p => ({ ...p, daysPerYear: days, weekOffWorkEarnsLeave: draftEarns }));
  }

  /** The Yearly Leave cell's current text: the unsaved draft, else the
   * employee's own saved number, else blank (= company default). */
  function allowanceText(emp: Employee): string {
    if (allowanceDraft[emp.id] !== undefined) return allowanceDraft[emp.id];
    return emp.annual_leave_days != null ? String(emp.annual_leave_days) : '';
  }
  function allowanceDirty(emp: Employee): boolean {
    const draft = allowanceDraft[emp.id];
    return draft !== undefined && draft.trim() !== (emp.annual_leave_days != null ? String(emp.annual_leave_days) : '');
  }

  async function saveAllowance(emp: Employee) {
    const text = (allowanceDraft[emp.id] ?? '').trim();
    const value = text === '' ? null : Number(text);
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 366)) {
      setAllowanceError('Enter whole days between 0 and 366, or leave it blank to use the company default.');
      return;
    }
    setSavingAllowanceId(emp.id);
    setAllowanceError(null);
    const { error: saveError } = await supabase.from('employees').update({ annual_leave_days: value }).eq('id', emp.id);
    setSavingAllowanceId(null);
    if (saveError) {
      setAllowanceError(
        /annual_leave_days/.test(saveError.message)
          ? 'The per-employee leave migration (20260911110000_employee_annual_leave_days.sql) has not been applied to the database yet.'
          : saveError.message
      );
      return;
    }
    setEmployees(list => list.map(e => (e.id === emp.id ? { ...e, annual_leave_days: value } : e)));
    setAllowanceDraft(d => {
      const next = { ...d };
      delete next[emp.id];
      return next;
    });
  }

  /** Yearly Leave cell: the employee's own allowance, blank = default. */
  function allowanceInput(emp: Employee) {
    const dirty = allowanceDirty(emp);
    return (
      <span className="inline-flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        <input
          type="number"
          min={0}
          max={366}
          step={1}
          value={allowanceText(emp)}
          placeholder={formatLeaveDays(policy.daysPerYear)}
          onChange={e => setAllowanceDraft(d => ({ ...d, [emp.id]: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter' && dirty) saveAllowance(emp);
          }}
          aria-label={`Yearly leave for ${emp.name}`}
          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-sm placeholder:text-slate-400"
        />
        <span className="text-xs text-slate-400">{emp.annual_leave_days == null && !dirty ? 'default' : 'days'}</span>
        {dirty && (
          <button
            onClick={() => saveAllowance(emp)}
            disabled={savingAllowanceId === emp.id}
            className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {savingAllowanceId === emp.id ? '…' : 'Save'}
          </button>
        )}
      </span>
    );
  }

  const fyStart = fiscalYearStart(nepalTodayIso());
  const balanceOn = leavePolicyActive(policy, activeEmployees);
  const balanceRows = useMemo(
    () =>
      activeEmployees
        .map(e => ({ emp: e, ledger: ledgers.get(e.id) }))
        .sort((a, b) =>
          (a.emp.fingerprint_id ?? '').localeCompare(b.emp.fingerprint_id ?? '', undefined, { numeric: true, sensitivity: 'base' })
        ),
    [activeEmployees, ledgers]
  );

  const balanceCell = (id: string) => {
    const l = ledgers.get(id);
    if (!l) return <span className="text-slate-400">—</span>;
    return (
      <span className={l.balance <= 0 ? 'font-semibold text-critical-text' : 'font-semibold text-ink'}>
        {formatLeaveDays(l.balance)}d
      </span>
    );
  };

  return (
    <AppShell title="Leave">
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {(
          [
            ['requests', 'Leave Requests'],
            ['balance', 'Leave Balance'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'requests' && (
        <>
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
                  {balanceOn && (
                    <div className="mt-1 text-xs text-slate-500">Leave balance: {balanceCell(r.employee_id)}</div>
                  )}
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
                    {balanceOn && <th className="px-5 py-3 font-medium">Leave Balance</th>}
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
                      {balanceOn && <td className="px-5 py-3">{balanceCell(r.employee_id)}</td>}
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
                      <td colSpan={balanceOn ? 8 : 7} className="px-5 py-8 text-center text-slate-400">
                        No {filter !== 'All' ? filter : ''} leave requests.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'balance' && (
        <>
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-ink">Paid leave policy</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Each employee gets their yearly leave on 1 Shrawan. An absent working day, or approved leave, is paid from the
              balance. Salary is cut only after the balance reaches 0. Unused days lapse at the end of the fiscal year.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Default leave per year</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={366}
                    step={1}
                    value={draftDays}
                    onChange={e => setDraftDays(e.target.value)}
                    className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <span className="text-slate-500">days, for anyone without their own number below</span>
                </span>
              </label>
              <label className="flex items-center gap-2 pb-1.5 text-sm text-ink">
                <input type="checkbox" checked={draftEarns} onChange={e => setDraftEarns(e.target.checked)} className="h-4 w-4 accent-accent" />
                Week Off work earns leave: +1 day for every full {formatLeaveDays(policy.hoursPerLeaveDay)} hours (no half days; 30 min leeway, so a 24h duty = 3 days), not
                overtime
              </label>
              {policyDirty && (
                <button
                  onClick={savePolicy}
                  disabled={savingPolicy || !companyId}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {savingPolicy ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            {policyError && <p className="mt-3 text-sm text-critical">{policyError}</p>}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <div className="text-sm font-semibold text-ink">
                Fiscal year {fiscalYearLabel(fyStart)}
                <span className="ml-2 font-normal text-slate-500">
                  {formatAdDate(fyStart, system)} – {formatAdDate(fiscalYearEnd(fyStart), system)}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {!balanceOn ? 'Set a default or an employee’s yearly leave to start' : ledgersLoading ? 'Calculating…' : 'Counted up to yesterday'}
              </div>
            </div>
            <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">
              Type an employee&apos;s own yearly leave in <strong>Yearly Leave</strong> and press Save. Leave it blank to use the
              default ({formatLeaveDays(policy.daysPerYear)} days).
            </p>
            {allowanceError && <p className="px-5 pt-3 text-sm text-critical">{allowanceError}</p>}

            <div className="divide-y divide-slate-100 md:hidden">
              {balanceRows.map(({ emp, ledger }) => (
                <div key={emp.id} className="p-4">
                  <button
                    onClick={() => setOpenEmployee(o => (o === emp.id ? null : emp.id))}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{emp.name}</div>
                      <div className="text-xs text-slate-500">ID {emp.fingerprint_id ?? '—'}</div>
                    </div>
                    <div className="text-right text-sm">{balanceCell(emp.id)}</div>
                  </button>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                    Yearly leave {allowanceInput(emp)}
                  </div>
                  {ledger && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                      <div>Earned<div className="font-semibold text-good-text">+{formatLeaveDays(ledger.earned)}</div></div>
                      <div>Used<div className="font-semibold text-ink">{formatLeaveDays(ledger.used)}</div></div>
                      <div>Unpaid<div className="font-semibold text-critical-text">{formatLeaveDays(ledger.unpaidDays)}</div></div>
                    </div>
                  )}
                  {openEmployee === emp.id && ledger && <LedgerEntries ledger={ledger} system={system} />}
                </div>
              ))}
            </div>

            <HorizontalScrollButtons targetRef={balanceScrollRef} />
            <div ref={balanceScrollRef} className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">ID</th>
                    <th className="px-5 py-3 font-medium">Employee</th>
                    <th className="px-5 py-3 font-medium">Yearly Leave</th>
                    <th className="px-5 py-3 text-right font-medium">Earned (Week Off)</th>
                    <th className="px-5 py-3 text-right font-medium">Used</th>
                    <th className="px-5 py-3 text-right font-medium">Balance</th>
                    <th className="px-5 py-3 text-right font-medium">Unpaid Days</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map(({ emp, ledger }) => (
                    <Fragment key={emp.id}>
                      <tr
                        onClick={() => setOpenEmployee(o => (o === emp.id ? null : emp.id))}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-5 py-3 text-slate-600">{emp.fingerprint_id ?? '—'}</td>
                        <td className="px-5 py-3 font-medium text-ink">{emp.name}</td>
                        <td className="px-5 py-2">{allowanceInput(emp)}</td>
                        <td className="px-5 py-3 text-right text-good-text">{ledger ? `+${formatLeaveDays(ledger.earned)}` : '—'}</td>
                        <td className="px-5 py-3 text-right text-slate-600">{ledger ? formatLeaveDays(ledger.used) : '—'}</td>
                        <td className="px-5 py-3 text-right">{balanceCell(emp.id)}</td>
                        <td className="px-5 py-3 text-right">
                          {ledger && ledger.unpaidDays > 0 ? (
                            <span className="font-semibold text-critical-text">{formatLeaveDays(ledger.unpaidDays)}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-xs text-slate-400">
                          {ledger ? (openEmployee === emp.id ? 'Hide' : 'Details') : ''}
                        </td>
                      </tr>
                      {openEmployee === emp.id && ledger && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={8} className="px-5 py-3">
                            <LedgerEntries ledger={ledger} system={system} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {balanceRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                        No active employees.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

/** Day-by-day list behind one employee's balance. */
function LedgerEntries({ ledger, system }: { ledger: LeaveLedger; system: ReturnType<typeof useCalendarSystem>['system'] }) {
  if (ledger.entries.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        No absences or Week Off work since {formatAdDate(ledger.from, system)}. The full {formatLeaveDays(ledger.entitlement)} days are
        available.
      </p>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <p className="mb-2 text-xs text-slate-500">Counted from {formatAdDate(ledger.from, system)}.</p>
      <table className="text-left text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="py-1 pr-6 font-semibold">Date</th>
            <th className="py-1 pr-6 font-semibold">What happened</th>
            <th className="py-1 pr-6 text-right font-semibold">Leave</th>
            <th className="py-1 pr-6 text-right font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody>
          {ledger.entries.map(e => (
            <tr key={e.date + e.kind} className="border-t border-slate-200/70">
              <td className="py-1 pr-6 text-slate-600">{formatAdDate(e.date, system)}</td>
              <td className="py-1 pr-6 text-ink">
                {ENTRY_LABEL[e.kind]}
                {e.kind === 'earned' && e.hours != null && (
                  <span className="text-slate-500"> · {formatLeaveDays(e.hours)}h worked</span>
                )}
                {e.unpaid > 0 && <span className="ml-1 font-semibold text-critical-text">· {formatLeaveDays(e.unpaid)}d unpaid</span>}
              </td>
              <td className={`py-1 pr-6 text-right font-semibold ${e.kind === 'earned' ? 'text-good-text' : 'text-ink'}`}>
                {e.kind === 'earned' ? `+${formatLeaveDays(e.days)}` : e.days > 0 ? `−${formatLeaveDays(e.days)}` : '0'}
              </td>
              <td className="py-1 pr-6 text-right text-slate-600">{formatLeaveDays(e.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
