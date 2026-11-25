// Ported from admin-web/lib/useOwnKpiValues.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked } from './kpiLoad';
import { valueFromRow } from './ownKpi';
import type { MonthRange } from './useServiceKpi';

// The numbers typed in for the KPIs of your own. A month is the exact period on screen (the Nepali month or the English
// one), the same rule as colleague review rounds, so a number is read back for the month it was typed in for.

const WHAT = 'the numbers for your own KPIs';

type Row = { kpi_id: string; employee_id: string; value: unknown };

export type OwnMonth = {
  loading: boolean;
  /** For each KPI, each person's number. A KPI nobody has a number for yet has an empty map. */
  byKpi: Map<string, Map<string, number>>;
  /** Set when the numbers could not be read (a table that is not there yet, a refused read): not the same as "none typed in". */
  error: string;
};

const NONE: OwnMonth = { loading: false, byKpi: new Map(), error: '' };

/** Everyone's numbers for the KPIs `kpiIds`, for the month `start`..`end`. `enabled` holds the work back (for a month that
 * has not begun, or when there is no KPI of your own in use). */
export function useOwnMonth(kpiIds: string[], start: string, end: string, enabled = true): OwnMonth {
  const key = `${kpiIds.join(',')}|${start}|${end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<OwnMonth, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled || kpiIds.length === 0) return;
    let live = true;
    fetchAllChecked<Row>(
      (a, b) => supabase.from('custom_kpi_values').select('kpi_id, employee_id, value').in('kpi_id', kpiIds).eq('period_start', start).eq('period_end', end).order('id', { ascending: true }).range(a, b),
      WHAT,
      MIGRATION.own
    ).then(({ rows, error }) => {
      if (!live) return;
      const byKpi = new Map<string, Map<string, number>>(kpiIds.map(id => [id, new Map()]));
      for (const r of rows) {
        const v = valueFromRow(r.value);
        if (v != null) byKpi.get(r.kpi_id)?.set(r.employee_id, v);
      }
      setDone({ key, value: { byKpi, error } });
    });
    return () => {
      live = false;
    };
    // `key` carries the KPIs, start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled || kpiIds.length === 0) return NONE;
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, byKpi: new Map(), error: '' };
}

export type PersonOwn = {
  loading: boolean;
  /** For each KPI, this person's number in the month on screen and in the month before (null when none was typed in). */
  byKpi: Map<string, { current: number | null; previous: number | null }>;
  error: string;
};

/** One person's numbers for the KPIs `kpiIds`, for the month `cur` and the month `prev` before it. */
export function usePersonOwn(employeeId: string, kpiIds: string[], cur: MonthRange, prev: MonthRange, enabled = true): PersonOwn {
  const key = `${employeeId}|${kpiIds.join(',')}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonOwn, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled || kpiIds.length === 0) return;
    let live = true;
    fetchAllChecked<Row & { period_start: string; period_end: string }>(
      (a, b) =>
        supabase
          .from('custom_kpi_values')
          .select('kpi_id, employee_id, period_start, period_end, value')
          .eq('employee_id', employeeId)
          .in('kpi_id', kpiIds)
          .in('period_start', [cur.start, prev.start])
          .order('id', { ascending: true })
          .range(a, b),
      WHAT,
      MIGRATION.own
    ).then(({ rows, error }) => {
      if (!live) return;
      const byKpi = new Map<string, { current: number | null; previous: number | null }>(kpiIds.map(id => [id, { current: null, previous: null }]));
      for (const r of rows) {
        const v = valueFromRow(r.value);
        const slot = byKpi.get(r.kpi_id);
        if (v == null || !slot) continue;
        if (r.period_start === cur.start && r.period_end === cur.end) slot.current = v;
        else if (r.period_start === prev.start && r.period_end === prev.end) slot.previous = v;
      }
      setDone({ key, value: { byKpi, error } });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled || kpiIds.length === 0) return { loading: false, byKpi: new Map(), error: '' };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, byKpi: new Map(), error: '' };
}
