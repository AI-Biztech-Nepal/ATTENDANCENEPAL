'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked, loadProblem } from './kpiLoad';
import { summariseReviews, type ReviewRow, type Roles } from './colleagueKpi';
import type { MonthRange } from './useServiceKpi';

type Round = { id: string; period_start: string; period_end: string };

const WHAT = 'the colleague reviews';

/** Everyone's colleague feedback for the month `start`..`end`: the reviews of the round that covers exactly that month (the
 * round the Colleague reviews section starts for it). `bySubject` is null when the month has no round, or its round asked
 * for no reviews. A round that is still open counts what has been given so far. `error` is set when the reviews could not
 * be read (a table that is not there yet, a refused read): not the same as "no round". `enabled` holds the work back (for
 * a month that has not begun, or when all four KPIs are off). */
export function useColleagueMonth(start: string, end: string, enabled = true): { loading: boolean; bySubject: Map<string, Roles> | null; error: string } {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; bySubject: Map<string, Roles> | null; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const found = await supabase.from('review_rounds').select('id, period_start, period_end').eq('period_start', start).eq('period_end', end).limit(1);
      if (found.error) {
        if (live) setDone({ key, bySubject: null, error: loadProblem(WHAT, found.error, MIGRATION.reviews) });
        return;
      }
      const round = ((found.data as Round[] | null) ?? [])[0];
      const got = round
        ? await fetchAllChecked<ReviewRow>(
            (a, b) => supabase.from('colleague_reviews').select('subject_id, relation, rating').eq('round_id', round.id).order('id', { ascending: true }).range(a, b),
            WHAT,
            MIGRATION.reviews
          )
        : { rows: [] as ReviewRow[], error: '' };
      if (live) setDone({ key, bySubject: got.rows.length > 0 ? summariseReviews(got.rows) : null, error: got.error });
    })();
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
  /** The month on screen has a round of reviews. */
  roundExists: boolean;
  /** This person's four roles in that round, or undefined when nobody was asked about them. */
  current: Roles | undefined;
  /** The same for the month before (undefined when there was no round or nobody was asked). */
  previous: Roles | undefined;
  /** Set when the reviews could not be read: not the same as "no round". */
  error: string;
};

const NONE: Omit<PersonColleagues, 'loading'> = { roundExists: false, current: undefined, previous: undefined, error: '' };

/** One person's colleague feedback for the month `cur` and the month `prev` before it. */
export function usePersonColleagues(employeeId: string, cur: MonthRange, prev: MonthRange, enabled = true): PersonColleagues {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonColleagues, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const found = await supabase.from('review_rounds').select('id, period_start, period_end').in('period_start', [cur.start, prev.start]);
      if (found.error) {
        if (live) setDone({ key, value: { ...NONE, error: loadProblem(WHAT, found.error, MIGRATION.reviews) } });
        return;
      }
      const rounds = (found.data as Round[] | null) ?? [];
      const curRound = rounds.find(r => r.period_start === cur.start && r.period_end === cur.end);
      const prevRound = rounds.find(r => r.period_start === prev.start && r.period_end === prev.end);
      const ids = [curRound?.id, prevRound?.id].filter((x): x is string => !!x);
      const got = ids.length
        ? await fetchAllChecked<ReviewRow & { round_id: string }>(
            (a, b) => supabase.from('colleague_reviews').select('round_id, subject_id, relation, rating').eq('subject_id', employeeId).in('round_id', ids).order('id', { ascending: true }).range(a, b),
            WHAT,
            MIGRATION.reviews
          )
        : { rows: [] as (ReviewRow & { round_id: string })[], error: '' };
      const rolesOf = (round: Round | undefined) => (round ? summariseReviews(got.rows.filter(r => r.round_id === round.id)).get(employeeId) : undefined);
      if (live) setDone({ key, value: { roundExists: !!curRound, current: rolesOf(curRound), previous: rolesOf(prevRound), error: got.error } });
    })();
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, ...NONE };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, ...NONE };
}
