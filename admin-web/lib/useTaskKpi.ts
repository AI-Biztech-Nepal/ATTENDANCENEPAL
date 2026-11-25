'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchAllChecked } from './kpiLoad';
import { nepalTodayIso } from './shift';
import { TASK_COLUMNS, countTasks, doneDates, type KpiTask, type TaskCount } from './taskKpi';
import type { MonthRange } from './useServiceKpi';

// Reading the tasks for the services KPIs (number of services performed, hour utilisation per day): a task is a service. An admin
// or HR reads everyone's tasks; an employee reads their own (the same rows the My Tasks page reads).

const WHAT = 'the tasks';

export type TaskMonth = {
  loading: boolean;
  /** Each person's tasks in the month (due so far, and done). Null when nobody has a task in the month, so the list shows
   * dashes, not zeros. */
  byEmployee: Map<string, TaskCount> | null;
  /** Set when the tasks could not be read: not the same as "no tasks". */
  error: string;
};

/** Everyone's tasks in the month `start`..`end`. `enabled` holds the work back (for a month that has not begun). */
export function useTaskMonth(start: string, end: string, enabled = true): TaskMonth {
  const key = `${start}|${end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<TaskMonth, 'loading'> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<KpiTask>(
      (a, b) => supabase.from('tasks').select(TASK_COLUMNS).gte('due_date', start).lte('due_date', end).order('id', { ascending: true }).range(a, b),
      WHAT
    ).then(({ rows, error }) => {
      if (!live) return;
      const byEmployee = countTasks(rows, start, end, Date.now(), nepalTodayIso());
      setDone({ key, value: { byEmployee: byEmployee.size > 0 ? byEmployee : null, error } });
    });
    return () => {
      live = false;
    };
    // `key` carries start and end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, byEmployee: null, error: '' };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, byEmployee: null, error: '' };
}

export type PersonTasks = {
  loading: boolean;
  /** The days (AD date keys) of the tasks this person completed in the month, one per task. */
  dates: string[];
  /** This person has a task in the month (done, due or still to come): false means there is nothing to count. */
  monthHasData: boolean;
  /** The month on screen and the one before: tasks due so far and done. Null when the person had no task due in it. */
  current: TaskCount | null;
  previous: TaskCount | null;
  /** How many tasks they completed the month before, or null when they had none in it. */
  previousTotal: number | null;
  /** Set when the tasks could not be read: not the same as "no tasks". */
  error: string;
};

const EMPTY: Omit<PersonTasks, 'loading'> = { dates: [], monthHasData: false, current: null, previous: null, previousTotal: null, error: '' };

/** One person's tasks for the month `cur` and the month `prev` before it. */
export function usePersonTasks(employeeId: string | null | undefined, cur: MonthRange, prev: MonthRange, enabled = true): PersonTasks {
  const key = `${employeeId}|${cur.start}|${cur.end}|${prev.start}|${prev.end}`;
  const [done, setDone] = useState<{ key: string; value: Omit<PersonTasks, 'loading'> } | null>(null);
  const on = enabled && !!employeeId;

  useEffect(() => {
    if (!on || !employeeId) return;
    let live = true;
    fetchAllChecked<KpiTask>(
      (a, b) =>
        supabase
          .from('tasks')
          .select(TASK_COLUMNS)
          .eq('assigned_to', employeeId)
          .gte('due_date', prev.start)
          .lte('due_date', cur.end)
          .order('id', { ascending: true })
          .range(a, b),
      WHAT
    ).then(({ rows, error }) => {
      if (!live) return;
      const now = Date.now();
      const today = nepalTodayIso();
      const inCur = rows.filter(t => t.due_date && t.due_date >= cur.start && t.due_date <= cur.end);
      const inPrev = rows.filter(t => t.due_date && t.due_date >= prev.start && t.due_date <= prev.end);
      const c = countTasks(rows, cur.start, cur.end, now, today).get(employeeId) ?? null;
      const p = countTasks(rows, prev.start, prev.end, now, today).get(employeeId) ?? null;
      setDone({
        key,
        value: {
          dates: doneDates(rows, cur.start, cur.end, now),
          monthHasData: inCur.length > 0,
          current: c && c.assigned > 0 ? c : null,
          previous: p && p.assigned > 0 ? p : null,
          previousTotal: inPrev.length > 0 ? doneDates(rows, prev.start, prev.end, now).length : null,
          error,
        },
      });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);

  if (!on) return { loading: enabled && employeeId === undefined, ...EMPTY };
  return done && done.key === key ? { loading: false, ...done.value } : { loading: true, ...EMPTY };
}

/** One person's tasks in a month, for the services and utilisation reports. */
export function useReportTasks(employeeId: string, start: string, end: string, enabled: boolean): { loading: boolean; tasks: KpiTask[]; error: string } {
  const key = `${employeeId}|${start}|${end}`;
  const [done, setDone] = useState<{ key: string; tasks: KpiTask[]; error: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAllChecked<KpiTask>(
      (a, b) => supabase.from('tasks').select(TASK_COLUMNS).eq('assigned_to', employeeId).gte('due_date', start).lte('due_date', end).order('id', { ascending: true }).range(a, b),
      WHAT
    ).then(({ rows, error }) => {
      if (live) setDone({ key, tasks: rows, error });
    });
    return () => {
      live = false;
    };
    // `key` carries every value used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { loading: false, tasks: [], error: '' };
  return done && done.key === key ? { loading: false, tasks: done.tasks, error: done.error } : { loading: true, tasks: [], error: '' };
}
