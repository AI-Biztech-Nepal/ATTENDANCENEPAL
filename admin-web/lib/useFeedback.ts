'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, fetchAllChecked, isMissingTable, loadProblem } from './kpiLoad';
import { newestFirst, type Colleague, type FeedbackItem, type FeedbackRelation, type GivenFeedback } from './colleagueFeedback';

// Reading colleague feedback for the two places it is shown: a person's own page on the employee portal (through
// my_feedback_received()), and an admin's Colleague reviews tab (read from the table, which only admin and HR can read). Both
// then read who gave each piece (colleague_feedback_givers()). Plus the colleagues to pick from and what you already gave this
// month, for the form; and the customer forms about a person, with each guest's name.

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

/** `namesError` says why the names could not be read; the feedback is still shown without them. */
/**
 * Removes a piece of colleague feedback for good (remove_colleague_feedback()): the giver takes their own back, or an admin / HR
 * removes anyone's except feedback about themselves. Returns '' when it was removed, or what went wrong.
 */
export async function removeFeedback(id: string): Promise<string> {
  const { error } = await supabase.rpc('remove_colleague_feedback', { p_id: id });
  if (!error) return '';
  const e = error as Failure;
  return isMissingTable(e) ? `Removing feedback is not set up in the database yet (run ${MIGRATION.remove}).` : `Could not remove it: ${e?.message || 'the database did not say why'}.`;
}

export type FeedbackRead = { loading: boolean; items: FeedbackItem[]; error: string; namesError: string };

type ItemRow = { id: string; relation: FeedbackRelation; rating: number; comment: string | null; given_on: string };
const toItem = (r: ItemRow, names: Map<string, string>): FeedbackItem => ({ id: r.id, relation: r.relation, rating: r.rating, comment: r.comment, given_on: r.given_on, giver_name: names.get(r.id) ?? null });

/**
 * The names that go with some rows: who gave each piece of colleague feedback, or each customer form's guest. Read through a
 * function that hands over only the name, and only for rows the signed-in person may see (admin / HR of the company, or the
 * person the rows are about). A failed read leaves the rows without names and says why.
 */
async function readNames(fn: 'colleague_feedback_givers' | 'customer_feedback_guest_names', ids: string[]): Promise<{ names: Map<string, string>; error: string }> {
  const names = new Map<string, string>();
  if (ids.length === 0) return { names, error: '' };
  const { data, error } = await supabase.rpc(fn, { p_ids: ids });
  if (error) {
    const e = error as Failure;
    return { names, error: isMissingTable(e) ? `The names are not set up in the database yet (run ${MIGRATION.names}).` : `Could not load the names: ${e?.message || 'the database did not say why'}.` };
  }
  for (const r of (data as { id?: string; feedback_id?: string; giver_name?: string | null; guest_name?: string | null }[] | null) ?? []) {
    const id = r.id ?? r.feedback_id;
    const name = (r.giver_name ?? r.guest_name ?? '').trim();
    if (id && name) names.set(id, name);
  }
  return { names, error: '' };
}

/** The feedback given to ONE person between two days, read from the table (admin / HR only). */
export function useFeedbackAbout(employeeId: string, start: string, end: string, enabled = true, refresh = 0): FeedbackRead {
  const key = `${employeeId}|${start}|${end}|${refresh}`;
  const [done, setDone] = useState<{ key: string; items: FeedbackItem[]; error: string; namesError: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<ItemRow>(
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
    ).then(async ({ rows, error }) => {
      const named = error ? { names: new Map<string, string>(), error: '' } : await readNames('colleague_feedback_givers', rows.map(r => r.id));
      if (live) setDone({ key, items: newestFirst(rows.map(r => toItem(r, named.names))), error, namesError: named.error });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, items: [], error: '', namesError: '' };
  return done && done.key === key ? { loading: false, items: done.items, error: done.error, namesError: done.namesError } : { loading: true, items: [], error: '', namesError: '' };
}

/** The feedback given to the signed-in person between two days (my_feedback_received()), with who gave each piece. */
export function useMyFeedback(start: string, end: string, refresh = 0): FeedbackRead {
  const key = `${start}|${end}|${refresh}`;
  const [done, setDone] = useState<{ key: string; items: FeedbackItem[]; error: string; namesError: string } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc('my_feedback_received', { p_from: start, p_to: end });
      if (error) {
        if (live) setDone({ key, items: [], error: loadProblem(WHAT, error as Failure, MIGRATION.reviews), namesError: '' });
        return;
      }
      const rows = (data as ItemRow[] | null) ?? [];
      const named = await readNames('colleague_feedback_givers', rows.map(r => r.id));
      if (live) setDone({ key, items: newestFirst(rows.map(r => toItem(r, named.names))), error: '', namesError: named.error });
    })();
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return done && done.key === key ? { loading: false, items: done.items, error: done.error, namesError: done.namesError } : { loading: true, items: [], error: '', namesError: '' };
}

/** A customer form as it is read in a report: read only, with the guest's name (never their phone or email). */
export type MyCustomerForm = { id: string; given_on: string; reference: string | null; rating: number | null; recommend: number | null; comment: string | null; guest_name: string | null };

type FormRow = Omit<MyCustomerForm, 'guest_name'>;

/** The customer forms typed in about one person between two days, with each guest's name. The person can only read them: typing
 * in and editing are for admin and HR. `employeeId` is asked for explicitly, because HR can read every form and the employee's
 * own page must only show their own. */
export function useMyCustomerForms(employeeId: string | null, start: string, end: string, refresh = 0): { loading: boolean; forms: MyCustomerForm[]; error: string; namesError: string } {
  const key = `${employeeId}|${start}|${end}|${refresh}`;
  const [done, setDone] = useState<{ key: string; forms: MyCustomerForm[]; error: string; namesError: string } | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    let live = true;
    fetchAllChecked<FormRow>(
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
    ).then(async ({ rows, error }) => {
      const named = error ? { names: new Map<string, string>(), error: '' } : await readNames('customer_feedback_guest_names', rows.map(r => r.id));
      if (live) setDone({ key, forms: rows.map(r => ({ ...r, guest_name: named.names.get(r.id) ?? null })), error, namesError: named.error });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!employeeId) return { loading: false, forms: [], error: '', namesError: '' };
  return done && done.key === key ? { loading: false, forms: done.forms, error: done.error, namesError: done.namesError } : { loading: true, forms: [], error: '', namesError: '' };
}
