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
type Base = {
  employees: Employee[];
  shifts: Shift[];
  weeklyPatternRows: { employee_id: string; weekday: number; shift_id: string | null }[];
  weeklyOffDay: number | null;
};

/** What one month needs. `key` says which month it is, so a slow answer for a month the page has
 * already left is never shown against the new one. */
type MonthData = {
  key: string;
  summaries: PayrollSummary[];
  logs: AttendanceLog[];
  dailyShiftRows: { employee_id: string; work_date: string; shift_id: string | null }[];
  holidays: CompanyHoliday[];
  leave: { employee_id: string; start_date: string; end_date: string }[];
};

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
  const [base, setBase] = useState<Base | null>(null);
  const [month, setMonth] = useState<MonthData | null>(null);
  const [error, setError] = useState('');
  const today = nepalTodayIso();

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('shifts').select('*'),
      supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id'),
      fetchMyCompanyWeekOffConfig(),
    ]).then(([employees, shifts, pattern, config]) => {
      if (!live) return;
      if (employees.error) {
        setError(`Could not load employees: ${employees.error.message}`);
        return;
      }
      setBase({
        employees: (employees.data ?? []) as Employee[],
        shifts: (shifts.data ?? []) as Shift[],
        weeklyPatternRows: (pattern.data ?? []) as Base['weeklyPatternRows'],
        weeklyOffDay: config.weeklyOffDay,
      });
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    // The same rows the Payroll report reads. Punches are fetched a day either side because a Nepal-local
    // day starts at 18:15 UTC the evening before, and an overnight shift ends the morning after.
    Promise.all([
      fetchAll<PayrollSummary>((a, b) =>
        supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', start).lte('work_date', end).range(a, b)
      ),
      fetchAll<AttendanceLog>((a, b) =>
        supabase
          .from('attendance_logs')
          .select(ATTENDANCE_LOG_COLUMNS)
          .gte('punch_time', `${addDays(start, -1)}T00:00:00Z`)
          .lte('punch_time', `${addDays(end, 1)}T23:59:59Z`)
          .range(a, b)
      ),
      fetchAll<{ employee_id: string; work_date: string; shift_id: string | null }>((a, b) =>
        supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end).range(a, b)
      ),
      supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('leave_requests').select('employee_id, start_date, end_date').eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    ]).then(([summaries, logs, dailyShiftRows, holidays, leave]) => {
      if (!live) return;
      setMonth({
        key: `${start}|${end}`,
        summaries,
        logs,
        dailyShiftRows,
        holidays: (holidays.data ?? []) as CompanyHoliday[],
        leave: (leave.data ?? []) as MonthData['leave'],
      });
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
