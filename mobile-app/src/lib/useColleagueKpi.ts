// Ported from admin-web/lib/useColleagueKpi.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked } from './kpiLoad';
import { summariseFeedback, type FeedbackRow, type Roles } from './colleagueKpi';
import type { FeedbackRelation } from './colleagueFeedback';
import type { MonthRange } from './useServiceKpi';

const WHAT = 'the colleague feedback';

/** Everyone's colleague feedback for the month `start`..`end`: the feedback colleagues gave on the days of that month, by the
 * kind of colleague who gave it. `bySubject` is null when nobody was given any. `error` is set when the feedback could not
 * be read (a table that is not there yet, a refused read): not the same as "no feedback". `enabled` holds the work back
 * (for a month that has not begun, or when all four KPIs are off). */
export function useColleagueMonth(start: string, end: string, enabled = true): { loading: boolean; bySubject: Map<string, Roles> | null; error: string } {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; bySubject: Map<string, Roles> | null; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<FeedbackRow>(
      (a, b) => supabase.from('colleague_feedback').select('subject_id, relation, rating').gte('given_on', start).lte('given_on', end).order('id', { ascending: true }).range(a, b),
      WHAT,
      MIGRATION.reviews
    ).then(({ rows, error }) => {
      if (!live) return;
      setDone({ key, bySubject: rows.length > 0 ? summariseFeedback(rows) : null, error });
    });
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, bySubject: null, error: '' };
  return done && done.key === key ? { loading: false, bySubject: done.bySubject, error: done.error } : { loading: true, bySubject: null, error: '' };
}

export type PersonColleagues = {
  loading: boolean;
  /** This person's four kinds in the month on screen, or undefined when nobody gave them feedback. */
  current: Roles | undefined;
  /** The same for the month before. */
  previous: Roles | undefined;
  /** Set when the feedback could not be read: not the same as "none given". */
  error: string;
};

const NONE: Omit<PersonColleagues, 'loading'> = { current: undefined, previous: undefined, error: '' };

/** One person's colleague feedback for the month `cur` and the month `prev` before it. */
export function usePersonColleagues(employeeId: string, cur: MonthRange, prev: MonthRange, enabled = true): PersonColleagues {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonColleagues, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<{ relation: FeedbackRelation; rating: number | null; given_on: string }>(
      (a, b) =>
        supabase
          .from('colleague_feedback')
          .select('relation, rating, given_on')
          .eq('subject_id', employeeId)
          .gte('given_on', prev.start)
          .lte('given_on', cur.end)
          .order('id', { ascending: true })
          .range(a, b),
      WHAT,
      MIGRATION.reviews
    ).then(({ rows, error }) => {
      if (!live) return;
      const rolesIn = (r: MonthRange) => summariseFeedback(rows.filter(x => x.given_on >= r.start && x.given_on <= r.end).map(x => ({ subject_id: employeeId, relation: x.relation, rating: x.rating }))).get(employeeId);
      setDone({ key, value: { current: rolesIn(cur), previous: rolesIn(prev), error } });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, ...NONE };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, ...NONE };
}
