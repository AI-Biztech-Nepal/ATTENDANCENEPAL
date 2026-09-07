'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalDateKey, nepalDateTimeToUtcMs, nepalTodayIso, punchMinuteOfDay, punchTypeLabel, selectDayPunches } from '@/lib/shift';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';
import type { AttendanceLog, Employee, CorrectionRequest, AttendanceGpsRequest } from '@/lib/types';

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Punch timestamp -> "HH:MM" in Nepal local time, for the time inputs. */
function punchHhmm(iso: string) {
  const m = punchMinuteOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** First day of the current month, 'YYYY-MM-DD' (AD). */
function startOfThisMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

type EmptyDay = { employeeId: string; employeeName: string; date: string; existing: string; missing: 'Check In' | 'Check Out' };

type UnifiedRequest =
  | { kind: 'correction'; id: string; employee_id: string; status: string; created_at: string; data: CorrectionRequest }
  | { kind: 'gps'; id: string; employee_id: string; status: string; created_at: string; data: AttendanceGpsRequest };

export default function CorrectionsPage() {
  const { system } = useCalendarSystem();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [gpsRequests, setGpsRequests] = useState<AttendanceGpsRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [filter, setFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Add correction" — admin/HR creating a request on an employee's behalf.
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ employeeId: '', workDate: nepalTodayIso(), checkIn: '', checkOut: '', reason: '' });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function reload() {
    supabase
      .from('attendance_correction_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []));
    supabase
      .from('attendance_gps_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setGpsRequests(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    // Punches since the start of this month — feeds the "incomplete entries"
    // list and pre-fills the form with a day's existing punches.
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .gte('punch_time', `${startOfThisMonthIso()}T00:00:00Z`)
      .then(({ data }) => setLogs(data ?? []));
  }
  useEffect(reload, []);

  const activeEmployees = useMemo(
    () => employees.filter(e => e.status === 'active').sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );
  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

  // Punches grouped by employee + Nepal date, real check-in/out fields removed.
  const punchesByEmpDay = useMemo(() => {
    const map = new Map<string, AttendanceLog[]>();
    for (const l of logs) {
      const key = `${l.employee_id}|${nepalDateKey(l.punch_time)}`;
      let arr = map.get(key);
      if (!arr) {
        arr = [];
        map.set(key, arr);
      }
      arr.push(l);
    }
    return map;
  }, [logs]);

  // Days this month where someone has a check-in but no check-out (or the
  // reverse) — the entries an admin most often needs to fix.
  const incompleteDays = useMemo<EmptyDay[]>(() => {
    const out: EmptyDay[] = [];
    for (const [key, dayLogs] of punchesByEmpDay) {
      const [employeeId, date] = key.split('|');
      const { checkIn, checkOut } = selectDayPunches(dayLogs);
      if (checkIn && !checkOut) {
        out.push({
          employeeId,
          employeeName: employeeName(employeeId),
          date,
          existing: `In ${punchHhmm(checkIn.punch_time)}`,
          missing: 'Check Out',
        });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punchesByEmpDay, employees]);

  // Pre-fill the in/out times from that employee-day's existing punches when
  // both employee and date are chosen.
  useEffect(() => {
    if (!form.employeeId || !form.workDate) return;
    const dayLogs = punchesByEmpDay.get(`${form.employeeId}|${form.workDate}`) ?? [];
    const { checkIn, checkOut } = selectDayPunches(dayLogs);
    setForm(f => ({
      ...f,
      checkIn: checkIn ? punchHhmm(checkIn.punch_time) : f.checkIn,
      checkOut: checkOut ? punchHhmm(checkOut.punch_time) : f.checkOut,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employeeId, form.workDate, punchesByEmpDay]);

  function openAdd(prefill?: Partial<typeof form>) {
    setAddError(null);
    setForm({ employeeId: '', workDate: nepalTodayIso(), checkIn: '', checkOut: '', reason: '', ...prefill });
    setShowAdd(true);
  }

  async function createCorrection() {
    setAddError(null);
    if (!form.employeeId) return setAddError('Pick an employee.');
    if (!form.workDate) return setAddError('Pick a date.');
    if (!form.checkIn || !form.checkOut) {
      // calc_payroll_fields needs both to work out hours — a one-sided
      // correction would zero the day out on approval.
      return setAddError('Enter both a check-in and a check-out time.');
    }
    const inTs = new Date(nepalDateTimeToUtcMs(form.workDate, form.checkIn)).toISOString();
    const outTs = new Date(nepalDateTimeToUtcMs(form.workDate, form.checkOut)).toISOString();
    if (outTs <= inTs) return setAddError('Check-out must be after check-in.');
    setSavingAdd(true);
    const { error: insertError } = await supabase.from('attendance_correction_requests').insert({
      employee_id: form.employeeId,
      work_date: form.workDate,
      requested_check_in: inTs,
      requested_check_out: outTs,
      reason: form.reason.trim() || null,
    });
    setSavingAdd(false);
    if (insertError) {
      setAddError(insertError.message);
      return;
    }
    setShowAdd(false);
    setFilter('pending');
    reload();
  }

  const unified: UnifiedRequest[] = useMemo(() => {
    const corrections: UnifiedRequest[] = requests.map(r => ({
      kind: 'correction',
      id: r.id,
      employee_id: r.employee_id,
      status: r.status,
      created_at: r.created_at,
      data: r,
    }));
    const gps: UnifiedRequest[] = gpsRequests.map(r => ({
      kind: 'gps',
      id: r.id,
      employee_id: r.employee_id,
      status: r.status,
      created_at: r.created_at,
      data: r,
    }));
    return [...corrections, ...gps].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [requests, gpsRequests]);

  const filtered = useMemo(
    () => (filter === 'All' ? unified : unified.filter(r => r.status === filter)),
    [unified, filter]
  );

  async function approve(item: UnifiedRequest) {
    setBusyId(item.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc(
      item.kind === 'correction' ? 'approve_attendance_correction' : 'approve_attendance_gps_request',
      { p_request_id: item.id }
    );
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    reload();
  }

  async function reject(item: UnifiedRequest) {
    setBusyId(item.id);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from(item.kind === 'correction' ? 'attendance_correction_requests' : 'attendance_gps_requests')
      .update({ status: 'rejected', reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', item.id);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    reload();
  }

  return (
    <AppShell title="Attendance Corrections">
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Requests from employees — a missed punch they&apos;re asking to fix, or a live check-in/check-out submitted
        from their phone. Approving a missed punch recalculates that day&apos;s hours, late/early status, and
        overtime, and locks the day so the nightly recompute won&apos;t overwrite it. Approving a GPS check-in
        records it as that day&apos;s attendance.
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-2">
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
        <button
          onClick={() => openAdd()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent/90"
        >
          <PlusIcon className="h-4 w-4" />
          Add Correction
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100 md:hidden">
          {filtered.map(item => {
            const lat = item.kind === 'correction' ? item.data.lat : item.data.lat;
            const lng = item.kind === 'correction' ? item.data.lng : item.data.lng;
            return (
              <div key={`${item.kind}-${item.id}`} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{employeeName(item.employee_id)}</div>
                    <div className="text-xs text-slate-500">
                      {item.kind === 'correction' ? 'Missed Punch' : punchTypeLabel(item.data.punch_type)} ·{' '}
                      {item.kind === 'correction'
                        ? formatAdDate(item.data.work_date, system)
                        : formatAdDate(nepalDateKey(item.data.punch_time), system)}
                    </div>
                  </div>
                  <Badge tone={item.status === 'approved' ? 'good' : item.status === 'rejected' ? 'critical' : 'warning'}>
                    {item.status}
                  </Badge>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {item.kind === 'correction'
                    ? `In ${formatTime(item.data.requested_check_in)} · Out ${formatTime(item.data.requested_check_out)}`
                    : formatTime(item.data.punch_time)}
                </div>
                {item.kind === 'correction' && item.data.reason && (
                  <div className="mt-1 text-xs text-slate-500">{item.data.reason}</div>
                )}
                {lat != null && lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${lat},${lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-accent hover:underline"
                  >
                    View location
                  </a>
                )}
                {item.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busyId === item.id}
                      onClick={() => approve(item)}
                      className="rounded-md bg-good px-3 py-1.5 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => reject(item)}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No {filter !== 'All' ? filter : ''} requests.</p>}
        </div>

        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Details</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const lat = item.kind === 'correction' ? item.data.lat : item.data.lat;
              const lng = item.kind === 'correction' ? item.data.lng : item.data.lng;
              return (
                <tr key={`${item.kind}-${item.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-ink">{employeeName(item.employee_id)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.kind === 'correction' ? 'Missed Punch' : punchTypeLabel(item.data.punch_type)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.kind === 'correction'
                      ? formatAdDate(item.data.work_date, system)
                      : formatAdDate(nepalDateKey(item.data.punch_time), system)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.kind === 'correction'
                      ? `In ${formatTime(item.data.requested_check_in)} · Out ${formatTime(item.data.requested_check_out)}`
                      : formatTime(item.data.punch_time)}
                  </td>
                  <td className="px-5 py-3 max-w-xs truncate text-slate-600">
                    {item.kind === 'correction' ? item.data.reason ?? '—' : '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {lat != null && lng != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${lat},${lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={item.status === 'approved' ? 'good' : item.status === 'rejected' ? 'critical' : 'warning'}>
                      {item.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    {item.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          disabled={busyId === item.id}
                          onClick={() => approve(item)}
                          className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === item.id}
                          onClick={() => reject(item)}
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
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                  No {filter !== 'All' ? filter : ''} requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-ink">Add Correction</h3>
            <p className="mt-1 text-xs text-slate-500">
              Creates a pending request on the employee&apos;s behalf. Approve it below to apply — it recalculates that
              day and locks it against the nightly recompute.
            </p>

            {incompleteDays.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Incomplete entries this month
                </div>
                <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {incompleteDays.map(d => (
                    <button
                      key={`${d.employeeId}-${d.date}`}
                      onClick={() =>
                        setForm(f => ({ ...f, employeeId: d.employeeId, workDate: d.date, checkIn: '', checkOut: '' }))
                      }
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        form.employeeId === d.employeeId && form.workDate === d.date ? 'bg-accent/5' : ''
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-ink">{d.employeeName}</span>
                        <span className="text-slate-500"> · {formatAdDate(d.date, system)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {d.existing} · no {d.missing.toLowerCase()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Employee</label>
                <select
                  value={form.employeeId}
                  onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">Select employee…</option>
                  {activeEmployees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.fingerprint_id ? ` (ID ${e.fingerprint_id})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Work date (AD)</label>
                  <input
                    type="date"
                    value={form.workDate}
                    max={nepalTodayIso()}
                    onChange={e => setForm(f => ({ ...f, workDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Check-in</label>
                  <input
                    type="time"
                    value={form.checkIn}
                    onChange={e => setForm(f => ({ ...f, checkIn: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Check-out</label>
                  <input
                    type="time"
                    value={form.checkOut}
                    onChange={e => setForm(f => ({ ...f, checkOut: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                Both times are required — the day&apos;s existing punches are loaded in automatically, so just fix or fill
                the one that&apos;s wrong.
              </p>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Reason</label>
                <input
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. forgot to punch out"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            </div>

            {addError && <p className="mt-3 text-sm text-critical">{addError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={createCorrection}
                disabled={savingAdd}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingAdd ? 'Creating…' : 'Create request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
