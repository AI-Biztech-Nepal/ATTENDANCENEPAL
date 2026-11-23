'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import { countByEmployee } from './serviceKpi';

export type MonthRange = { start: string; end: string };

/** How many services each person performed in the month `start`..`end`. `counts` is null while there is nothing to
 * count: no booking file covers the month (nobody has a service in it), so the list shows dashes, not zeros. */
export function useServiceCounts(start: string, end: string): { loading: boolean; counts: Map<string, number> | null } {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; counts: Map<string, number> | null } | null>(null);

  useEffect(() => {
    let live = true;
    // A table that is not there yet (before the import migration) gives no rows, which reads as "nothing imported".
    fetchAll<{ employee_id: string }>((a, b) =>
      supabase.from('service_records').select('employee_id').gte('performed_on', start).lte('performed_on', end).order('id', { ascending: true }).range(a, b)
    ).then(rows => {
      if (live) setDone({ key, counts: rows.length > 0 ? countByEmployee(rows) : null });
    });
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return done && done.key === key ? { loading: false, counts: done.counts } : { loading: true, counts: null };
}

export type PersonServices = {
  loading: boolean;
  /** The days (AD date keys) this person performed services on in the month, one per service. */
  dates: string[];
  /** Any service at all, for anyone, in the month: false means no booking file covers it. */
  monthHasData: boolean;
  /** The month before: how many this person performed, or null when no booking file covers it. */
  previousTotal: number | null;
};

/** One person's services for the month `cur` and the month `prev` before it. */
export function usePersonServices(employeeId: string, cur: MonthRange, prev: MonthRange): PersonServices {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonServices, 'loading'> } | null>(null);

  useEffect(() => {
    let live = true;
    const monthCount = async (r: MonthRange) => {
      const { count } = await supabase.from('service_records').select('id', { count: 'exact', head: true }).gte('performed_on', r.start).lte('performed_on', r.end);
      return count ?? 0;
    };
    Promise.all([
      fetchAll<{ performed_on: string }>((a, b) =>
        supabase
          .from('service_records')
          .select('performed_on')
          .eq('employee_id', employeeId)
          .gte('performed_on', prev.start)
          .lte('performed_on', cur.end)
          .order('id', { ascending: true })
          .range(a, b)
      ),
      monthCount(cur),
      monthCount(prev),
    ]).then(([rows, curCount, prevCount]) => {
      if (!live) return;
      const dates = rows.map(r => r.performed_on);
      setDone({
        key,
        value: {
          dates: dates.filter(d => d >= cur.start && d <= cur.end),
          monthHasData: curCount > 0,
          previousTotal: prevCount > 0 ? dates.filter(d => d >= prev.start && d <= prev.end).length : null,
        },
      });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, dates: [], monthHasData: false, previousTotal: null };
}
