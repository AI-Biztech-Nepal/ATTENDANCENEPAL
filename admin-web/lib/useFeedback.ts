'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked, loadProblem } from './kpiLoad';
import { newestFirst, type Colleague, type FeedbackItem, type FeedbackRelation, type GivenFeedback } from './colleagueFeedback';

// Reading colleague feedback for the two places it is shown: a person's own page on the employee portal (through functions that
// say what kind of colleague gave it and never who), and an admin's Colleague reviews tab (read from the table, which only
// admin and HR can read). Plus the colleagues to pick from and what you already gave this month, for the form.

const WHAT = 'the colleague feedback';

type Failure = { code?: string; message?: string } | null;

/** The colleagues feedback can be given to, and what the signed-in person already gave this month. */
export function useFeedbackGiving() {
  const [state, setState] = useState<{ colleagues: Colleague[]; given: GivenFeedback[]; error: string; loading: boolean }>({ colleagues: [], given: [], error: '', loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([supabase.rpc('feedback_colleagues'), supabase.rpc('feedback_i_gave')]).then(([cols, mine]) => {
      if (!live) return;
      const failed = (cols.error ?? mine.error) as Failure;
      setState({
        colleagues: failed ? [] : ((cols.data as Colleague[] | null) ?? []),
        given: failed ? [] : ((mine.data as GivenFeedback[] | null) ?? []),
        error: failed ? loadProblem(WHAT, failed, MIGRATION.reviews) : '',
        loading: false,
      });
    });
    return () => {
      live = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { ...state, reload };
}

export type FeedbackRead = { loading: boolean; items: FeedbackItem[]; error: string };

const toItem = (r: { id: string; relation: FeedbackRelation; rating: number; comment: string | null; given_on: string }): FeedbackItem => ({ id: r.id, relation: r.relation, rating: r.rating, comment: r.comment, given_on: r.given_on });

/** The feedback given to ONE person between two days, read from the table (admin / HR only). */
export function useFeedbackAbout(employeeId: string, start: string, end: string, enabled = true, refresh = 0): FeedbackRead {
  const key = `${employeeId}|${start}|${end}|${refresh}`;
  const [done, setDone] = useState<{ key: string; items: FeedbackItem[]; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<FeedbackItem>(
      (a, b) =>
        supabase
          .from('colleague_feedback')
          .select('id, relation, rating, comment, given_on')
          .eq('subject_id', employeeId)
          .gte('given_on', start)
          .lte('given_on', end)
          .order('given_on', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b),
      WHAT,
      MIGRATION.reviews
    ).then(({ rows, error }) => {
      if (live) setDone({ key, items: newestFirst(rows.map(toItem)), error });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, items: [], error: '' };
  return done && done.key === key ? { loading: false, items: done.items, error: done.error } : { loading: true, items: [], error: '' };
}

/** The feedback given to the signed-in person between two days (my_feedback_received()): the kind of colleague, never who. */
export function useMyFeedback(start: string, end: string, refresh = 0): FeedbackRead {
  const key = `${start}|${end}|${refresh}`;
  const [done, setDone] = useState<{ key: string; items: FeedbackItem[]; error: string } | null>(null);

  useEffect(() => {
    let live = true;
    supabase.rpc('my_feedback_received', { p_from: start, p_to: end }).then(({ data, error }) => {
      if (!live) return;
      setDone({ key, items: error ? [] : newestFirst(((data as FeedbackItem[] | null) ?? []).map(toItem)), error: error ? loadProblem(WHAT, error as Failure, MIGRATION.reviews) : '' });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return done && done.key === key ? { loading: false, items: done.items, error: done.error } : { loading: true, items: [], error: '' };
}

/** A customer form as the person it is about sees it: read only. */
export type MyCustomerForm = { id: string; given_on: string; reference: string | null; rating: number | null; recommend: number | null; comment: string | null };

/** The customer forms typed in about the signed-in person between two days. They can only read them: typing in and editing are
 * for admin and HR. `employeeId` is asked for explicitly, because HR can read every form and this page must only show their own. */
export function useMyCustomerForms(employeeId: string | null, start: string, end: string, refresh = 0): { loading: boolean; forms: MyCustomerForm[]; error: string } {
  const key = `${employeeId}|${start}|${end}|${refresh}`;
  const [done, setDone] = useState<{ key: string; forms: MyCustomerForm[]; error: string } | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    let live = true;
    fetchAllChecked<MyCustomerForm>(
      (a, b) =>
        supabase
          .from('customer_feedback')
          .select('id, given_on, reference, rating, recommend, comment')
          .eq('employee_id', employeeId)
          .gte('given_on', start)
          .lte('given_on', end)
          .order('given_on', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b),
      'the customer forms',
      MIGRATION.forms
    ).then(({ rows, error }) => {
      if (live) setDone({ key, forms: rows, error });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!employeeId) return { loading: false, forms: [], error: '' };
  return done && done.key === key ? { loading: false, forms: done.forms, error: done.error } : { loading: true, forms: [], error: '' };
}
