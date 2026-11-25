// Ported from admin-web/lib/useKpiReport.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked, loadProblem } from './kpiLoad';
import { NO_END } from './rebookingKpi';
import { rebookingGuests, type GuestLine, type ReportVisit } from './reportKpi';

// What a report reads when its card is opened (components/kpi/KpiReports.tsx). Each hook reads nothing until `enabled`, and says
// "loading" until its rows for exactly the person and days asked for have arrived. An employee reads only their own rows (the
// services), or goes through the functions that hand over just what is needed and never who (the guests' later visits).

type Failure = { code?: string; message?: string } | null;

const KEYS_PER_REQUEST = 100;

/**
 * The guests one person served in the month, by name, and whether each came back on any later day (no time limit). The
 * person's own visits are read from the table (an employee may read their own). For the later visits an admin reads the
 * table (in chunks of keys); an employee (`mine`) asks my_customer_visits(), which hands over the visits of the guests they
 * served, with whether each was theirs and never who did the others.
 */
export function useReportRebooking(p: { employeeId: string; start: string; end: string; mine: boolean; enabled: boolean }): { loading: boolean; guests: GuestLine[]; error: string } {
  const { employeeId, start, end, mine, enabled } = p;
  const key = `${employeeId}|${start}|${end}|${mine}`;
  const [done, setDone] = useState<{ key: string; guests: GuestLine[]; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      let visits: ReportVisit[] = [];
      let error = '';
      // The person's own visits in the month, with the guest's name and the row's id (an employee may read their own rows).
      const own = await fetchAllChecked<ReportVisit>(
        (a, b) =>
          supabase
            .from('service_records')
            .select('id, employee_id, customer_key, customer_name, performed_on')
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
      if (mine && !error) {
        // Every later visit by those guests, to anyone: through my_customer_visits(), which never says who did the others.
        const { data, error: rpcError } = await supabase.rpc('my_customer_visits', { p_from: start, p_served_to: end, p_to: NO_END });
        if (rpcError) error = loadProblem('the services data', rpcError as Failure, MIGRATION.mine);
        else {
          const others = ((data as { customer_key: string; performed_on: string; mine: boolean }[] | null) ?? []).filter(v => !v.mine || v.performed_on > end);
          visits = [...own.rows, ...others.map(v => ({ employee_id: v.mine ? employeeId : 'someone-else', customer_key: v.customer_key, performed_on: v.performed_on }))];
        }
      } else if (!error) {
        // An admin reads every visit by those guests (to anyone) from the month's start, with no end, in chunks of keys. The
        // person's own visits come back in it too, with their names and ids.
        const keys = [...new Set(own.rows.map(r => r.customer_key).filter(Boolean))];
        for (let i = 0; i < keys.length && !error; i += KEYS_PER_REQUEST) {
          const chunk = keys.slice(i, i + KEYS_PER_REQUEST);
          const got = await fetchAllChecked<ReportVisit>(
            (a, b) =>
              supabase
                .from('service_records')
                .select('id, employee_id, customer_key, customer_name, performed_on')
                .in('customer_key', chunk)
                .gte('performed_on', start)
                .order('id', { ascending: true })
                .range(a, b),
            'the services data',
            MIGRATION.services
          );
          visits.push(...got.rows);
          error = got.error;
        }
      }
      if (live) setDone({ key, guests: error ? [] : rebookingGuests(visits, employeeId, start, end), error });
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
