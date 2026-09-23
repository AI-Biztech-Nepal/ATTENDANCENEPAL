'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';
import DateRangePicker from '@/components/DateRangePicker';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatDdMmYyyy } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  applyOvernightShiftCorrection,
  dropPunchesClaimedBySummaries,
  isDeletedDay,
  withoutSupersededSummaries,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  edgePunctuality,
  formatHoursMinutes,
  isWeekOff,
  nepalDateKey,
  nepalDateTimeToUtcMs,
  nepalTodayIso,
  punchMinuteOfDay,
  resolveShiftForDate,
  type DailyShiftByDate,
  type ResolvedShift,
} from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesByGender } from '@/lib/weekOff';
import { fetchLeavePolicy, leavePolicyActive } from '@/lib/leaveBalance';
import { useSessionState } from '@/lib/useSessionState';
import type { AttendanceLog, CompanyHoliday, Device, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

type Row = {
  key: string;
  date: string;
  employeeId: string;
  enrollId: string;
  employeeName: string;
  device: string;
  /** The resolved shift's start / end as "HH:MM" — null on a Week Off. Used
   * to pre-fill the missing side when correcting a one-punch day. */
  shiftStart: string | null;
  shiftEnd: string | null;
  /** "Name (HH:MM–HH:MM)" — one string, still what the CSV export writes. */
  shiftLabel: string;
  /** The same shift split in two so the column can stack them on separate
   * lines instead of one long nowrap run — the single biggest thing making
   * this table wider than the screen. Split here rather than re-parsed from
   * shiftLabel at render time so a change to the label format can't quietly
   * break the display. `shiftTime` is null for Week Off (no hours to show). */
  shiftName: string;
  shiftTime: string | null;
  checkIn: string | null;
  checkOut: string | null;
  /** The device a manually-corrected day is explicitly attributed to
   * (payroll_summaries.device_id) — null for an ordinary punch-derived day,
   * where `device` above is read live off attendance_logs instead. Carried
   * separately from `device` (the display string) so the correction dialog
   * can pre-fill its dropdown to whatever was picked last time. */
  deviceId: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off' | 'Leave' | 'Exempt';
  lateMinutes: number;
  earlyArrivalMinutes: number;
  earlyMinutes: number;
  lateDepartureMinutes: number;
  overtime: number;
  /** The day's resolved shift and the employee's exemption, kept so a staged
   * correction can be previewed with the same math as a live day. */
  resolvedShift: ResolvedShift;
  attendanceExempt: boolean;
};

/** A correction made in Correction mode but not written yet. Edits and deletes
 * are held here, previewed in the table, and only reach the database when the
 * admin clicks Save changes (saveAllChanges). `requestId` is set once an
 * edit's correction request row exists, so a retry after a failed apply
 * doesn't insert a second one. */
type PendingChange =
  | {
      kind: 'edit';
      row: Row;
      form: { checkIn: string; checkOut: string; checkOutNextDay: boolean; reason: string; deviceId: string };
      inTs: string;
      outTs: string;
      requestId?: string;
      error?: string;
    }
  | { kind: 'delete'; row: Row; error?: string };

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

/** Punch timestamp -> "HH:MM" (24h). */
function fmtPunch(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–';
}

/** Punch timestamp -> "HH:MM" in Nepal local time, for the correction form's
 * time inputs — same conversion payroll uses, not the viewer's clock. */
function punchHhmm(iso: string) {
  const m = punchMinuteOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The inline "Fix" affordance shown in an empty Check-In / Check-Out cell
 * when Correction mode is on and the day has one punch but not the other. */
function FixChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add correction — missed punch"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-accent/50 bg-accent/5 px-1.5 py-0.5 text-[11px] font-semibold text-good-text transition-colors hover:border-solid hover:border-accent hover:bg-accent-light print:hidden"
    >
      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Fix
    </button>
  );
}

/** Wraps a Check-In / Check-Out time (or the Device cell) that IS on record
 * but is still editable in Correction mode — a click opens the same
 * correction dialog. Subtle: the value reads normally, a pencil fades in on
 * hover. `print:contents` drops the button's own flex box for print/PDF —
 * a flex item won't shrink below its content's unwrapped width by default,
 * which silently defeated `.print-wrap` on the Device column (long values
 * like "Deleted by admin" ran off the page edge instead of wrapping); as
 * plain inline content again it wraps exactly like it did before this
 * button existed. The interactivity this loses is irrelevant on paper. */
function EditablePunch({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Correct this day"
      className="group -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors hover:bg-accent/10 print:contents"
    >
      {children}
      <svg
        viewBox="0 0 24 24"
        className="h-2.5 w-2.5 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 print:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

/** The value a staged change replaces, shown struck through under the new
 * one. Screen only. */
function WasValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-normal text-slate-400 print:hidden">
      was <span className="line-through">{children}</span>
    </span>
  );
}

/** How a row reads once its staged change is saved: the same numbers the
 * live-punch branch of `rows` computes, from the corrected times. The server
 * recalculates for real on save (approve_attendance_correction()). */
