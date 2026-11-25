// Ported from admin-web/lib/useEmployeeKpi.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useEffect, useMemo, useState } from 'react';
import { nepalTodayIso } from './shift';
import { computeAttendanceKpis, type AttendanceKpi } from './kpi';
import { fetchKpiBase, fetchKpiMonth, type KpiBase, type KpiMonthData } from './useKpiOverview';
import type { Employee } from '../types';

export type MonthRange = { start: string; end: string };

export type EmployeeKpi = {
  loading: boolean;
  error: string;
  /** The person was not found (a mistyped or deleted link). */
  notFound: boolean;
  employee: Employee | null;
  /** The month being shown, and the one before it, which sits under each KPI as "last month". */
  current: AttendanceKpi | null;
  previous: AttendanceKpi | null;
  today: string;
};

/** One person's numbers for the month `cur` and the month `prev` before it (AD date keys). The attendance
 * figures come from the same tables, and the same rules, as the KPI list and the Payroll report. */
export function useEmployeeKpi(employeeId: string, cur: MonthRange, prev: MonthRange): EmployeeKpi {
  const [base, setBase] = useState<{ id: string; base: KpiBase } | null>(null);
  const [months, setMonths] = useState<{ key: string; cur: KpiMonthData; prev: KpiMonthData } | null>(null);
  const [error, setError] = useState('');
  const today = nepalTodayIso();
  const monthsKey = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;

  useEffect(() => {
    let live = true;
    setError('');
    fetchKpiBase(employeeId).then(r => {
      if (!live) return;
      if (r.error || !r.base) setError(r.error);
      else setBase({ id: employeeId, base: r.base });
    });
    return () => {
      live = false;
    };
  }, [employeeId]);

  useEffect(() => {
    let live = true;
    Promise.all([fetchKpiMonth(cur.start, cur.end, employeeId), fetchKpiMonth(prev.start, prev.end, employeeId)]).then(([c, p]) => {
      if (live) setMonths({ key: monthsKey, cur: c, prev: p });
    });
    return () => {
      live = false;
    };
    // monthsKey already carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsKey]);

  const baseOk = base && base.id === employeeId ? base.base : null;
  const monthsOk = months && months.key === monthsKey ? months : null;
  const employee = baseOk?.employees[0] ?? null;

  const figures = useMemo(() => {
    if (!baseOk || !monthsOk || !employee) return null;
    const calc = (m: KpiMonthData, r: MonthRange) =>
      computeAttendanceKpis({
        employees: [employee],
        start: r.start,
        end: r.end,
        today,
        shifts: baseOk.shifts,
        summaries: m.summaries,
        logs: m.logs,
        dailyShiftRows: m.dailyShiftRows,
        weeklyPatternRows: baseOk.weeklyPatternRows,
        weeklyOffDay: baseOk.weeklyOffDay,
        holidays: m.holidays,
        leave: m.leave,
      }).get(employee.id) ?? null;
    return { current: calc(monthsOk.cur, cur), previous: calc(monthsOk.prev, prev) };
    // `cur` and `prev` are covered by monthsOk, which is only set for the months they name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseOk, monthsOk, employee, today]);

  return {
    loading: !error && (!baseOk || (!!employee && !figures)),
    error,
    notFound: !error && !!baseOk && !employee,
    employee,
    current: figures?.current ?? null,
    previous: figures?.previous ?? null,
    today,
  };
}
