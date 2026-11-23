import NepaliDate from 'nepali-date-converter';
import type { AttendanceLog, CompanyHoliday, Employee, PayrollSummary, Shift } from './types';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  dropPunchesClaimedBySummaries,
  isDeletedDay,
  isWeekOff,
  nepalDateKey,
  resolveShiftForDate,
  withoutSupersededSummaries,
  type DailyShiftByDate,
} from './shift';
import { leaveDatesByEmployee, weekOffDatesByGender } from './weekOff';
import type { CalendarAnchor, CalendarSystem } from './calendar';
import { isKpiOn, kpiLabel, wordsFor, type KpiId, type KpiSettings } from './kpiSettings';

// ---------------------------------------------------------------------------
// What the KPI page shows. No total, no score, no ranking: every KPI stands on
// its own, and the weights on the owner's sheet are deliberately not here.
// ---------------------------------------------------------------------------

export type KpiGroupId = 'attendance' | 'services' | 'customers' | 'colleagues';

export type KpiGroup = {
  id: KpiGroupId;
  title: string;
  /** Where the numbers in this group come from, shown under the group name. */
  source: string;
  columns: { id: string; label: string; width: number; /** True once numbers are worked out for this KPI. Until then it shows a dash. */ connected: boolean }[];
  /** True once every KPI in the group has its numbers. */
  connected: boolean;
  /** What a dash in this group means, read out to screen readers (the header says "Not connected yet"). */
  emptyNote: string;
  /** The line in the "Not connected yet" card. */
  waiting: string;
};

export const KPI_GROUPS: KpiGroup[] = [
  {
    id: 'attendance',
    title: 'Attendance',
    source: 'From the attendance records',
    columns: [{ id: 'attendance', label: 'Attendance and punctuality', width: 150, connected: true }],
    connected: true,
    emptyNote: '',
    waiting: '',
  },
  {
    id: 'services',
    title: 'Services',
    source: 'From the booking import',
    columns: [
      { id: 'services', label: 'Services performed', width: 100, connected: true },
      { id: 'rebooking', label: 'Rebooking rate', width: 100, connected: true },
      { id: 'utilisation', label: 'Hour utilisation per day', width: 120, connected: true },
    ],
    connected: false,
    emptyNote: 'No import yet',
    waiting: 'Services performed, rebooking and hour utilisation fill in once your booking data is imported.',
  },
  {
    id: 'customers',
    title: 'Customers',
    source: 'From customer forms typed in by staff',
    columns: [
      { id: 'feedback', label: 'Customer feedback', width: 110, connected: false },
      { id: 'nps', label: 'NPS', width: 90, connected: false },
    ],
    connected: false,
    emptyNote: 'No forms yet',
    waiting: 'Customer feedback and NPS fill in once customer forms are typed in.',
  },
  {
    id: 'colleagues',
    title: 'Colleague feedback',
    source: 'From monthly reviews',
    columns: [
      { id: 'peers', label: 'Peers', width: 90, connected: false },
      { id: 'manager', label: 'Manager', width: 90, connected: false },
      { id: 'clevel', label: 'C-level', width: 90, connected: false },
      { id: 'training', label: 'Training and compliance', width: 120, connected: false },
    ],
    connected: false,
    emptyNote: 'No reviews yet',
    waiting: 'Peers, manager, C-level and training and compliance fill in once colleague reviews are given.',
  },
];

/** What fills a group in, for the "fill in once ..." line. */
const WAITING_TAIL: Record<KpiGroupId, string> = {
  attendance: '',
  services: 'your booking data is imported',
  customers: 'customer forms are typed in',
  colleagues: 'colleague reviews are given',
};

/** "Peers, manager, C-level and training and compliance": the first name as it is, the others in lower case
 * unless they are names of their own ("C-level", "NPS", "Sales Calls"). */