function previewRow(r: Row, change: PendingChange, deviceName: string | null): Row {
  if (change.kind === 'delete') {
    return {
      ...r,
      checkIn: null,
      checkOut: null,
      hours: 0,
      overtime: 0,
      lateMinutes: 0,
      earlyArrivalMinutes: 0,
      earlyMinutes: 0,
      lateDepartureMinutes: 0,
      status: r.shiftName === 'Week Off' ? 'Week Off' : 'Absent',
      device: 'Deleted by admin',
    };
  }
  const logs = [
    { punch_time: change.inTs, punch_type: '0' },
    { punch_time: change.outTs, punch_type: '1' },
  ] as AttendanceLog[];
  const live = computeDayStatusForResolvedShift(logs, r.resolvedShift);
  const exempt = r.attendanceExempt;
  return {
    ...r,
    checkIn: change.inTs,
    checkOut: change.outTs,
    hours: live.totalMinutes / 60,
    overtime: live.overtimeMinutes / 60,
    status: live.isLate && !exempt ? 'Late' : 'Present',
    lateMinutes: exempt ? 0 : live.lateMinutes,
    earlyArrivalMinutes: exempt ? 0 : live.earlyArrivalMinutes,
    earlyMinutes: exempt ? 0 : live.earlyMinutes,
    lateDepartureMinutes: exempt ? 0 : live.lateDepartureMinutes,
    device: deviceName ?? r.device,
  };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** 'YYYY-MM-DD' (always the AD key, whatever calendar is being displayed)
 * -> 'Sun'..'Sat'. The weekday is the same real day either way, so this
 * deliberately doesn't go through NepaliDate — a BS date and its AD
 * equivalent fall on the same weekday. Parsed as local parts rather than
 * new Date(adKey), which would read the string as UTC midnight and land on
 * the previous day for anyone west of Greenwich. */
function weekdayShort(adKey: string): string {
  const [y, m, d] = adKey.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

/* The punch time and how far off the shift it landed used to share one
 * cell, stacked on two lines. They're now three columns — Check-In,
 * Check-Out, Late/Early — so a row is one line tall and the variance can be
 * read down its own column instead of hunting for a second line inside
 * every cell. The time cells keep their colour (it's the quickest signal of
 * a problem row); the variance column carries the wording. */

/** The Check-In cell — just the punch time, coloured by how it landed vs
 * the shift (amber if late, teal if early). Plain slate when on time, or
 * when there's no punch. Prints black. */
function CheckInCell({ row }: { row: Row }) {
  const timeClass =
    row.lateMinutes > 0
      ? 'font-medium text-warning-text print:text-ink'
      : row.earlyArrivalMinutes > 0
        ? 'font-medium text-good-text print:text-ink'
        : 'text-slate-600 print:text-ink';
  return <span className={timeClass}>{fmtPunch(row.checkIn)}</span>;
}

/** The Check-Out cell — just the punch time, coloured by how it landed vs
 * the shift (red if left early, blue if left late). Plain slate when on
 * time, or when there's no punch. Prints black. */
function CheckOutCell({ row }: { row: Row }) {
  const timeClass =
    row.earlyMinutes > 0
      ? 'font-medium text-critical-text print:text-ink'
      : row.lateDepartureMinutes > 0
        ? 'font-medium text-info-text print:text-ink'
        : 'text-slate-600 print:text-ink';
  return <span className={timeClass}>{fmtPunch(row.checkOut)}</span>;
}

/** Both ends of the day's punctuality in one column: how far the arrival
 * missed the shift start, and under it how far the departure missed the
 * shift end.
 *
 * Each line names its end — "Late In", "Early In", "Late Out", "Early Out"
 * — rather than just "Late"/"Early". Two stacked lines both reading "Late
 * 0h 30m / Late 0h 4m" left colour and row position as the only clue to
 * which was the arrival and which the departure, which is unreadable in
 * print (every tone flattens to black) and invisible to anyone who doesn't
 * know the colour code. The colours stay as a fast second signal — amber
 * arrived late, teal arrived early, red left early, blue stayed late — but
 * nothing depends on them any more.
 *
 * Early arrival and late departure are carried here rather than dropped:
 * they're the same measurements signed the other way, and a day that
 * started early is not the same as one that started on time. An em dash
 * when both ends landed exactly on the shift, or there are no punches to
 * compare. */
function LateEarlyCell({ row }: { row: Row }) {
  const parts: { key: string; text: string; tone: string }[] = [];
  if (row.lateMinutes > 0) {
    parts.push({ key: 'in', text: `Late In ${formatHoursMinutes(row.lateMinutes)}`, tone: 'text-warning-text' });
  } else if (row.earlyArrivalMinutes > 0) {
    parts.push({ key: 'in', text: `Early In ${formatHoursMinutes(row.earlyArrivalMinutes)}`, tone: 'text-good-text' });
  }
  if (row.earlyMinutes > 0) {
    parts.push({ key: 'out', text: `Early Out ${formatHoursMinutes(row.earlyMinutes)}`, tone: 'text-critical-text' });
  } else if (row.lateDepartureMinutes > 0) {
    parts.push({ key: 'out', text: `Late Out ${formatHoursMinutes(row.lateDepartureMinutes)}`, tone: 'text-info-text' });
  }
  if (parts.length === 0) return <span className="text-slate-300 print:text-ink">—</span>;
  return (
    <span className="flex flex-col leading-tight">
      {parts.map(p => (
        <span key={p.key} className={`whitespace-nowrap font-medium ${p.tone} print:text-ink`}>
          {p.text}
        </span>
      ))}
    </span>
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
  const tableScrollRef = useRef<HTMLDivElement>(null);
  // Dates, status, employee and Correction mode are remembered for this
  // browser tab, so a refresh picks up where you were (lib/useSessionState).
  // An employee passed in the link wins over the remembered one.
  const [from, setFrom] = useSessionState('attendanceReport:from', isoDaysAgo(0), { isValid: (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) });
  const [to, setTo] = useSessionState('attendanceReport:to', isoDaysAgo(0), { isValid: (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) });
  const [status, setStatus] = useSessionState<'All' | 'Present' | 'Late' | 'Early' | 'Absent' | 'Week Off' | 'Leave' | 'Exempt'>(
    'attendanceReport:status',
    'All',
    { isValid: v => typeof v === 'string' && ['All', 'Present', 'Late', 'Early', 'Absent', 'Week Off', 'Leave', 'Exempt'].includes(v) }
  );
  const [employeeId, setEmployeeId] = useSessionState<string>('attendanceReport:employee', initialEmployeeId ?? 'all', {
    enabled: !initialEmployeeId,
    isValid: v => typeof v === 'string',
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  // Options for the correction dialog's device picker — only devices that
  // have actually logged a punch (devices_with_punches()), not every paired
  // device, so one that's never synced a log doesn't clutter the list.
  const [punchDevices, setPunchDevices] = useState<Device[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  // Company leave policy (lib/leaveBalance.ts): Week Off work adds to the
  // yearly leave balance instead of being paid as overtime.
  const [weekOffLeaveHours, setWeekOffLeaveHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Correction mode: an admin-only view toggle. Off = the standard report;
  // on = a "Fix" chip in the empty punch cell of any past one-punch day,
  // opening a direct correction (no approval step). A correction is staged in
  // `pending`, not written — see saveAllChanges(). `refreshTick` re-pulls the
  // day's data after a save lands.
  const [correctionMode, setCorrectionMode] = useSessionState('attendanceReport:correctionMode', false, {
    isValid: v => typeof v === 'boolean',
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [fixRow, setFixRow] = useState<Row | null>(null);
  // checkOutNextDay: the check-out falls on the morning after work_date — an
  // overnight / 24-hour duty (09:00 -> 08:00). Without it both times were
  // built on work_date, so such a duty was always rejected as "check-out
  // before check-in", or saved as a few minutes' work.
  const [fixForm, setFixForm] = useState({ checkIn: '', checkOut: '', checkOutNextDay: false, reason: '', deviceId: '' });
  const [fixError, setFixError] = useState<string | null>(null);

  // Staged corrections, keyed by Row.key — nothing here is in the database
  // until Save changes. `guardAction` is a filter/date/mode change held back
  // while there are unsaved changes, until the admin saves or discards them.
  const [pending, setPending] = useState<Map<string, PendingChange>>(new Map());
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [guardAction, setGuardAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => setEmployees((data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    supabase.rpc('devices_with_punches').then(({ data }) => setPunchDevices(data ?? []));
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
    fetchLeavePolicy().then(p => setWeekOffLeaveHours(leavePolicyActive(p) && p.weekOffWorkEarnsLeave ? p.hoursPerLeaveDay : null));
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
      // Rows a correction on another date has superseded are left out.
      setSummaries(withoutSupersededSummaries(summariesRes.data ?? []));
      setLogs(logsRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);
      setLeaveRequests(leaveRes.data ?? []);
      setLoading(false);
    });
  }, [from, to, refreshTick]);

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
    // Where the day's attendance actually came from: the registered
    // terminal's own name for a machine punch (method 'zkteco'), or "App"
    // for one recorded in the mobile app (gps / qr / selfie). Read from the
    // day's first punch rather than from device_id alone — a null device_id
    // was the old proxy for "not a machine", but it says nothing about which
    // flow was used and mislabels a machine punch whose device row has since
    // been deleted. Em dash when there are no punches to attribute.
    const punchSource = (log: AttendanceLog | undefined) => {
      if (!log) return '—';
      if (log.method === 'zkteco') return devices.find(d => d.id === log.device_id)?.name ?? 'Machine';
      return 'App';
    };
    // An admin's explicit pick from the correction dialog overrides the
    // punch-derived device — the whole point of letting them choose one.
    // Falls back to punchSource() when no override was made (the common
    // case, including every ordinary un-corrected day).
    const deviceFor = (summaryDeviceId: string | null | undefined, log: AttendanceLog | undefined) =>
      summaryDeviceId ? (devices.find(d => d.id === summaryDeviceId)?.name ?? 'Unknown device') : punchSource(log);
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
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern, days);
      // A punch another day's saved row already owns (e.g. a Week Off duty's
      // next-morning check-out) isn't this day's too.
      dropPunchesClaimedBySummaries(byDate, summaries.filter(s => s.employee_id === emp.id), today);
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
        const rawSummary = summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        // Today normally recomputes live (its nightly summary is stale — more
        // punches can still land), but a manual admin correction is a
        // deliberate override and must stick, today included.
        const summary = day !== today || rawSummary?.manually_corrected ? rawSummary : undefined;
        // A day an admin deleted has no attendance, whatever punches it had.
        const deleted = isDeletedDay(summary);
        const dayLogs = deleted ? [] : (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
        const shiftName = isWeekOff(resolved) ? 'Week Off' : resolved.name;
        const shiftStart = isWeekOff(resolved) ? null : resolved.start_time.slice(0, 5);
        const shiftEnd = isWeekOff(resolved) ? null : resolved.end_time.slice(0, 5);
        const shiftTime = shiftStart && shiftEnd ? `${shiftStart}–${shiftEnd}` : null;
        const shiftLabel = shiftTime ? `${shiftName} (${shiftTime})` : shiftName;
        const rowBase = { employeeId: emp.id, shiftStart, shiftEnd, resolvedShift: resolved, attendanceExempt: !!emp.attendance_exempt };

        // Early-arrival / late-departure aren't stored on the summary row —
        // derive them live from check_in/check_out against the shift.
        const edges =
          isWeekOff(resolved) || emp.attendance_exempt
            ? { earlyArrivalMinutes: 0, lateDepartureMinutes: 0 }
            : edgePunctuality(summary?.check_in ?? null, summary?.check_out ?? null, resolved);

        if (summary && summary.check_in) {
          out.push({
            ...rowBase,
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceFor(summary.device_id, dayLogs[0]),
            deviceId: summary.device_id ?? null,
            shiftLabel,
            shiftName,
            shiftTime,
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
            ...rowBase,
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: punchSource(dayLogs[0]),
            deviceId: null,
            shiftLabel,
            shiftName,
            shiftTime,
            checkIn: live.checkIn.punch_time,
            checkOut: live.checkOut?.punch_time ?? null,
            hours: live.totalMinutes / 60,
            status: live.isLate && !emp.attendance_exempt ? 'Late' : 'Present',
            lateMinutes: emp.attendance_exempt ? 0 : live.lateMinutes,
            earlyArrivalMinutes: emp.attendance_exempt ? 0 : live.earlyArrivalMinutes,
            earlyMinutes: emp.attendance_exempt ? 0 : live.earlyMinutes,
            lateDepartureMinutes: emp.attendance_exempt ? 0 : live.lateDepartureMinutes,
            overtime: live.overtimeMinutes / 60,
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
            ...rowBase,
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deleted ? 'Deleted by admin' : 'N/A',
            deviceId: null,
            shiftLabel,
            shiftName,
            shiftTime,
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

  // `rows` as they'll read once the staged changes are saved — what the table
  // shows. `rows` itself stays the saved state (the Excel export writes it).
  const shownRows = useMemo(
    () =>
      rows.map(r => {
        const change = pending.get(r.key);
        if (!change) return r;
        const deviceName = change.kind === 'edit' && change.form.deviceId ? (devices.find(d => d.id === change.form.deviceId)?.name ?? null) : null;
        return previewRow(r, change, deviceName);
      }),
    [rows, pending, devices]
  );

  const totals = useMemo(() => {
    const workHours = shownRows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = shownRows.reduce((sum, r) => sum + r.overtime, 0);
    const presentDays = shownRows.filter(r => r.checkIn).length;
    const absentDays = shownRows.filter(r => r.status === 'Absent').length;
    return { workHours, overtimeHours, presentDays, absentDays };
  }, [shownRows]);

  // In Correction mode two kinds of past day are correctable:
  //
  //  - A day the employee attended (Present / Late): either end, whether it's
  //    blank or just wrong.
  //  - An Absent or Week Off day with no punches at all: the admin can add
  //    the day outright — someone who worked but whose punches never reached
  //    the device, or who came in on their day off. The dialog pre-fills the
  //    shift's hours, and approve_attendance_correction() upserts the day's
  //    payroll_summaries row, so no existing punch is needed to base it on.
  //
  // Only days BEFORE today: an open check-out on today isn't a gap yet (they
  // may still punch out). Leave stays out — an approved leave day that
  // "gained" punches would contradict the leave itself; cancel the leave
  // first. Upcoming and Excused days are out for the same kind of reason.
  const reportToday = nepalTodayIso();
  function correctable(r: Row): boolean {
    if (r.date >= reportToday) return false;
    if (r.status === 'Present' || r.status === 'Late') return !!(r.checkIn || r.checkOut);
    return (r.status === 'Absent' || r.status === 'Week Off') && !r.checkIn && !r.checkOut;
  }
  /** Which end is BLANK — that cell gets the Fix chip instead of a clickable
   * time. 'both' for an Absent / Week Off day with no punches; null when both
   * ends have a punch. */
  function blankPunch(r: Row): 'in' | 'out' | 'both' | null {
    if (!correctable(r)) return null;
    if (!r.checkIn && !r.checkOut) return 'both';
    if (r.checkIn && !r.checkOut) return 'out';
    if (!r.checkIn && r.checkOut) return 'in';
    return null;
  }
  /** A one-punch day — a likely missed punch, as opposed to an ordinary
   * Absent or Week Off day. Only these get the warning highlight and count
   * toward the badge: counting every absence would bury the real gaps. */
  function missedPunch(r: Row): boolean {
    const b = blankPunch(r);
    return b === 'in' || b === 'out';
  }

  const incompleteCount = useMemo(() => shownRows.filter(missedPunch).length, [shownRows, reportToday]);

  function openCorrection(r: Row) {
    if (!correctable(r) || savingAll) return;
    setFixError(null);
    // Reopening a day with a staged edit picks up where the admin left it.
    const staged = pending.get(r.key);
    if (staged?.kind === 'edit') {
      setFixForm(staged.form);
      setFixRow(r);
      return;
    }
    const overnight = !!(r.shiftStart && r.shiftEnd && r.shiftEnd <= r.shiftStart);
    // A tap-out-only overnight duty: the one punch on record is dated the
    // NEXT morning, so it is really this duty's check-out — the check-in was
    // never punched. compute_payroll_summaries() stores it as check_in only
    // because it is the day's sole punch. Offer it as the check-out and the
    // shift start as the check-in, rather than pre-filling a next-morning
    // time into the check-in box.
    const soleNextMorningPunch = !!(r.checkIn && !r.checkOut && nepalDateKey(r.checkIn) > r.date);
    if (soleNextMorningPunch) {
      setFixForm({
        checkIn: r.shiftStart ?? '09:00',
        checkOut: punchHhmm(r.checkIn!),
        checkOutNextDay: true,
        reason: '',
        deviceId: r.deviceId ?? '',
      });
    } else {
      setFixForm({
        checkIn: r.checkIn ? punchHhmm(r.checkIn) : r.shiftStart ?? '09:00',
        checkOut: r.checkOut ? punchHhmm(r.checkOut) : r.shiftEnd ?? '17:00',
        checkOutNextDay: r.checkOut ? nepalDateKey(r.checkOut) > r.date : overnight,
        reason: '',
        deviceId: r.deviceId ?? '',
      });
    }
    setFixRow(r);
  }

  function stageChange(change: PendingChange) {
    setPending(p => new Map(p).set(change.row.key, change));
    setSavedNotice(null);
    setFixRow(null);
  }

  function undoChange(key: string) {
    setPending(p => {
      const next = new Map(p);
      next.delete(key);
      return next;
    });
  }

  // The dialog's "Add to changes": validates the times and stages the edit.
  // Nothing is written until Save changes — see writeChange().
  function saveCorrection() {
    if (!fixRow) return;
    setFixError(null);
    if (!fixForm.checkIn || !fixForm.checkOut) {
      setFixError('Enter both a check-in and a check-out time.');
      return;
    }
    const outDate = fixForm.checkOutNextDay
      ? new Date(Date.parse(`${fixRow.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
      : fixRow.date;
    const inTs = new Date(nepalDateTimeToUtcMs(fixRow.date, fixForm.checkIn)).toISOString();
    const outTs = new Date(nepalDateTimeToUtcMs(outDate, fixForm.checkOut)).toISOString();
    if (outTs <= inTs) {
      setFixError(
        fixForm.checkOutNextDay
          ? 'Check-out must be after check-in.'
          : 'Check-out must be after check-in — tick "Next day" if they left the following morning.'
      );
      return;
    }
    stageChange({ kind: 'edit', row: fixRow, form: fixForm, inTs, outTs });
  }

  // The dialog's Delete: stages the day's removal, undoable from its row
  // until Save changes.
  function deleteAttendance() {
    if (!fixRow) return;
    stageChange({ kind: 'delete', row: fixRow });
  }

  /** Writes one staged change. Returns the change with `error` set if it
   * failed (kept staged for another try), or null once it's saved.
   *
   * An edit is a direct admin correction: create the request row and
   * immediately apply it through the same approve_attendance_correction() the
   * Corrections page runs on an employee's request — recalculates the day's
   * hours/late/early/overtime and locks it (manually_corrected) against the
   * nightly recompute. No second person: the reviewer is the admin doing it.
   *
   * A delete saves the day as a locked (manually_corrected) row with no
   * times — see isDeletedDay() in lib/shift.ts. The punches themselves are
   * not removed: the device would only sync them back, and they stay visible
   * in the day's punch history. compute_payroll_summaries() never touches a
   * corrected row, so the deletion holds. company_id is stamped by the
   * table's insert trigger. */
  async function writeChange(change: PendingChange): Promise<PendingChange | null> {
    const r = change.row;
    if (change.kind === 'delete') {
      const { error } = await supabase.from('payroll_summaries').upsert(
        {
          employee_id: r.employeeId,
          work_date: r.date,
          shift_name: r.shiftName,
          check_in: null,
          check_out: null,
          total_hours: 0,
          is_late: false,
          late_minutes: 0,
          is_early_departure: false,
          early_departure_minutes: 0,
          overtime_hours: 0,
          manually_corrected: true,
          device_id: null,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id,work_date' }
      );
      return error ? { ...change, error: `Could not delete: ${error.message}` } : null;
    }
    let requestId = change.requestId;
    if (!requestId) {
      const { data: inserted, error: insertError } = await supabase
        .from('attendance_correction_requests')
        .insert({
          employee_id: r.employeeId,
          work_date: r.date,
          requested_check_in: change.inTs,
          requested_check_out: change.outTs,
          reason: change.form.reason.trim() || null,
          device_id: change.form.deviceId || null,
        })
        .select('id')
        .single();
      if (insertError || !inserted) return { ...change, error: insertError?.message ?? 'Could not save the correction.' };
      requestId = inserted.id as string;
    }
    const { error: applyError } = await supabase.rpc('approve_attendance_correction', { p_request_id: requestId });
    return applyError ? { ...change, requestId, error: `Saved, but applying it failed: ${applyError.message}` } : null;
  }

  // Save changes: writes every staged change, oldest date first (an overnight
  // correction can own the next morning's punch). Failures stay staged with
  // their reason on the row; the rest are cleared. True when all saved.
  async function saveAllChanges(): Promise<boolean> {
    const changes = [...pending.values()].sort((a, b) => a.row.date.localeCompare(b.row.date));
    setSavingAll(true);
    setSavedNotice(null);
    const failed = new Map<string, PendingChange>();
    for (let i = 0; i < changes.length; i++) {
      setSaveProgress(i + 1);
      const result = await writeChange(changes[i]);
      if (result) failed.set(result.row.key, result);
    }
    const saved = changes.length - failed.size;
    setPending(failed);
    setSavingAll(false);
    if (saved > 0) setRefreshTick(t => t + 1);
    if (failed.size === 0) setSavedNotice(`${saved} change${saved === 1 ? '' : 's'} saved`);
    return failed.size === 0;
  }

  /** Runs a filter, date or mode change — or holds it behind the "Save your
   * changes first?" prompt while there are unsaved changes. */
  function guarded(action: () => void) {
    if (pending.size === 0) action();
    else setGuardAction(() => action);
  }

  useEffect(() => {
    if (!savedNotice) return;
    const t = setTimeout(() => setSavedNotice(null), 4000);
    return () => clearTimeout(t);
  }, [savedNotice]);

  // Leaving the page asks too: the browser's own prompt for a reload or
  // close, a confirm for an in-app link (caught before Next's router sees the
  // click).
  useEffect(() => {
    if (pending.size === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onLinkClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      if (!window.confirm('You have unsaved attendance changes. Leave this page and lose them?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onLinkClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onLinkClick, true);
    };
  }, [pending.size]);

  function exportCsv() {
    const header = [
      'Date',
      'Day',
      'ID',
      'Employee',
      'Shift',
      'Check-In',
      'Check-Out',
      'Late In (min)',
      'Early In (min)',
      'Early Out (min)',
      'Late Out (min)',
      'Total Work Hours',
      'Overtime',
      'Status',
      'Device',
    ];
    const lines = rows.map(r => [
      r.date,
      weekdayShort(r.date),
      r.enrollId,
      r.employeeName,
      r.shiftLabel,
      r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour12: false }) : '',
      r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour12: false }) : '',
      r.lateMinutes || '',
      r.earlyArrivalMinutes || '',
      r.earlyMinutes || '',
      r.lateDepartureMinutes || '',
      r.hours.toFixed(1),
      r.overtime.toFixed(1),
      r.status,
      r.device,
    ]);
    // lines is built from rows in the same order (rows is sorted by
    // enrollId — see the .sort() above — so each employee's whole date
    // range is one contiguous block), same page-break-per-employee logic
    // as the printed table's <tr break-before>.
    const pageBreakBeforeRowIndexes = rows
      .map((r, i) => (i > 0 && rows[i - 1].employeeId !== r.employeeId ? i : -1))
      .filter(i => i >= 0);
    downloadExcel(`attendance_${from}_to_${to}.csv`, header, lines, pageBreakBeforeRowIndexes);
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
                  onChange={e => {
                    const v = e.target.value;
                    guarded(() => setEmployeeId(v));
                  }}
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
                <button onClick={() => guarded(() => setEmployeeId('all'))} className="text-[11px] font-medium text-accent hover:underline">
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
                onChange={e => {
                  const v = e.target.value as typeof status;
                  guarded(() => setStatus(v));
                }}
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
            {/* Wide enough for two spelled-out BS dates ("22 Shrawan 2083 –
                22 Shrawan 2083"); at the old w-48 the picker's own `truncate`
                cut the second one off to "22 Bhadra 2083 – 22 …". */}
            <div className="w-[21rem]">
              <DateRangePicker from={from} to={to} onChange={(f, t) => guarded(() => {
                setFrom(f);
                setTo(t);
              })} />
            </div>
          </div>

          {/* Correction mode — off is the standard report; on surfaces a Fix
              chip on every past one-punch day for a direct admin correction. */}
          <button
            type="button"
            onClick={() => guarded(() => setCorrectionMode(v => !v))}
            title={
              correctionMode
                ? 'Correction mode on — click a Fix chip to correct a missed punch, or to add attendance on an Absent / Week Off day'
                : `Turn on to fix missed punches and add attendance on Absent / Week Off days${incompleteCount ? ` (${incompleteCount} missed punches in this range)` : ''}`
            }
            className={`flex items-center gap-2 self-end rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
              correctionMode
                ? 'border-accent/40 bg-accent-light text-good-text'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <CorrectionIcon className={`h-3.5 w-3.5 ${correctionMode ? 'text-good-text' : 'text-slate-400'}`} />
            Correction
            {incompleteCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                  correctionMode ? 'bg-white/70 text-good-text' : 'bg-warning-bg text-warning-text'
                }`}
              >
                {incompleteCount}
              </span>
            )}
            <span
              className={`ml-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                correctionMode ? 'bg-accent' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                  correctionMode ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>

          <TableExportBar onExportCsv={exportCsv} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        {/* Same left-to-right table on every screen size, including phones —
            horizontal scroll instead of a condensed/truncated mobile layout,
            so it always matches the desktop web view exactly. Print gets the
            full table instead of just the scrolled-into-view slice. */}
        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="max-h-[65vh] overflow-auto rounded-lg print:max-h-none print:overflow-visible">
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
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 print:static print:text-ink">
              <th className="w-px whitespace-nowrap px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Date</th>
              <th className="w-px whitespace-nowrap px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Day</th>
              <th className="w-px whitespace-nowrap px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">ID</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Employee</th>
              <th className="w-px px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Shift</th>
              <th className="w-px whitespace-nowrap px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Check-In</th>
              <th className="w-px whitespace-nowrap px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Check-Out</th>
              <th className="w-px whitespace-nowrap px-1.5 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Late/Early</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Work Hours</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Overtime</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-semibold print:w-16 print:border print:border-slate-400 print:px-1 print:py-1">Status</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-semibold print:border print:border-slate-400 print:px-1 print:py-1">Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((saved, i) => {
              // `r` is the row as it reads with its staged change (if any);
              // `saved` is what's in the database, shown struck through.
              const r = shownRows[i];
              const change = pending.get(saved.key);
              const canFix = correctionMode && correctable(r);
              const blank = canFix ? blankPunch(r) : null;
              // Amber only for a likely missed punch. An Absent / Week Off day
              // is an ordinary state: its –:– cells stay plain and are edited
              // like any recorded time, via the hover pencil.
              const flagged = canFix && missedPunch(r);
              // rows is sorted by enrollId (see the .sort() above), so every
              // employee's whole date range is one contiguous block — this is
              // that block's first row. Printing "All Employees" for a month
              // otherwise lets a page break fall in the middle of someone's
              // days, splitting one person's data across two pages with no
              // visual boundary; forcing a break here keeps every printed
              // page's content confined to a single employee. Skipped for the
              // very first row so it doesn't waste a blank leading page.
              const isFirstRowForEmployee = i > 0 && rows[i - 1].employeeId !== r.employeeId;
              return (
              <tr
                key={r.key}
                className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 print:hover:bg-transparent ${flagged ? 'bg-warning-bg/40 print:bg-transparent' : ''} ${change?.kind === 'edit' ? 'bg-info-bg/50 print:bg-transparent' : change?.kind === 'delete' ? 'bg-critical-bg/40 print:bg-transparent' : ''}`}
                style={isFirstRowForEmployee ? { breakBefore: 'page' } : undefined}
              >
                {/* Numeric date (22/05/2083) rather than the spelled-out
                    "22 Bhadra 2083" — the month name is the same on every
                    row and the range is already named in the header, so the
                    words only cost width. The Day column beside it is what
                    makes a date scannable in practice. */}
                <td className={`w-px whitespace-nowrap px-1.5 py-1 tabular-nums text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink ${flagged ? 'border-l-2 border-l-warning' : ''} ${change?.kind === 'edit' ? 'border-l-2 border-l-info print:border-l' : change?.kind === 'delete' ? 'border-l-2 border-l-critical print:border-l' : ''}`}>{formatDdMmYyyy(r.date, system)}</td>
                <td className="w-px whitespace-nowrap px-1.5 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">{weekdayShort(r.date)}</td>
                <td className="w-px whitespace-nowrap px-1.5 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">{r.enrollId}</td>
                <td className="whitespace-nowrap px-2 py-1 font-medium text-ink print:border print:border-slate-400 print:px-2 print:py-1">{r.employeeName}</td>
                <td className="w-px px-1.5 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  <span className="flex flex-col leading-tight">
                    <span className="whitespace-nowrap">{r.shiftName}</span>
                    {r.shiftTime && <span className="whitespace-nowrap text-[10px] text-slate-400 print:text-ink">{r.shiftTime}</span>}
                  </span>
                </td>
                <td className="w-px whitespace-nowrap px-1.5 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  {!canFix ? (
                    <CheckInCell row={r} />
                  ) : blank === 'in' ? (
                    <FixChip onClick={() => openCorrection(saved)} />
                  ) : (
                    <EditablePunch onClick={() => openCorrection(saved)}>
                      <CheckInCell row={r} />
                    </EditablePunch>
                  )}
                  {change && fmtPunch(saved.checkIn) !== fmtPunch(r.checkIn) && <WasValue>{fmtPunch(saved.checkIn)}</WasValue>}
                </td>
                <td className="w-px whitespace-nowrap px-1.5 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  {!canFix ? (
                    <CheckOutCell row={r} />
                  ) : blank === 'out' ? (
                    <FixChip onClick={() => openCorrection(saved)} />
                  ) : (
                    <EditablePunch onClick={() => openCorrection(saved)}>
                      <CheckOutCell row={r} />
                    </EditablePunch>
                  )}
                  {change && fmtPunch(saved.checkOut) !== fmtPunch(r.checkOut) && <WasValue>{fmtPunch(saved.checkOut)}</WasValue>}
                </td>
                <td className="w-px whitespace-nowrap px-1.5 py-1 text-[10px] print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  <LateEarlyCell row={r} />
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  {fmtHrs(r.hours)}
                  {change && fmtHrs(saved.hours) !== fmtHrs(r.hours) && <WasValue>{fmtHrs(saved.hours)}</WasValue>}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-ink">
                  {fmtHrs(r.overtime)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 print:w-20 print:border print:border-slate-400 print:px-1 print:py-1">
                  <span className="print:hidden">{statusBadge(r)}</span>
                  <span className="hidden print:inline print:text-ink">{r.status}</span>
                  {change && saved.status !== r.status && <WasValue>{saved.status}</WasValue>}
                </td>
                <td className="whitespace-nowrap print-wrap px-2 py-1 text-slate-600 print:border print:border-slate-400 print:px-2 print:py-1 print:text-[8px] print:text-ink">
                  {canFix ? (
                    <EditablePunch onClick={() => openCorrection(saved)}>
                      <span>{r.device}</span>
                    </EditablePunch>
                  ) : (
                    r.device
                  )}
                  {change && (
                    <button
                      type="button"
                      onClick={() => undoChange(saved.key)}
                      disabled={savingAll}
                      title={change.kind === 'delete' ? 'Keep this day — undo the deletion' : 'Undo this change'}
                      className={`ml-2 rounded px-1 text-[11px] font-semibold hover:underline disabled:opacity-50 print:hidden ${
                        change.kind === 'delete' ? 'text-critical-text' : 'text-info-text'
                      }`}
                    >
                      Undo
                    </button>
                  )}
                  {change?.error && <span className="block whitespace-normal text-[10px] text-critical-text print:hidden">{change.error}</span>}
                </td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-slate-400">
                  {loading ? 'Loading…' : 'No records in this range.'}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-xs font-bold text-ink print:static print:bg-white print:text-[10px]">
                <td colSpan={5} className="whitespace-nowrap px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500 print:border print:border-slate-400 print:px-2 print:text-[10px] print:text-ink">
                  Total
                </td>
                <td className="print:border print:border-slate-400" />
                <td className="print:border print:border-slate-400" />
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

      {/* Nothing staged in Correction mode is written until this bar's Save
          changes — see saveAllChanges(). */}
      {pending.size > 0 && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className={`sticky bottom-4 z-30 mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-ink py-3 pl-4 pr-3 shadow-lg print:hidden ${
            !savingAll && [...pending.values()].some(c => c.error) ? 'ring-2 ring-critical' : ''
          }`}
        >
          <div className="min-w-0 flex-1">
            {savingAll ? (
              <>
                <div className="text-sm font-semibold text-white">
                  Saving {saveProgress} of {pending.size}…
                </div>
                <div className="text-xs text-slate-300">Keep this page open until it finishes.</div>
              </>
            ) : [...pending.values()].some(c => c.error) ? (
              <>
                <div className="text-sm font-semibold text-white">
                  {pending.size} change{pending.size === 1 ? '' : 's'} not saved
                </div>
                <div className="text-xs text-red-200">
                  The reason is shown on each row. Fix or undo it there, then save again.
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-white">
                  {pending.size} unsaved change{pending.size === 1 ? '' : 's'}
                </div>
                <div className="text-xs text-slate-300">
                  {(() => {
                    const deletes = [...pending.values()].filter(c => c.kind === 'delete').length;
                    const edits = pending.size - deletes;
                    const parts = [edits && `${edits} corrected`, deletes && `${deletes} deleted`].filter(Boolean).join(', ');
                    return `${parts}. Nothing is recorded until you save — hours and pay recalculate then.`;
                  })()}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPending(new Map())}
            disabled={savingAll}
            className="h-10 rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Discard all
          </button>
          <button
            type="button"
            onClick={saveAllChanges}
            disabled={savingAll}
            className="flex h-10 items-center gap-2 rounded-lg bg-good-text px-5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-70"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {savingAll ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {savedNotice && (
        <div role="status" className="sticky bottom-4 z-30 mx-auto mt-3 flex w-fit items-center gap-2.5 rounded-xl border border-accent/30 bg-white px-4 py-3 shadow-lg print:hidden">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-light text-good-text">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-ink">{savedNotice}</span>
          <span className="text-xs text-slate-500">Hours and pay have been recalculated.</span>
        </div>
      )}

      {fixRow && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8 print:hidden"
          onClick={() => setFixRow(null)}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-ink">
              {!fixRow.checkIn && !fixRow.checkOut ? 'Add attendance for this day' : 'Correct this day'}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              An admin edit, no approval step. It shows in the report as an unsaved change — nothing is recorded until
              you click <strong className="text-ink">Save changes</strong>. Then the day&apos;s hours, late/early and
              overtime recalculate and the day is locked so the nightly recompute won&apos;t undo it.
            </p>
            {/* A no-punch day changes pay, not just a record: an Absent day
                starts earning, and a Week Off day is priced by
                calc_payroll_fields() with 0 scheduled hours, so every hour
                entered lands as overtime. Said before Save, not discovered on
                the payroll report afterwards. */}
            {fixRow.status === 'Week Off' && weekOffLeaveHours != null && (
              <p className="mt-3 rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-xs leading-relaxed text-info-text">
                This is a <strong>week off</strong>. The hours you enter are <strong>added to the employee&apos;s leave
                balance</strong> — 1 day for every full {weekOffLeaveHours}h, no half days — not paid as overtime. Use it for
                someone who genuinely came in on their day off.
              </p>
            )}
            {fixRow.status === 'Week Off' && weekOffLeaveHours == null && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-text">
                This is a <strong>week off</strong>. Nothing is scheduled, so <strong>every hour you enter is counted as
                overtime</strong> — 09:00 to 17:00 records 8h of overtime. Use it for someone who genuinely came in on
                their day off.
              </p>
            )}
            {fixRow.status === 'Absent' && (
              <p className="mt-3 rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-xs leading-relaxed text-info-text">
                This day is marked <strong>absent</strong> with no punches on record. Saving turns it into a worked day,
                so it starts counting toward the employee&apos;s pay.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">Employee</div>
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
                  <LockIcon className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="truncate">
                    {fixRow.employeeName}
                    <span className="text-slate-400"> · ID {fixRow.enrollId}</span>
                  </span>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">Work date</div>
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
                  <LockIcon className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="truncate">{formatDdMmYyyy(fixRow.date, system)}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Check-in{!fixRow.checkIn && <span className="text-warning-text"> — missing</span>}
                </label>
                <input
                  type="time"
                  value={fixForm.checkIn}
                  onChange={e => setFixForm(f => ({ ...f, checkIn: e.target.value }))}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                    fixRow.checkIn ? 'border-slate-200' : 'border-warning ring-2 ring-warning/20'
                  }`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Check-out{!fixRow.checkOut && <span className="text-warning-text"> — missing</span>}
                </label>
                <input
                  type="time"
                  value={fixForm.checkOut}
                  onChange={e => setFixForm(f => ({ ...f, checkOut: e.target.value }))}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                    fixRow.checkOut ? 'border-slate-200' : 'border-warning ring-2 ring-warning/20'
                  }`}
                />
                <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={fixForm.checkOutNextDay}
                    onChange={e => setFixForm(f => ({ ...f, checkOutNextDay: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  Next day
                  <span className="text-slate-400">— left the following morning (overnight duty)</span>
                </label>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Both times are pre-filled — from the punches on record, or the shift boundary where one is missing. Change
              whichever is wrong; both are needed for the day to recalculate.
            </p>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Device <span className="font-normal text-slate-400">(optional — shown in the report's Device column)</span>
              </label>
              <select
                value={fixForm.deviceId}
                onChange={e => setFixForm(f => ({ ...f, deviceId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">
                  {fixRow.deviceId ? 'Clear — read the device off the punch again' : `Leave as-is (${fixRow.device})`}
                </option>
                {punchDevices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Reason <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                value={fixForm.reason}
                onChange={e => setFixForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. forgot to punch out"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            {fixError && <p className="mt-3 text-sm text-critical">{fixError}</p>}

            <div className="mt-5 flex items-center justify-between gap-2">
              {/* One click is enough: Delete only stages the removal. The row
                  shows it struck through with an Undo until Save changes. */}
              {(fixRow.checkIn || fixRow.checkOut) && pending.get(fixRow.key)?.kind !== 'delete' ? (
                <button
                  onClick={deleteAttendance}
                  title={`The day will show as ${fixRow.shiftName === 'Week Off' ? 'Week Off' : 'Absent'}. The device punches stay in the history but are ignored for this day. Undo it from the row, or it's recorded when you save.`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-critical-text hover:bg-critical-bg"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                  </svg>
                  Mark for deletion
                </button>
              ) : (
                <span className="text-[11px] text-slate-400">Recorded as corrected by you</span>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setFixRow(null)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCorrection}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                >
                  Add to changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* A filter, date or mode change while changes are unsaved — held in
          guardAction until the admin picks one of these. */}
      {guardAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 print:hidden" onClick={() => !savingAll && setGuardAction(null)}>
          <div role="alertdialog" aria-labelledby="unsaved-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 id="unsaved-title" className="text-lg font-semibold text-ink">Save your changes first?</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              You have <strong className="text-ink">{pending.size} unsaved change{pending.size === 1 ? '' : 's'}</strong> in this
              report. Changing the employee, status or date range, or turning off Correction mode, will lose them.
            </p>
            <ul className="mt-3 list-disc rounded-lg bg-slate-50 py-2 pl-7 pr-3 text-xs leading-relaxed text-slate-600">
              {[...pending.values()]
                .sort((a, b) => a.row.date.localeCompare(b.row.date))
                .map(c => (
                  <li key={c.row.key}>
                    {formatDdMmYyyy(c.row.date, system)} · {c.row.employeeName}:{' '}
                    {c.kind === 'delete' ? 'attendance deleted' : `${c.form.checkIn} – ${c.form.checkOut}${c.form.checkOutNextDay ? ' (next day)' : ''}`}
                  </li>
                ))}
            </ul>
            <div className="mt-5 flex items-center gap-2">
              <button
                onClick={() => {
                  setPending(new Map());
                  guardAction();
                  setGuardAction(null);
                }}
                disabled={savingAll}
                className="mr-auto rounded-lg px-3 py-2 text-sm font-medium text-critical-text hover:bg-critical-bg disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={() => setGuardAction(null)}
                disabled={savingAll}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
              >
                Keep editing
              </button>
              <button
                onClick={async () => {
                  const action = guardAction;
                  if (await saveAllChanges()) action();
                  setGuardAction(null);
                }}
                disabled={savingAll}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingAll ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CorrectionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
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
