'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, loadProblem } from './kpiLoad';
import { addDays } from './taskSchedule';
import { computeRebooking, type CustomerVisit } from './rebookingKpi';
import { summariseFeedback, type Roles } from './colleagueKpi';
import type { FeedbackRelation } from './colleagueFeedback';
import type { PersonRebooking } from './useRebookingKpi';
import type { PersonColleagues } from './useColleagueKpi';
import type { MonthRange } from './useServiceKpi';

// The pieces of the employee's own KPI page (/my-kpis) that cannot be read the way an admin reads them. An employee reads only
// their own rows, so the numbers that need other people's rows come through functions that hand over just what is needed
// and never who: rebooking (a customer's later visit to ANYONE). Colleague feedback comes through my_feedback_received().

/** The signed-in person's employee id: undefined while it is being read, null when the account is not linked to an employee. */
export function useMyEmployeeId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from('profiles').select('employee_id').eq('id', auth.user.id).single();
      if (live) setId((data?.employee_id as string | null) ?? null);
    })();
    return () => {
      live = false;
    };
  }, []);
  return id;
}

type Failure = { code?: string; message?: string } | null;

/**
 * The signed-in person's rebooking for the month `cur` and the month `prev` before it: of the customers they served, how many
 * came back to anyone within `windowDays`. The visits come from my_customer_visits(), which gives the visits of the customers
 * this person served, with whether each was theirs (never who did the others), and the same counting rule as the admin's page.
 */
export function useMyRebooking(employeeId: string | null | undefined, cur: MonthRange, prev: MonthRange, windowDays: number, enabled: boolean): PersonRebooking {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}|${windowDays}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonRebooking, 'loading'> } | null>(null);
  const on = enabled && !!employeeId;

  useEffect(() => {
    if (!on || !employeeId) return;
    let live = true;
    supabase.rpc('my_customer_visits', { p_from: prev.start, p_served_to: cur.end, p_to: addDays(cur.end, windowDays) }).then(({ data, error }) => {
      if (!live) return;
      if (error) {
        setDone({ key, value: { current: null, previous: null, reason: null, error: loadProblem('the services data', error as Failure, MIGRATION.mine) } });
        return;
      }
      // Someone else's visit only needs to be "not mine": it counts as a return, whoever performed it.
      const visits: CustomerVisit[] = ((data as { customer_key: string; performed_on: string; mine: boolean }[] | null) ?? []).map(v => ({
        employee_id: v.mine ? employeeId : 'someone-else',
        customer_key: v.customer_key,
        performed_on: v.performed_on,
      }));
      setDone({
        key,
        value: {
          current: computeRebooking(visits, cur.start, cur.end, windowDays).get(employeeId) ?? null,
          previous: computeRebooking(visits, prev.start, prev.end, windowDays).get(employeeId) ?? null,
          reason: null,
          error: '',
        },
      });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);

  if (!on) return { loading: enabled && employeeId === undefined, current: null, previous: null, reason: null, error: '' };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, current: null, previous: null, reason: null, error: '' };
}

/**
 * The signed-in person's colleague feedback for the month `cur` and the month `prev` before it, by the kind of colleague who
 * gave it, read through my_feedback_received() (the KPIs count by the kind of colleague). The same counting as the admin's page.
 */
export function useMyColleagues(cur: MonthRange, prev: MonthRange, enabled = true): PersonColleagues {
  const key = `${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonColleagues, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    supabase.rpc('my_feedback_received', { p_from: prev.start, p_to: cur.end }).then(({ data, error }) => {
      if (!live) return;
      if (error) {
        setDone({ key, value: { current: undefined, previous: undefined, error: loadProblem('the colleague feedback', error as Failure, MIGRATION.reviews) } });
        return;
      }
      const rows = (data as { relation: FeedbackRelation; rating: number | null; given_on: string }[] | null) ?? [];
      const rolesIn = (r: MonthRange): Roles | undefined =>
        summariseFeedback(rows.filter(x => x.given_on >= r.start && x.given_on <= r.end).map(x => ({ subject_id: 'me', relation: x.relation, rating: x.rating }))).get('me');
      setDone({ key, value: { current: rolesIn(cur), previous: rolesIn(prev), error: '' } });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, current: undefined, previous: undefined, error: '' };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, current: undefined, previous: undefined, error: '' };
}
