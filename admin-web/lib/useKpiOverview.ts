import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import { fetchMyCompanyWeekOffConfig } from './weekOff';
import { nepalTodayIso } from './shift';
import { computeAttendanceKpis, type AttendanceKpi } from './kpi';
import { addDays } from './taskSchedule';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from './types';
import type { AttendanceLog, CompanyHoliday, Employee, PayrollSummary, Shift } from './types';

/** What does not change from month to month. */
export type KpiBase = {
  employees: Employee[];
  shifts: Shift[];
  weeklyPatternRows: { employee_id: string; weekday: number; shift_id: string | null }[];
  weeklyOffDay: number | null;
};

/** What one month needs. `key` says which month it is, so a slow answer for a month the page has
 * already left is never shown against the new one. */
export type KpiMonthData = {
  key: string;
  summaries: PayrollSummary[];
  logs: AttendanceLog[];
  dailyShiftRows: { employee_id: string; work_date: string; shift_id: string | null }[];
  holidays: CompanyHoliday[];
  leave: { employee_id: string; start_date: string; end_date: string }[];
};

/** The people and settings behind the numbers. With an `employeeId` it is that one person (whatever their
 * status), otherwise every active employee. */
export async function fetchKpiBase(employeeId?: string): Promise<{ base: KpiBase | null; error: string }> {
  const people = supabase.from('employees').select('*');
  const pattern = supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id');
  const [employees, shifts, patternRows, config] = await Promise.all([
    employeeId ? people.eq('id', employeeId) : people.eq('status', 'active'),
    supabase.from('shifts').select('*'),
    employeeId ? pattern.eq('employee_id', employeeId) : pattern,
    fetchMyCompanyWeekOffConfig(),
  ]);
  if (employees.error) return { base: null, error: `Could not load employees: ${employees.error.message}` };
  return {
    error: '',
    base: {
      employees: (employees.data ?? []) as Employee[],
      shifts: (shifts.data ?? []) as Shift[],
      weeklyPatternRows: (patternRows.data ?? []) as KpiBase['weeklyPatternRows'],
      weeklyOffDay: config.weeklyOffDay,
    },
  };
}

/** The rows the Payroll report reads for the month `start`..`end` (AD date keys), for everyone or for one
 * person. Punches are fetched a day either side because a Nepal-local day starts at 18:15 UTC the evening
 * before, and an overnight shift ends the morning after. */
export async function fetchKpiMonth(start: string, end: string, employeeId?: string): Promise<KpiMonthData> {
  const [summaries, logs, dailyShiftRows, holidays, leave] = await Promise.all([
    fetchAll<PayrollSummary>((a, b) => {
      let q = supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', start).lte('work_date', end);
      if (employeeId) q = q.eq('employee_id', employeeId);
      return q.range(a, b);
    }),
    fetchAll<AttendanceLog>((a, b) => {
      let q = supabase
        .from('attendance_logs')
        .select(ATTENDANCE_LOG_COLUMNS)
        .gte('punch_time', `${addDays(start, -1)}T00:00:00Z`)
        .lte('punch_time', `${addDays(end, 1)}T23:59:59Z`);
      if (employeeId) q = q.eq('employee_id', employeeId);
      return q.range(a, b);
    }),
    fetchAll<{ employee_id: string; work_date: string; shift_id: string | null }>((a, b) => {
      let q = supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end);
      if (employeeId) q = q.eq('employee_id', employeeId);
      return q.range(a, b);
    }),
    supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
    (() => {
      let q = supabase.from('leave_requests').select('employee_id, start_date, end_date').eq('status', 'approved').lte('start_date', end).gte('end_date', start);
      if (employeeId) q = q.eq('employee_id', employeeId);
      return q;
    })(),
  ]);
  return {
    key: `${start}|${end}`,
    summaries,
    logs,
    dailyShiftRows,
    holidays: (holidays.data ?? []) as CompanyHoliday[],
    leave: (leave.data ?? []) as KpiMonthData['leave'],
  };
}

export type KpiOverview = {
  loading: boolean;
  error: string;
  /** Everyone who works there in this month, by name. */
  employees: Employee[];
  attendance: Map<string, AttendanceKpi>;
  today: string;
};

/**
 * The people and numbers behind the KPI overview for the month `start`..`end` (AD date keys). The
 * attendance numbers come from the same tables, and the same fallbacks, as the Payroll report.
 */
export function useKpiOverview(start: string, end: string): KpiOverview {
  const [base, setBase] = useState<KpiBase | null>(null);
  const [month, setMonth] = useState<KpiMonthData | null>(null);
  const [error, setError] = useState('');
  const today = nepalTodayIso();

  useEffect(() => {
    let live = true;
    fetchKpiBase().then(r => {
      if (!live) return;
      if (r.error) setError(r.error);
      else setBase(r.base);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    fetchKpiMonth(start, end).then(m => {
      if (live) setMonth(m);
    });
    return () => {
      live = false;
    };
  }, [start, end]);

  const employees = useMemo(
    () =>
      (base?.employees ?? [])
        // Someone who joined after the month ended was not working in it.
        .filter(e => !e.date_of_joining || e.date_of_joining <= end)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [base, end]
  );

  const attendance = useMemo(() => {
    if (!base || !month || month.key !== `${start}|${end}`) return null;
    return computeAttendanceKpis({
      employees,
      start,
      end,
      today,
      shifts: base.shifts,
      summaries: month.summaries,
      logs: month.logs,
      dailyShiftRows: month.dailyShiftRows,
      weeklyPatternRows: base.weeklyPatternRows,
      weeklyOffDay: base.weeklyOffDay,
      holidays: month.holidays,
      leave: month.leave,
    });
  }, [base, month, employees, start, end, today]);

  return { loading: !attendance && !error, error, employees, attendance: attendance ?? new Map(), today };
}
