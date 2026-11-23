'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import { summariseReviews, type ReviewRow, type Roles } from './colleagueKpi';
import type { MonthRange } from './useServiceKpi';

type Round = { id: string; period_start: string; period_end: string };

/** Everyone's colleague feedback for the month `start`..`end`: the reviews of the round that covers exactly that month (the
 * round the Colleague reviews section starts for it). `bySubject` is null when the month has no round, or its round asked
 * for no reviews. A round that is still open counts what has been given so far. `enabled` holds the work back (for a month
 * that has not begun, or when all four KPIs are off). */
export function useColleagueMonth(start: string, end: string, enabled = true): { loading: boolean; bySubject: Map<string, Roles> | null } {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; bySubject: Map<string, Roles> | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      // A table that is not there yet (before the reviews migration) gives no round, which reads as "no reviews yet".
      const { data } = await supabase.from('review_rounds').select('id, period_start, period_end').eq('period_start', start).eq('period_end', end).limit(1);
      const round = ((data as Round[] | null) ?? [])[0];
      const rows = round
        ? await fetchAll<ReviewRow>((a, b) => supabase.from('colleague_reviews').select('subject_id, relation, rating').eq('round_id', round.id).order('id', { ascending: true }).range(a, b))
        : [];
      if (live) setDone({ key, bySubject: rows.length > 0 ? summariseReviews(rows) : null });
    })();
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, bySubject: null };
  return done && done.key === key ? { loading: false, bySubject: done.bySubject } : { loading: true, bySubject: null };
}

export type PersonColleagues = {
  loading: boolean;
  /** The month on screen has a round of reviews. */
  roundExists: boolean;
  /** This person's four roles in that round, or undefined when nobody was asked about them. */
  current: Roles | undefined;
  /** The same for the month before (undefined when there was no round or nobody was asked). */
  previous: Roles | undefined;
};

/** One person's colleague feedback for the month `cur` and the month `prev` before it. */
export function usePersonColleagues(employeeId: string, cur: MonthRange, prev: MonthRange, enabled = true): PersonColleagues {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonColleagues, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from('review_rounds').select('id, period_start, period_end').in('period_start', [cur.start, prev.start]);
      const rounds = (data as Round[] | null) ?? [];
      const curRound = rounds.find(r => r.period_start === cur.start && r.period_end === cur.end);
      const prevRound = rounds.find(r => r.period_start === prev.start && r.period_end === prev.end);
      const ids = [curRound?.id, prevRound?.id].filter((x): x is string => !!x);
      const rows = ids.length
        ? await fetchAll<ReviewRow & { round_id: string }>((a, b) =>
            supabase.from('colleague_reviews').select('round_id, subject_id, relation, rating').eq('subject_id', employeeId).in('round_id', ids).order('id', { ascending: true }).range(a, b)
          )
        : [];
      const rolesOf = (round: Round | undefined) => (round ? summariseReviews(rows.filter(r => r.round_id === round.id)).get(employeeId) : undefined);
      if (live) setDone({ key, value: { roundExists: !!curRound, current: rolesOf(curRound), previous: rolesOf(prevRound) } });
    })();
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, roundExists: false, current: undefined, previous: undefined };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, roundExists: false, current: undefined, previous: undefined };
}
