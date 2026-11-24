'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked, loadProblem } from './kpiLoad';
import { addDays } from './taskSchedule';
import type { CustomerVisit } from './rebookingKpi';
import { rebookingGuests, type GuestLine, type ServiceRow } from './reportKpi';

// What a report reads when its card is opened (components/kpi/KpiReports.tsx). Each hook reads nothing until `enabled`, and says
// "loading" until its rows for exactly the person and days asked for have arrived. An employee reads only their own rows (the
// services), or goes through the functions that hand over just what is needed and never who (the guests' later visits).

type Failure = { code?: string; message?: string } | null;

/** One person's services between two days, with what was done and how long it took. */
export function useReportServices(employeeId: string, start: string, end: string, enabled: boolean): { loading: boolean; rows: ServiceRow[]; error: string } {
  const key = `${employeeId}|${start}|${end}`;
  const [done, setDone] = useState<{ key: string; rows: ServiceRow[]; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<ServiceRow>(
      (a, b) =>
        supabase
          .from('service_records')
          .select('performed_on, service, minutes')
          .eq('employee_id', employeeId)
          .gte('performed_on', start)
          .lte('performed_on', end)
          .order('performed_on', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      'the services data',
      MIGRATION.services
    ).then(({ rows, error }) => {
      if (live) setDone({ key, rows, error });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, rows: [], error: '' };
  return done && done.key === key ? { loading: false, rows: done.rows, error: done.error } : { loading: true, rows: [], error: '' };
}

const KEYS_PER_REQUEST = 100;

/**
 * The guests one person served in the month and whether each came back. An admin reads the customers' visits from the table
 * (in chunks of codes); an employee (`mine`) asks my_customer_visits(), which hands over the visits of the customers they served,
 * with whether each was theirs and never who did the others.
 */
export function useReportRebooking(p: { employeeId: string; start: string; end: string; windowDays: number; today: string; mine: boolean; enabled: boolean }): { loading: boolean; guests: GuestLine[]; error: string } {
  const { employeeId, start, end, windowDays, today, mine, enabled } = p;
  const key = `${employeeId}|${start}|${end}|${windowDays}|${today}|${mine}`;
  const [done, setDone] = useState<{ key: string; guests: GuestLine[]; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      let visits: CustomerVisit[] = [];
      let error = '';
      if (mine) {
        const { data, error: rpcError } = await supabase.rpc('my_customer_visits', { p_from: start, p_served_to: end, p_to: addDays(end, windowDays) });
        if (rpcError) error = loadProblem('the services data', rpcError as Failure, MIGRATION.mine);
        else {
          visits = ((data as { customer_key: string; performed_on: string; mine: boolean }[] | null) ?? []).map(v => ({ employee_id: v.mine ? employeeId : 'someone-else', customer_key: v.customer_key, performed_on: v.performed_on }));
        }
      } else {
        const own = await fetchAllChecked<{ customer_key: string }>(
          (a, b) =>
            supabase
              .from('service_records')
              .select('customer_key')
              .eq('employee_id', employeeId)
              .not('customer_key', 'is', null)
              .gte('performed_on', start)
              .lte('performed_on', end)
              .order('id', { ascending: true })
              .range(a, b),
          'the services data',
          MIGRATION.services
        );
        error = own.error;
        const codes = [...new Set(own.rows.map(r => r.customer_key).filter(Boolean))];
        for (let i = 0; i < codes.length && !error; i += KEYS_PER_REQUEST) {
          const chunk = codes.slice(i, i + KEYS_PER_REQUEST);
          const got = await fetchAllChecked<CustomerVisit>(
            (a, b) =>
              supabase
                .from('service_records')
                .select('employee_id, customer_key, performed_on')
                .in('customer_key', chunk)
                .gte('performed_on', start)
                .lte('performed_on', addDays(end, windowDays))
                .order('id', { ascending: true })
                .range(a, b),
            'the services data',
            MIGRATION.services
          );
          visits.push(...got.rows);
          error = got.error;
        }
      }
      if (live) setDone({ key, guests: error ? [] : rebookingGuests(visits, employeeId, start, end, windowDays, today), error });
    })();
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, guests: [], error: '' };
  return done && done.key === key ? { loading: false, guests: done.guests, error: done.error } : { loading: true, guests: [], error: '' };
}
