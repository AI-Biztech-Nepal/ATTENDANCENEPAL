'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import { countByEmployee } from './serviceKpi';
import { monthTime, timeByEmployee, type MonthTime, type TimedService } from './utilisationKpi';

export type MonthRange = { start: string; end: string };

/** Why there is no time with customers to work out for a month: 'none' = no booking file covers it, 'notime' = the file
 * that does did not say how long each service took. */
export type TimeReason = 'none' | 'notime' | null;

export type ServiceMonth = {
  loading: boolean;
  /** How many services each person performed. Null when no booking file covers the month (nobody has a service in it),
   * so the list shows dashes, not zeros. */
  counts: Map<string, number> | null;
  /** Each person's time with customers, from the services that have a time. Null when none has. */
  time: Map<string, MonthTime> | null;
  reason: TimeReason;
};

/** Everyone's services in the month `start`..`end`: how many each performed, and how long they spent with customers.
 * `enabled` holds the work back (for a month that has not begun). */
export function useServiceMonth(start: string, end: string, enabled = true): ServiceMonth {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<ServiceMonth, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A table that is not there yet (before the import migration) gives no rows, which reads as "nothing imported".
    fetchAll<TimedService>((a, b) =>
      supabase.from('service_records').select('employee_id, performed_on, minutes').gte('performed_on', start).lte('performed_on', end).order('id', { ascending: true }).range(a, b)
    ).then(rows => {
      if (!live) return;
      const time = timeByEmployee(rows);
      setDone({
        key,
        value: {
          counts: rows.length > 0 ? countByEmployee(rows) : null,
          time: time.size > 0 ? time : null,
          reason: rows.length === 0 ? 'none' : time.size === 0 ? 'notime' : null,
        },
      });
    });
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, counts: null, time: null, reason: null };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, counts: null, time: null, reason: null };
}

export type PersonServices = {
  loading: boolean;
  /** The days (AD date keys) this person performed services on in the month, one per service. */
  dates: string[];
  /** Any service at all, for anyone, in the month: false means no booking file covers it. */
  monthHasData: boolean;
  /** The month before: how many this person performed, or null when no booking file covers it. */
  previousTotal: number | null;
  /** This person's time with customers in the month, and in the month before: null when none of their services has a time. */
  time: MonthTime | null;
  previousTime: MonthTime | null;
  /** When there is no time to show for the month on screen: nothing imported, or the file had no time column. Null when
   * the month has time for someone (so a null `time` just means this person had none). */
  timeReason: TimeReason;
};

const EMPTY: Omit<PersonServices, 'loading'> = { dates: [], monthHasData: false, previousTotal: null, time: null, previousTime: null, timeReason: null };

/** One person's services for the month `cur` and the month `prev` before it. */
export function usePersonServices(employeeId: string, cur: MonthRange, prev: MonthRange, enabled = true): PersonServices {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonServices, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const monthCount = async (r: MonthRange, timed = false) => {
      let q = supabase.from('service_records').select('id', { count: 'exact', head: true }).gte('performed_on', r.start).lte('performed_on', r.end);
      if (timed) q = q.not('minutes', 'is', null);
      const { count } = await q;
      return count ?? 0;
    };
    Promise.all([
      fetchAll<{ performed_on: string; minutes: number | null }>((a, b) =>
        supabase
          .from('service_records')
          .select('performed_on, minutes')
          .eq('employee_id', employeeId)
          .gte('performed_on', prev.start)
          .lte('performed_on', cur.end)
          .order('id', { ascending: true })
          .range(a, b)
      ),
      monthCount(cur),
      monthCount(prev),
      monthCount(cur, true),
    ]).then(([rows, curCount, prevCount, curTimed]) => {
      if (!live) return;
      const dates = rows.map(r => r.performed_on);
      setDone({
        key,
        value: {
          dates: dates.filter(d => d >= cur.start && d <= cur.end),
          monthHasData: curCount > 0,
          previousTotal: prevCount > 0 ? dates.filter(d => d >= prev.start && d <= prev.end).length : null,
          time: monthTime(rows, cur.start, cur.end),
          previousTime: monthTime(rows, prev.start, prev.end),
          timeReason: curCount === 0 ? 'none' : curTimed === 0 ? 'notime' : null,
        },
      });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, ...EMPTY };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, ...EMPTY };
}