function nameList(names: string[]): string {
  const parts = names.map((n, i) => (i > 0 && /^[A-Z][a-z]+( [a-z]+)*$/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n));
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The groups as this company sees them (Settings): the KPIs it turned off are left out (a group with none left is
 * gone), the others carry the names it gave them, and "customer" is the word it uses for its people. */
export function visibleGroups(settings: KpiSettings): KpiGroup[] {
  const words = wordsFor(settings.word);
  return KPI_GROUPS.flatMap(g => {
    const columns = g.columns.filter(c => isKpiOn(c.id as KpiId, settings)).map(c => ({ ...c, label: kpiLabel(c.id as KpiId, settings) }));
    if (columns.length === 0) return [];
    // Only the KPIs that are still waiting are named in the "fill in" line.
    const pending = columns.filter(c => !c.connected);
    const waiting = pending.length === 0 ? '' : `${nameList(pending.map(c => c.label))} ${pending.length === 1 ? 'fills' : 'fill'} in once ${words.t(WAITING_TAIL[g.id])}.`;
    return [{ ...g, title: words.t(g.title), source: words.t(g.source), emptyNote: words.t(g.emptyNote), columns, connected: pending.length === 0, waiting }];
  });
}

// ---------------------------------------------------------------------------
// Attendance and punctuality
// ---------------------------------------------------------------------------

export type AttendanceKpi = {
  /** False for someone excused from attendance: there is nothing to measure. */
  tracked: boolean;
  /** Working days so far: not a week-off or holiday, not approved leave, and not before the joining date. */
  expectedDays: number;
  /** Of those, the days with a check-in. */
  presentDays: number;
  /** Of those, the days the check-in came after the shift's grace period. */
  lateDays: number;
  /** Working days spent on approved leave (they are left out of expectedDays). */
  leaveDays: number;
};

/** Whole-number percentages for the two lines in the cell; null when there is nothing to divide by. */
export function attendanceRates(k: AttendanceKpi): { present: number | null; onTime: number | null } {
  return {
    present: k.expectedDays > 0 ? Math.round((k.presentDays / k.expectedDays) * 100) : null,
    onTime: k.presentDays > 0 ? Math.round(((k.presentDays - k.lateDays) / k.presentDays) * 100) : null,
  };
}

export type AttendanceInputs = {
  employees: Employee[];
  /** The month, as AD date keys (YYYY-MM-DD). Days after `today` are not counted. */
  start: string;
  end: string;
  today: string;
  shifts: Shift[];
  summaries: PayrollSummary[];
  logs: AttendanceLog[];
  dailyShiftRows: { employee_id: string; work_date: string; shift_id: string | null }[];
  weeklyPatternRows: { employee_id: string; weekday: number; shift_id: string | null }[];
  weeklyOffDay: number | null;
  holidays: CompanyHoliday[];
  leave: { employee_id: string; start_date: string; end_date: string }[];
};

function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Each person's attendance KPI for the month, judged the way the Payroll report judges a day: a saved
 * payroll_summaries row where the nightly job has run, the raw punches where it has not (and always for
 * today), the same week-off / roster / holiday / leave rules, and the same overnight-shift fixes.
 * Present is counted only on working days, so working a week-off never pushes someone above 100%.
 */
export function computeAttendanceKpis(i: AttendanceInputs): Map<string, AttendanceKpi> {
  const out = new Map<string, AttendanceKpi>();
  const lastDay = i.end < i.today ? i.end : i.today;
  const days = i.start > lastDay ? [] : eachDay(i.start, lastDay);

  const dailyShiftByDate: DailyShiftByDate = new Map();
  for (const r of i.dailyShiftRows) {
    const perDate = dailyShiftByDate.get(r.employee_id) ?? new Map<string, string | null>();
    perDate.set(r.work_date, r.shift_id);
    dailyShiftByDate.set(r.employee_id, perDate);
  }
  const weekOffDatesFor = weekOffDatesByGender(i.start, i.end, i.weeklyOffDay, i.holidays);
  const leaveByEmployee = leaveDatesByEmployee(i.leave);
  const weeklyPattern = buildWeeklyPatternByEmployee(i.weeklyPatternRows);
  const summaries = withoutSupersededSummaries(i.summaries);

  const summariesByEmployee = new Map<string, PayrollSummary[]>();
  for (const s of summaries) {
    const list = summariesByEmployee.get(s.employee_id) ?? [];
    list.push(s);
    summariesByEmployee.set(s.employee_id, list);
  }
  const logsByEmployee = new Map<string, AttendanceLog[]>();
  for (const l of i.logs) {
    const list = logsByEmployee.get(l.employee_id) ?? [];
    list.push(l);
    logsByEmployee.set(l.employee_id, list);
  }

  for (const emp of i.employees) {
    const kpi: AttendanceKpi = { tracked: !emp.attendance_exempt, expectedDays: 0, presentDays: 0, lateDays: 0, leaveDays: 0 };
    out.set(emp.id, kpi);
    if (!kpi.tracked || days.length === 0) continue;

    const weekOffDates = weekOffDatesFor(emp.gender);
    const empSummaries = summariesByEmployee.get(emp.id) ?? [];
    const summaryByDay = new Map(empSummaries.map(s => [s.work_date, s]));
    const empLogs = logsByEmployee.get(emp.id) ?? [];
    const byDate = new Map<string, AttendanceLog[]>();
    for (const l of empLogs) {
      const day = nepalDateKey(l.punch_time);
      const list = byDate.get(day) ?? [];
      list.push(l);
      byDate.set(day, list);
    }
    applyOvernightShiftCorrection(byDate, empLogs, emp, i.shifts, dailyShiftByDate, weekOffDates, weeklyPattern, days);
    dropPunchesClaimedBySummaries(byDate, empSummaries, i.today);
    const leaveDates = leaveByEmployee.get(emp.id);

    for (const day of days) {
      if (emp.date_of_joining && day < emp.date_of_joining) continue;
      const resolved = resolveShiftForDate(emp, i.shifts, day, dailyShiftByDate, weekOffDates, weeklyPattern);
      const off = isWeekOff(resolved);
      const onLeave = leaveDates?.has(day) ?? false;

      // Today can still gain punches after its saved row was computed, so it is always read live.
      const summary = day === i.today ? undefined : summaryByDay.get(day);
      let present = false;
      let late = false;
      if (summary?.check_in) {
        present = true;
        late = summary.is_late;
      } else {
        const dayLogs = isDeletedDay(summary) ? [] : (byDate.get(day) ?? []);
        if (dayLogs.length > 0) {
          present = true;
          late = computeDayStatusForResolvedShift([...dayLogs].sort((a, b) => a.punch_time.localeCompare(b.punch_time)), resolved).isLate;
        }
      }

      if (off || onLeave) {
        if (onLeave && !off) kpi.leaveDays += 1;
        continue;
      }
      kpi.expectedDays += 1;
      if (present) {
        kpi.presentDays += 1;
        if (late) kpi.lateDays += 1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The month in the other calendar
// ---------------------------------------------------------------------------

/** "Kartik – Mangsir 2083" under an AD month, "November – December 2026" under a BS one: the span of
 * the month being shown, in the calendar that is NOT the active one. Empty if the date cannot be converted. */
export function otherCalendarSpan(system: CalendarSystem, start: string, end: string): string {
  try {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    let from: { month: string; year: number };
    let to: { month: string; year: number };
    if (system === 'AD') {
      const a = NepaliDate.fromAD(new Date(sy, sm - 1, sd));
      const b = NepaliDate.fromAD(new Date(ey, em - 1, ed));
      from = { month: a.format('MMMM'), year: a.getYear() };
      to = { month: b.format('MMMM'), year: b.getYear() };
    } else {
      const name = (y: number, m: number) => new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
      from = { month: name(sy, sm), year: sy };
      to = { month: name(ey, em), year: ey };
    }
    if (from.month === to.month && from.year === to.year) return `${from.month} ${from.year}`;
    return from.year === to.year ? `${from.month} – ${to.month} ${to.year}` : `${from.month} ${from.year} – ${to.month} ${to.year}`;
  } catch {
    return '';
  }
}

/** The month a link points at, as `?date=YYYY-MM-DD` (any day inside it; the KPI list sends the month's first day),
 * back to the AD anchor the month steppers use. Null when it is missing or not a real date. */
export function parseMonthParam(value: string | null | undefined): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return { year: y, month: mo - 1, day: d };
}
