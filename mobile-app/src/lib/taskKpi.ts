// Ported from admin-web/lib/taskKpi.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
// KPI 2 (number of services performed) and KPI 6 (hour utilisation per day) come from the Tasks page: a task is a service, one
// task is one service however long it takes. Plain code with no network, so it can be tested on its own; useTaskKpi.ts reads the
// tasks.
//
// - A task is DONE when it is completed: the status the Tasks page shows (completed, or its time slot is over: tasks finish by
//   the clock, see withTimeStatus).
// - A task is DUE once its time has come, so it is expected to be done by now: its day is before today, or it is today and its
//   time slot is over. A task with no time slot is due from the day after its date. Upcoming tasks are not counted yet, so the
//   month so far is not pulled down by work that has not happened.
// - Number of services = tasks done in the month. Utilisation = tasks done ÷ tasks due (a task done early counts as due too).

import type { Task } from '../types';
import { slotEndMs, withTimeStatus } from './taskClock';

export type KpiTask = Pick<Task, 'id' | 'title' | 'assigned_to' | 'status' | 'due_date' | 'start_time' | 'end_time'>;

/** The columns the task KPIs read. */
export const TASK_COLUMNS = 'id, title, assigned_to, status, due_date, start_time, end_time';

/** Completed, by the same rule as the Tasks page. */
export function taskDone(t: KpiTask, nowMs: number): boolean {
  return withTimeStatus(t as Task, nowMs).status === 'approved';
}

/** Its time has come: expected to be done by now. */
export function taskDue(t: KpiTask, nowMs: number, today: string): boolean {
  if (!t.due_date) return false;
  if (t.due_date < today) return true;
  if (t.due_date > today) return false;
  const end = slotEndMs(t);
  return end !== null && nowMs >= end;
}

/** `assigned` = the tasks that should be done by now (due, or done already), `done` = how many of them are done. */
export type TaskCount = { assigned: number; done: number };

const inMonth = (t: KpiTask, start: string, end: string) => !!t.due_date && t.due_date >= start && t.due_date <= end;

/** Each person's tasks in the month `start`..`end`. People with no task in the month have no entry. */
export function countTasks(tasks: KpiTask[], start: string, end: string, nowMs: number, today: string): Map<string, TaskCount> {
  const out = new Map<string, TaskCount>();
  for (const t of tasks) {
    if (!inMonth(t, start, end)) continue;
    const c = out.get(t.assigned_to) ?? { assigned: 0, done: 0 };
    const done = taskDone(t, nowMs);
    if (done || taskDue(t, nowMs, today)) c.assigned += 1;
    if (done) c.done += 1;
    out.set(t.assigned_to, c);
  }
  return out;
}

/** The utilisation as a whole percent, or null when no task is due yet. */
export const utilisationPct = (c: TaskCount | null | undefined): number | null => (c && c.assigned > 0 ? Math.round((c.done / c.assigned) * 100) : null);

/** The days of the tasks done in the month, one per task (for the bars of services by week). */
export function doneDates(tasks: KpiTask[], start: string, end: string, nowMs: number): string[] {
  return tasks.filter(t => inMonth(t, start, end) && taskDone(t, nowMs)).map(t => t.due_date as string);
}

export type TaskDayLine = { date: string; assigned: number; done: number; pct: number };

/** One person's month day by day: the tasks due that day and how many were done. Days with nothing due are left out. */
export function tasksByDay(tasks: KpiTask[], start: string, end: string, nowMs: number, today: string): TaskDayLine[] {
  const by = new Map<string, TaskCount>();
  for (const t of tasks) {
    if (!inMonth(t, start, end)) continue;
    const done = taskDone(t, nowMs);
    if (!done && !taskDue(t, nowMs, today)) continue;
    const c = by.get(t.due_date as string) ?? { assigned: 0, done: 0 };
    c.assigned += 1;
    if (done) c.done += 1;
    by.set(t.due_date as string, c);
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, c]) => ({ date, ...c, pct: Math.round((c.done / c.assigned) * 100) }));
}

export type TaskTitleLine = { title: string; count: number };

/** The tasks done in the month grouped by their title, the most frequent first. */
export function doneByTitle(tasks: KpiTask[], start: string, end: string, nowMs: number): TaskTitleLine[] {
  const by = new Map<string, number>();
  for (const t of tasks) {
    if (!inMonth(t, start, end) || !taskDone(t, nowMs)) continue;
    const title = t.title.trim() || 'Untitled task';
    by.set(title, (by.get(title) ?? 0) + 1);
  }
  return [...by.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}
