'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';
import DateRangePicker from '@/components/DateRangePicker';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  edgePunctuality,
  formatHoursMinutes,
  isWeekOff,
  nepalDateKey,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesByGender } from '@/lib/weekOff';
import type { AttendanceLog, CompanyHoliday, Device, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

type Row = {
  key: string;
  date: string;
  enrollId: string;
  employeeName: string;
  device: string;
  shiftLabel: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off' | 'Leave' | 'Exempt';
  lateMinutes: number;
  earlyArrivalMinutes: number;
  earlyMinutes: number;
  lateDepartureMinutes: number;
  overtime: number;
  /** No payroll_summaries row yet (only computed by the nightly job or
   * "Recalculate month" on the Payroll page) — late/early/hours/overtime
   * here are computed live client-side from the raw punches (same math,
   * see lib/shift.ts) rather than left blank until that job runs. */
  pending?: boolean;
};

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

/** Punch timestamp -> "HH:MM" (24h). */
function fmtPunch(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–';
}

/** The In / Out cell — each time coloured by how it landed vs the shift:
 * check-in amber if late / teal if early, check-out red if left early /
 * blue if left late. Plain slate when on time. Prints black. */
function InOutCell({ row }: { row: Row }) {
  const inClass =
    row.lateMinutes > 0
      ? 'font-medium text-warning-text print:text-ink'
      : row.earlyArrivalMinutes > 0
        ? 'font-medium text-good-text print:text-ink'
        : 'print:text-ink';
  const inTitle =
    row.lateMinutes > 0
      ? `In ${formatHoursMinutes(row.lateMinutes)} late`
      : row.earlyArrivalMinutes > 0
        ? `In ${formatHoursMinutes(row.earlyArrivalMinutes)} early`
        : undefined;
  const outClass =
    row.earlyMinutes > 0
      ? 'font-medium text-critical-text print:text-ink'
      : row.lateDepartureMinutes > 0
        ? 'font-medium text-info-text print:text-ink'
        : 'print:text-ink';
  const outTitle =
    row.earlyMinutes > 0
      ? `Out ${formatHoursMinutes(row.earlyMinutes)} early`
      : row.lateDepartureMinutes > 0
        ? `Out ${formatHoursMinutes(row.lateDepartureMinutes)} late`
        : undefined;
  return (
    <>
      <span className={inClass} title={inTitle}>
        {fmtPunch(row.checkIn)}
      </span>
      {' – '}
      <span className={outClass} title={outTitle}>
        {fmtPunch(row.checkOut)}
      </span>
    </>
  );
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function statusBadge(r: Row) {
  if (r.checkIn) return <Badge tone="good">Present</Badge>;
  if (r.status === 'Week Off') return <Badge tone="neutral">Week Off</Badge>;
  if (r.status === 'Leave') return <Badge tone="info">Leave</Badge>;
  if (r.status === 'Upcoming') return <Badge tone="neutral">Upcoming</Badge>;
  if (r.status === 'Exempt') return <Badge tone="neutral">Excused</Badge>;
  return <Badge tone="critical">Absent</Badge>;
}

export default function AttendanceReportTable({ initialEmployeeId }: { initialEmployeeId?: string | null }) {
  const { system } = useCalendarSystem();
  const [from, setFrom] = useState(isoDaysAgo(0));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [status, setStatus] = useState<'All' | 'Present' | 'Late' | 'Early' | 'Absent' | 'Week Off' | 'Leave' | 'Exempt'>('All');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId ?? 'all');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => setEmployees((data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode }) => {
      setWeeklyOffDay(weeklyOffDay);
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', from).lte('work_date', to),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', `${from}T00:00:00Z`).lte('punch_time', `${to}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', from).lte('work_date', to),
      supabase.from('company_holidays').select('*').gte('holiday_date', from).lte('holiday_date', to),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', to).gte('end_date', from),
    ]).then(([summariesRes, logsRes, rosterRes, holidaysRes, leaveRes]) => {
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);
      setLeaveRequests(leaveRes.data ?? []);
      setLoading(false);
    });
  }, [from, to]);

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  // A per-employee lookup: gender-scoped holidays (e.g. Teej) count only for
  // the employees they cover.
  const weekOffDatesFor = useMemo(() => weekOffDatesByGender(from, to, weeklyOffDay, holidays), [from, to, weeklyOffDay, holidays]);
  const leaveByEmployee = useMemo(() => leaveDatesByEmployee(leaveRequests), [leaveRequests]);
  const weeklyPattern = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

  const rows: Row[] = useMemo(() => {
    const deviceName = (id: string | null) => devices.find(d => d.id === id)?.name ?? 'Mobile / QR / Selfie';
    const days: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const today = nepalTodayIso();

    // Per-employee: raw same-date bucketing, corrected for any day whose
    // resolved shift crosses midnight (Night Duty/Day & Night Duty) — done
    // once per employee up front (not inside the day×employee loop below)
    // since applyOvernightShiftCorrection needs a whole date range at once.
    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of scopedEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => nepalDateKey(l.punch_time) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    const out: Row[] = [];
    for (const day of days) {
      for (const emp of scopedEmployees) {
        const weekOffDateSet = weekOffDatesFor(emp.gender);
        // Today's own row can still gain punches (e.g. a checkout) after a
        // payroll_summaries row for it was already computed — that row is
        // never re-run until tomorrow's nightly job, so trusting it here
        // would freeze today's attendance at whatever it looked like the
        // moment it was last computed. Always compute today live instead;
        // past days' summaries are final and safe to trust.
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
        const shiftLabel = isWeekOff(resolved)
          ? 'Week Off'
          : `${resolved.name} (${resolved.start_time.slice(0, 5)}–${resolved.end_time.slice(0, 5)})`;

        // Early-arrival / late-departure aren't stored on the summary row —
        // derive them live from check_in/check_out against the shift.
        const edges =
          isWeekOff(resolved) || emp.attendance_exempt
            ? { earlyArrivalMinutes: 0, lateDepartureMinutes: 0 }
            : edgePunctuality(summary?.check_in ?? null, summary?.check_out ?? null, resolved);

        if (summary) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0]?.device_id ?? null),
            shiftLabel,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: summary.total_hours,
            status: summary.is_late && !emp.attendance_exempt ? 'Late' : 'Present',
            lateMinutes: summary.is_late && !emp.attendance_exempt ? summary.late_minutes : 0,
            earlyArrivalMinutes: edges.earlyArrivalMinutes,
            earlyMinutes: summary.is_early_departure && !emp.attendance_exempt ? summary.early_departure_minutes : 0,
            lateDepartureMinutes: edges.lateDepartureMinutes,
            overtime: summary.overtime_hours,
          });
        } else if (dayLogs.length > 0) {
          // Not yet processed by compute_payroll_summaries() (runs nightly
          // for the previous day, or manually via "Recalculate month" on
          // Payroll) — compute late/early/hours/overtime live from the raw
          // punches (same math payroll itself uses, see lib/shift.ts)
          // instead of leaving them blank until that job runs.
          const live = computeDayStatusForResolvedShift(dayLogs, resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0].device_id ?? null),
            shiftLabel,
            checkIn: live.checkIn.punch_time,
            checkOut: live.checkOut?.punch_time ?? null,
            hours: live.totalMinutes / 60,
            status: live.isLate && !emp.attendance_exempt ? 'Late' : 'Present',
            lateMinutes: emp.attendance_exempt ? 0 : live.lateMinutes,
            earlyArrivalMinutes: emp.attendance_exempt ? 0 : live.earlyArrivalMinutes,
            earlyMinutes: emp.attendance_exempt ? 0 : live.earlyMinutes,
            lateDepartureMinutes: emp.attendance_exempt ? 0 : live.lateDepartureMinutes,
            overtime: live.overtimeMinutes / 60,
            pending: true,
          });
        } else {
          // A company Week-off, a per-employee roster Week Off, or an
          // approved Leave day is a known, paid day off — takes priority
          // over the Upcoming/Absent distinction below, whether it's
          // already passed or not. A requested (and approved) Leave keeps
          // its own label even on a day that's also a Week Off — it's still
          // paid the same either way. `resolved` (computed above for the
          // Shift column) already reflects the per-employee roster
          // regardless of roster_mode, so this only needs to check it
          // alongside the company-wide set instead of duplicating that
          // resolution — the previous version checked weekOffDateSet only,
          // which meant an employee with a roster Week Off (but no
          // company-wide off day) still showed "Absent" here even though
          // the Shift column on the same row already said "Week Off".
          const isOnLeave = leaveByEmployee.get(emp.id)?.has(day);
          const isOnWeekOff = weekOffDateSet.has(day) || isWeekOff(resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: 'N/A',
            shiftLabel,
            checkIn: null,
            checkOut: null,
            hours: 0,
            // A day that hasn't happened yet isn't "Absent" — it just
            // hasn't occurred (only relevant if the picked range runs past
            // today).
            status: isOnLeave
              ? 'Leave'
              : isOnWeekOff
                ? 'Week Off'
                : day > today
                  ? 'Upcoming'
                  : emp.attendance_exempt
                    ? 'Exempt'
                    : 'Absent',
            lateMinutes: 0,
            earlyArrivalMinutes: 0,
            earlyMinutes: 0,
            lateDepartureMinutes: 0,
            overtime: 0,
          });
        }
      }
    }
    return out
      .filter(r => status === 'All' || (status === 'Early' ? r.earlyMinutes > 0 : r.status === status))
      .sort((a, b) => {
        const aId = a.enrollId ?? '';
        const bId = b.enrollId ?? '';
        if (!aId && !bId) return 0;
        if (!aId) return 1;
        if (!bId) return -1;
        return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [scopedEmployees, summaries, logs, devices, shifts, from, to, status, dailyShiftByDate, weekOffDatesFor, leaveByEmployee, weeklyPattern]);

  const totals = useMemo(() => {
    const workHours = rows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = rows.reduce((sum, r) => sum + r.overtime, 0);
    const presentDays = rows.filter(r => r.checkIn).length;
    const absentDays = rows.filter(r => r.status === 'Absent').length;
    return { workHours, overtimeHours, presentDays, absentDays };
  }, [rows]);

  function exportCsv() {
    const header = [
      'Date',
      'ID',
      'Employee',
      'Shift',
      'Check-In',
      'Check-Out',
      'Late By (min)',
      'Early Out (min)',
      'Total Work Hours',
      'Overtime',
      'Status',
      'Device',
    ];
    const lines = rows.map(r => [
      r.date,
      r.enrollId,
      r.employeeName,
      r.shiftLabel,
      r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour12: false }) : '',
      r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour12: false }) : '',
      r.lateMinutes || '',
      r.earlyMinutes || '',
      r.hours.toFixed(1),
      r.overtime.toFixed(1),
      r.status,
      r.device,
    ]);
    downloadExcel(`attendance_${from}_to_${to}.csv`, header, lines);
  }

  return (
    <>
      <h1 className="mb-3 hidden text-2xl font-bold text-ink print:block">
        Attendance Report — {from} to {to}
      </h1>
      <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm print:hidden">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employee</label>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <PersonIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
                <select
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="min-w-[10rem] rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="all">All Employees</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name} (ID {e.fingerprint_id ?? '—'})
                    </option>
                  ))}
                </select>
              </div>
              {employeeId !== 'all' && (
                <button onClick={() => setEmployeeId('all')} className="text-[11px] font-medium text-accent hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</label>
            <div className="relative">
              <StatusIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
              <select
                value={status}
                onChange={e => setStatus(e.target.value as typeof status)}
                className="rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="All">All Logs</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Late">Late</option>
                <option value="Early">Early</option>
                <option value="Week Off">Week Off</option>
                <option value="Leave">Leave</option>
                <option value="Exempt">Excused</option>
              </select>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-slate-200 sm:block" />

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Date Range</label>
            <div className="w-48">
              <DateRangePicker from={from} to={to} onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }} />
            </div>
          </div>

          <TableExportBar onExportCsv={exportCsv} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        {/* Same left-to-right table on every screen size, including phones —
            horizontal scroll instead of a condensed/truncated mobile layout,
            so it always matches the desktop web view exactly. Print gets the
            full table instead of just the scrolled-into-view slice. */}
        <div className="max-h-[65vh] overflow-auto rounded-lg print:max-h-none print:overflow-visible">
        {/* print:-prefixed classes below only take effect inside the browser's
            print/Save-as-PDF preview — the on-screen table (colors, compact
            10-12px sizing) is untouched. Print gets a plain black-and-white
            grid (no colored badges/backgrounds — those often don't render
            consistently across printers/PDF viewers and just burn ink),
            matching a normal printed report instead of a dense on-screen
            dashboard. Font size and border-collapse for print are set
            globally in globals.css (not here) so there's one source of
            truth — see the comment there for why border-collapse is
            `separate`, not `collapse`. */}
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 print:static print:text-ink">
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">Date</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">ID</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">Employee</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">Shift</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">In / Out</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">Work Hours</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">Overtime</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:w-16 print:border print:border-slate-400 print:px-1 print:py-1">Status</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium print:border print:border-slate-400 print:px-1 print:py-1">Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:hover:bg-transparent">
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">{formatAdDate(r.date, system)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">{r.enrollId}</td>
                <td className="whitespace-nowrap px-2 py-1 font-medium text-ink print:border print:border-slate-400 print:px-2 print:py-1">{r.employeeName}</td>
                <td className="px-2 py-1 whitespace-nowrap text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">{r.shiftLabel}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  <InOutCell row={r} />
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  {fmtHrs(r.hours)}
                  {r.pending && <span className="ml-1 text-[9px] text-slate-400 print:hidden">(live)</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  {fmtHrs(r.overtime)}
                  {r.pending && <span className="ml-1 text-[9px] text-slate-400 print:hidden">(live)</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1 print:w-20 print:border print:border-slate-400 print:px-1 print:py-1">
                  <span className="print:hidden">{statusBadge(r)}</span>
                  <span className="hidden print:inline print:text-ink">{r.status}</span>
                </td>
                <td className="whitespace-nowrap print-wrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-[8px] print:text-ink">{r.device}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  {loading ? 'Loading…' : 'No records in this range.'}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-xs font-bold text-ink print:static print:bg-white print:text-[10px]">
                <td colSpan={4} className="whitespace-nowrap px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500 print:border print:border-slate-400 print:px-2 print:text-[10px] print:text-ink">
                  Total
                </td>
                <td className="print:border print:border-slate-400" />
                <td className="whitespace-nowrap px-2 py-1.5 print:border print:border-slate-400 print:px-2">{fmtHrs(totals.workHours)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 print:border print:border-slate-400 print:px-2">{fmtHrs(totals.overtimeHours)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-[10px] font-semibold print:w-20 print:whitespace-normal print:border print:border-slate-400 print:px-1 print:text-[10px]">
                  {/* On-screen: one line, colored, joined by " · " — unchanged.
                      Print: stacked on two lines instead, so this cell doesn't
                      force the totals row (and the columns before it) wider
                      than they need to be. */}
                  <span className="print:hidden">
                    <span className="text-good-text">{totals.presentDays} present</span>
                    {' · '}
                    <span className="text-critical-text">{totals.absentDays} absent</span>
                  </span>
                  <span className="hidden print:flex print:flex-col print:text-ink">
                    <span>{totals.presentDays} present</span>
                    <span>{totals.absentDays} absent</span>
                  </span>
                </td>
                <td className="print:border print:border-slate-400" />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
    </>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  );
}

function StatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 5l7 8v6l2 1v-7l7-8" />
    </svg>
  );
}
