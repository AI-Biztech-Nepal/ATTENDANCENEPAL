'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import { summariseFeedback, summariseRatings, type FeedbackSummary, type RatedForm } from './feedbackKpi';
import type { MonthRange } from './useServiceKpi';

/** Everyone's customer feedback for the month `start`..`end`, from the forms typed in with a rating. `byEmployee` is null
 * when no form has a rating (nothing typed in for the month, for anyone). `enabled` holds the work back (for a month
 * that has not begun, or when the KPI is off). */
export function useFeedbackMonth(start: string, end: string, enabled = true): { loading: boolean; byEmployee: Map<string, FeedbackSummary> | null } {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; byEmployee: Map<string, FeedbackSummary> | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A table that is not there yet (before the feedback migration) gives no rows, which reads as "no forms yet".
    fetchAll<RatedForm>((a, b) =>
      supabase.from('customer_feedback').select('employee_id, rating').not('rating', 'is', null).gte('given_on', start).lte('given_on', end).order('id', { ascending: true }).range(a, b)
    ).then(rows => {
      if (!live) return;
      const byEmployee = summariseFeedback(rows);
      setDone({ key, byEmployee: byEmployee.size > 0 ? byEmployee : null });
    });
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, byEmployee: null };
  return done && done.key === key ? { loading: false, byEmployee: done.byEmployee } : { loading: true, byEmployee: null };
}

export type PersonFeedback = {
  loading: boolean;
  /** This person's forms in the month on screen and in the month before: null when none of them has a rating. */
  current: FeedbackSummary | null;
  previous: FeedbackSummary | null;
  /** Any rated form at all, for anyone, in the month on screen: false means nothing has been typed in for it. */
  monthHasForms: boolean;
};

/** One person's customer feedback for the month `cur` and the month `prev` before it. */
export function usePersonFeedback(employeeId: string, cur: MonthRange, prev: MonthRange, enabled = true): PersonFeedback {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonFeedback, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.all([
      fetchAll<{ given_on: string; rating: number | null }>((a, b) =>
        supabase
          .from('customer_feedback')
          .select('given_on, rating')
          .eq('employee_id', employeeId)
          .not('rating', 'is', null)
          .gte('given_on', prev.start)
          .lte('given_on', cur.end)
          .order('id', { ascending: true })
          .range(a, b)
      ),
      supabase.from('customer_feedback').select('id', { count: 'exact', head: true }).not('rating', 'is', null).gte('given_on', cur.start).lte('given_on', cur.end),
    ]).then(([rows, all]) => {
      if (!live) return;
      const inMonth = (r: MonthRange) => rows.filter(x => x.given_on >= r.start && x.given_on <= r.end).map(x => x.rating);
      setDone({ key, value: { current: summariseRatings(inMonth(cur)), previous: summariseRatings(inMonth(prev)), monthHasForms: (all.count ?? 0) > 0 } });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, current: null, previous: null, monthHasForms: false };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, current: null, previous: null, monthHasForms: false };
}
