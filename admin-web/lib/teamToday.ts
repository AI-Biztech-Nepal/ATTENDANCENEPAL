import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import { dateKey, isLate, presentEmployeeIds } from './metrics';
import {
  buildWeeklyPatternByEmployee,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from './shift';
import { fetchMyCompanyWeekOffConfig, weekOffDatesByGender } from './weekOff';
import type { AttendanceLog, CompanyHoliday, Employee, Shift } from './types';
import { ATTENDANCE_LOG_COLUMNS } from './types';

/** How the active staff stand today. `onTime` and `late` are the people who have punched in, split by
 * whether they were late; the rest of the team is `absent`, `onLeave` or off (`weekOff`). */
export type TeamToday = { people: number; onTime: number; late: number; absent: number; onLeave: number; weekOff: number };

/** A holiday (or a run of consecutive days with the same name) — `end` is the last day. */
export type NextHoliday = { name: string; start: string; end: string };

type Inputs = {
  employees: Employee[];
  shifts: Shift[];
  logs: AttendanceLog[];
  onLeaveIds: Set<string>;
  todayRoster: { employee_id: string; shift_id: string | null }[];
  weeklyPatternRows: { employee_id: string; weekday: number; shift_id: string | null }[];
  weeklyOffDay: number | null;
  holidays: CompanyHoliday[];
  today: string;
};

/** The same rules the dashboard's attendance bar uses: someone is Absent only if they have not
 * punched, are not on approved leave, are not excused from attendance and do not have a Week Off
 * today — by the company's weekly day or a holiday that covers them, or by their own roster. Late is
 * judged against the shift each person is actually on. */
export function computeTeamToday(i: Inputs): TeamToday {
  const active = i.employees.filter(e => e.status === 'active');
  const todayLogs = i.logs.filter(l => dateKey(l.punch_time) === i.today);
  const presentIds = presentEmployeeIds(i.logs, i.today);

  const dailyShiftByDate: DailyShiftByDate = new Map();
  for (const r of i.todayRoster) {
    const perDate = dailyShiftByDate.get(r.employee_id) ?? new Map<string, string | null>();
    perDate.set(i.today, r.shift_id);
    dailyShiftByDate.set(r.employee_id, perDate);
  }
  const weekOffDatesFor = weekOffDatesByGender(i.today, i.today, i.weeklyOffDay, i.holidays.filter(h => h.holiday_date === i.today));
  const todayIsCompanyOff = weekOffDatesFor(null).has(i.today);
  const weeklyPattern = buildWeeklyPatternByEmployee(i.weeklyPatternRows);
  const offToday = (e: Employee) => isWeekOff(resolveShiftForDate(e, i.shifts, i.today, dailyShiftByDate, weekOffDatesFor(e.gender), weeklyPattern));

  let late = 0;
  let present = 0;
  let absent = 0;
  let onLeave = 0;
  let weekOff = 0;
  for (const emp of active) {
    const isPresent = presentIds.has(emp.id);
    if (isPresent) {
      present += 1;
      const empLogs = todayLogs.filter(l => l.employee_id === emp.id);
      if (empLogs.length > 0 && isLate(emp, i.shifts, empLogs, i.today, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern)) late += 1;
    }
    if (i.onLeaveIds.has(emp.id)) onLeave += 1;
    if (offToday(emp)) weekOff += 1;
    if (!todayIsCompanyOff && !isPresent && !i.onLeaveIds.has(emp.id) && !emp.attendance_exempt && !offToday(emp)) absent += 1;
  }
  return { people: active.length, onTime: Math.max(0, present - late), late, absent, onLeave, weekOff };
}

/** The first holiday on or after `today`, widened to the whole run if it spans several days. */
export function nextHolidayFrom(holidays: Pick<CompanyHoliday, 'holiday_date' | 'name'>[], today: string): NextHoliday | null {
  const upcoming = [...holidays].filter(h => h.holiday_date >= today).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  if (upcoming.length === 0) return null;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const dayAfter = (key: string) => {
    const d = new Date(key + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const first = upcoming[0];
  let end = first.holiday_date;
  for (const h of upcoming.slice(1)) {
    if (h.holiday_date === end) continue; // a second row for the same day (a gender-scoped copy)
    if (h.holiday_date === dayAfter(end) && same(h.name, first.name)) end = h.holiday_date;
    else break;
  }
  return { name: first.name, start: first.holiday_date, end };
}

/** What this hook reads itself; `holidays` are today's and the ones still to come. */
type Loaded = Omit<Inputs, 'employees' | 'today'>;

/** Today's numbers for the whole team, and the next holiday. `employees` is whoever the page already
 * loaded (the active staff); everything else is read here, once. `summary` is null until it arrives. */
export function useTeamToday(employees: Employee[]): { summary: TeamToday | null; nextHoliday: NextHoliday | null } {
  const [data, setData] = useState<Loaded | null>(null);
  const today = nepalTodayIso();

  useEffect(() => {
    let live = true;
    // A couple of days back is plenty: "today" is judged on Nepal's date.
    const since = new Date(Date.now() - 48 * 3600e3).toISOString();
    Promise.all([
      supabase.from('shifts').select('*'),
      fetchAll<AttendanceLog>((a, b) =>
        supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', since).order('punch_time', { ascending: false }).range(a, b)
      ),
      supabase.from('leave_requests').select('employee_id').eq('status', 'approved').lte('start_date', today).gte('end_date', today),
      supabase.from('employee_daily_shifts').select('employee_id, shift_id').eq('work_date', today),
      supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id'),
      supabase.from('company_holidays').select('*').gte('holiday_date', today).order('holiday_date', { ascending: true }).limit(60),
      fetchMyCompanyWeekOffConfig(),
    ]).then(([shifts, logs, leave, roster, pattern, holidays, config]) => {
      if (!live) return;
      setData({
        shifts: (shifts.data ?? []) as Shift[],
        logs,
        onLeaveIds: new Set(((leave.data ?? []) as { employee_id: string }[]).map(l => l.employee_id)),
        todayRoster: (roster.data ?? []) as Loaded['todayRoster'],
        weeklyPatternRows: (pattern.data ?? []) as Loaded['weeklyPatternRows'],
        holidays: (holidays.data ?? []) as CompanyHoliday[],
        weeklyOffDay: config.weeklyOffDay,
      });
    });
    return () => {
      live = false;
    };
  }, [today]);

  const summary = useMemo(() => (data ? computeTeamToday({ ...data, employees, today }) : null), [data, employees, today]);
  const nextHoliday = useMemo(() => (data ? nextHolidayFrom(data.holidays, today) : null), [data, today]);
  return { summary, nextHoliday };
}
