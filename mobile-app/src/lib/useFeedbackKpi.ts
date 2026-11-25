// Ported from admin-web/lib/useFeedbackKpi.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked } from './kpiLoad';
import { summariseFeedback, summariseRatings, type FeedbackSummary } from './feedbackKpi';
import { summariseNps, summariseNpsByEmployee, type NpsSummary } from './npsKpi';
import type { MonthRange } from './useServiceKpi';

/** A typed-in form, as far as the two KPIs from it go: the service rating (customer feedback) and the would-recommend
 * number (NPS). Either can be empty. */
type Form = { employee_id: string; rating: number | null; recommend: number | null };

const WHAT = 'the customer forms';

export type FeedbackMonth = {
  loading: boolean;
  /** Customer feedback per person, from the forms with a rating. Null when no form has a rating. */
  byEmployee: Map<string, FeedbackSummary> | null;
  /** NPS per person, from the forms with a recommend number. Null when no form has one. */
  nps: Map<string, NpsSummary> | null;
  /** Set when the forms could not be read (a table that is not there yet, a refused read): not the same as "no forms". */
  error: string;
};

/** Everyone's customer feedback and NPS for the month `start`..`end`, read from the forms typed in, in one request.
 * `enabled` holds the work back (for a month that has not begun, or when both KPIs are off). */
export function useFeedbackMonth(start: string, end: string, enabled = true): FeedbackMonth {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; byEmployee: FeedbackMonth['byEmployee']; nps: FeedbackMonth['nps']; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<Form>(
      (a, b) => supabase.from('customer_feedback').select('employee_id, rating, recommend').gte('given_on', start).lte('given_on', end).order('id', { ascending: true }).range(a, b),
      WHAT,
      MIGRATION.forms
    ).then(({ rows, error }) => {
      if (!live) return;
      const feedback = summariseFeedback(rows);
      const nps = summariseNpsByEmployee(rows);
      setDone({ key, byEmployee: feedback.size > 0 ? feedback : null, nps: nps.size > 0 ? nps : null, error });
    });
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, byEmployee: null, nps: null, error: '' };
  return done && done.key === key ? { loading: false, byEmployee: done.byEmployee, nps: done.nps, error: done.error } : { loading: true, byEmployee: null, nps: null, error: '' };
}

export type PersonFeedback = {
  loading: boolean;
  /** This person's customer feedback in the month on screen and in the month before: null when none of their forms has a rating. */
  current: FeedbackSummary | null;
  previous: FeedbackSummary | null;
  /** The same for NPS, from the recommend numbers. */
  nps: NpsSummary | null;
  npsPrevious: NpsSummary | null;
  /** Any form with a rating (any with a recommend number), for anyone, in the month on screen: false means nothing like it
   * has been typed in for the month. */
  monthHasForms: boolean;
  monthHasNps: boolean;
  /** Set when the forms could not be read: not the same as "no forms". */
  error: string;
};

const EMPTY: Omit<PersonFeedback, 'loading'> = { current: null, previous: null, nps: null, npsPrevious: null, monthHasForms: false, monthHasNps: false, error: '' };

/** One person's customer feedback and NPS for the month `cur` and the month `prev` before it. */
export function usePersonFeedback(employeeId: string, cur: MonthRange, prev: MonthRange, enabled = true): PersonFeedback {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonFeedback, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const monthCount = (column: 'rating' | 'recommend') =>
      supabase.from('customer_feedback').select('id', { count: 'exact', head: true }).not(column, 'is', null).gte('given_on', cur.start).lte('given_on', cur.end);
    Promise.all([
      fetchAllChecked<{ given_on: string; rating: number | null; recommend: number | null }>(
        (a, b) =>
          supabase
            .from('customer_feedback')
            .select('given_on, rating, recommend')
            .eq('employee_id', employeeId)
            .gte('given_on', prev.start)
            .lte('given_on', cur.end)
            .order('id', { ascending: true })
            .range(a, b),
        WHAT,
        MIGRATION.forms
      ),
      monthCount('rating'),
      monthCount('recommend'),
    ]).then(([{ rows, error }, rated, recommended]) => {
      if (!live) return;
      const inMonth = (r: MonthRange) => rows.filter(x => x.given_on >= r.start && x.given_on <= r.end);
      setDone({
        key,
        value: {
          current: summariseRatings(inMonth(cur).map(x => x.rating)),
          previous: summariseRatings(inMonth(prev).map(x => x.rating)),
          nps: summariseNps(inMonth(cur).map(x => x.recommend)),
          npsPrevious: summariseNps(inMonth(prev).map(x => x.recommend)),
          monthHasForms: (rated.count ?? 0) > 0,
          monthHasNps: (recommended.count ?? 0) > 0,
          error,
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
