'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked } from './kpiLoad';
import { addDays } from './taskSchedule';
import { computeRebooking, type CustomerVisit, type Rebooking } from './rebookingKpi';
import type { MonthRange } from './useServiceKpi';

/** Why there is nothing to work out for a month: 'none' = no booking file covers it, 'nocodes' = the file that does
 * had no customer code, so nobody can be told apart. */
export type RebookingReason = 'none' | 'nocodes' | null;

async function countServices(start: string, end: string, coded: boolean): Promise<number> {
  let q = supabase.from('service_records').select('id', { count: 'exact', head: true }).gte('performed_on', start).lte('performed_on', end);
  if (coded) q = q.not('customer_key', 'is', null);
  const { count } = await q;
  return count ?? 0;
}

/** Called when a month has no customers to count: was nothing imported, or was it imported without customer codes? */
async function whyEmpty(start: string, end: string): Promise<RebookingReason> {
  if ((await countServices(start, end, true)) > 0) return null;
  return (await countServices(start, end, false)) > 0 ? 'nocodes' : 'none';
}

/** The columns a visit needs, for customers who have a code. */
const VISIT_COLUMNS = 'employee_id, customer_key, performed_on';
const WHAT = 'the services data';

/**
 * Everyone's rebooking for the month `start`..`end`: of the customers each person served, how many booked again within
 * `windowDays`. The rows run `windowDays` past the month, because a customer served on its last day can come back after
 * it. `enabled` holds the work back (until the settings that give `windowDays` are read, or when the KPI is off).
 * `error` is set when the services could not be read, which is not the same as "no data".
 */
export function useRebooking(start: string, end: string, windowDays: number, enabled: boolean): { loading: boolean; byEmployee: Map<string, Rebooking> | null; reason: RebookingReason; error: string } {
  const key = `${start}|${end}|${windowDays}`;
  const [done, setDone] = useState<{ key: string; byEmployee: Map<string, Rebooking> | null; reason: RebookingReason; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const { rows: visits, error } = await fetchAllChecked<CustomerVisit>(
        (a, b) =>
          supabase
            .from('service_records')
            .select(VISIT_COLUMNS)
            .not('customer_key', 'is', null)
            .gte('performed_on', start)
            .lte('performed_on', addDays(end, windowDays))
            .order('id', { ascending: true })
            .range(a, b),
        WHAT,
        MIGRATION.services
      );
      const byEmployee = computeRebooking(visits, start, end, windowDays);
      const reason = byEmployee.size > 0 || error ? null : await whyEmpty(start, end);
      if (live) setDone({ key, byEmployee: byEmployee.size > 0 ? byEmployee : null, reason, error });
    })();
    return () => {
      live = false;
    };
    // `key` carries start, end and windowDays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return enabled && done && done.key === key ? { loading: false, byEmployee: done.byEmployee, reason: done.reason, error: done.error } : { loading: enabled, byEmployee: null, reason: null, error: '' };
}

export type PersonRebooking = {
  loading: boolean;
  /** The month on screen, or null when this person served no customers in it. */
  current: Rebooking | null;
  /** The month before, or null when this person served no customers then. */
  previous: Rebooking | null;
  /** Set when the month on screen has nothing to count for anyone. */
  reason: RebookingReason;
  /** Set when the services could not be read: not the same as "no data". */
  error: string;
};

const KEYS_PER_REQUEST = 100;

/**
 * One person's rebooking for the month `cur` and the month `prev` before it. Only this person's customers are looked up:
 * first the customer codes of their own services, then every visit by those customers (to anyone) in the two months
 * and the `windowDays` after.
 */
export function usePersonRebooking(employeeId: string, cur: MonthRange, prev: MonthRange, windowDays: number, enabled: boolean): PersonRebooking {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}|${windowDays}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonRebooking, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const own = await fetchAllChecked<{ customer_key: string }>(
        (a, b) =>
          supabase
            .from('service_records')
            .select('customer_key')
            .eq('employee_id', employeeId)
            .not('customer_key', 'is', null)
            .gte('performed_on', prev.start)
            .lte('performed_on', cur.end)
            .order('id', { ascending: true })
            .range(a, b),
        WHAT,
        MIGRATION.services
      );
      let error = own.error;
      const codes = [...new Set(own.rows.map(r => r.customer_key).filter(Boolean))];
      const visits: CustomerVisit[] = [];
      for (let i = 0; i < codes.length && !error; i += KEYS_PER_REQUEST) {
        const chunk = codes.slice(i, i + KEYS_PER_REQUEST);
        const got = await fetchAllChecked<CustomerVisit>(
          (a, b) =>
            supabase
              .from('service_records')
              .select(VISIT_COLUMNS)
              .in('customer_key', chunk)
              .gte('performed_on', prev.start)
              .lte('performed_on', addDays(cur.end, windowDays))
              .order('id', { ascending: true })
              .range(a, b),
          WHAT,
          MIGRATION.services
        );
        visits.push(...got.rows);
        error = got.error;
      }
      const current = computeRebooking(visits, cur.start, cur.end, windowDays).get(employeeId) ?? null;
      const previous = computeRebooking(visits, prev.start, prev.end, windowDays).get(employeeId) ?? null;
      // Nothing to show for this person: is it because the month has nothing for anyone?
      const reason = current || error ? null : await whyEmpty(cur.start, cur.end);
      if (live) setDone({ key, value: { current, previous, reason, error } });
    })();
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return enabled && done && done.key === key ? { loading: false, ...done.value } : { loading: enabled, current: null, previous: null, reason: null, error: '' };
}
