import type { Task, TaskTimeLog } from './types';
import { slotEndMs, slotStartMs } from './taskSchedule';

export type Granularity = 'day' | 'week' | 'month';

export type HourBucket = { label: string; hours: number };

const REFERENCE_HOURS: Record<Granularity, number> = { day: 8, week: 40, month: 160 };
const REFERENCE_LABEL: Record<Granularity, string> = {
  day: 'Target: 8h/day',
  week: 'Target: 40h/week',
  month: 'Target: 160h/month',
};
const DAY_COUNT = 14;
const WEEK_COUNT = 8;
const MONTH_COUNT = 6;

function logHours(log: TaskTimeLog): number {
  const start = new Date(log.started_at).getTime();
  const end = new Date(log.ended_at ?? new Date().toISOString()).getTime();
  return Math.max(0, (end - start) / 3600000);
}

function startOfWeek(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
}

/** Each log's full duration is attributed to the bucket containing its
 * started_at — sessions aren't split across a bucket boundary (e.g. a timer
 * running past midnight counts entirely for the day it started), a
 * reasonable simplification for typical work sessions. */
export function bucketHours(logs: TaskTimeLog[], granularity: Granularity): HourBucket[] {
  const now = new Date();
  const buckets: { key: string; label: string; hours: number }[] = [];

  if (granularity === 'day') {
    for (let i = DAY_COUNT - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), hours: 0 });
    }
    for (const log of logs) {
      const d = new Date(log.started_at);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString();
      const bucket = buckets.find(b => b.key === key);
      if (bucket) bucket.hours += logHours(log);
    }
  } else if (granularity === 'week') {
    for (let i = WEEK_COUNT - 1; i >= 0; i--) {
      const start = startOfWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7));
      buckets.push({
        key: start.toDateString(),
        label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        hours: 0,
      });
    }
    for (const log of logs) {
      const key = startOfWeek(new Date(log.started_at)).toDateString();
      const bucket = buckets.find(b => b.key === key);
      if (bucket) bucket.hours += logHours(log);
    }
  } else {
    for (let i = MONTH_COUNT - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
        hours: 0,
      });
    }
    for (const log of logs) {
      const d = new Date(log.started_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = buckets.find(b => b.key === key);
      if (bucket) bucket.hours += logHours(log);
    }
  }

  return buckets.map(b => ({ label: b.label, hours: Math.round(b.hours * 10) / 10 }));
}

export function referenceHours(granularity: Granularity) {
  return REFERENCE_HOURS[granularity];
}

export function referenceLabel(granularity: Granularity) {
  return REFERENCE_LABEL[granularity];
}

/** The time a task has run according to its schedule, as a log: from the start of its time slot until now, never past the end of the
 * slot, and not past the moment it was sent in. Tasks run on the clock (they complete when their time is over), so nobody has to start a
 * timer for their time to count. Null when it has no slot, its time has barely begun (under a minute), or it was sent back. */
export function scheduledLog(task: Task, nowMs: number): TaskTimeLog | null {
  if (task.status === 'rejected') return null;
  const start = slotStartMs(task);
  const end = slotEndMs(task);
  if (start === null || end === null) return null;
  let stop = Math.min(nowMs, end);
  const sentIn = task.submitted_at ? Date.parse(task.submitted_at) : NaN;
  if (!Number.isNaN(sentIn)) stop = Math.min(stop, Math.max(start, sentIn));
  if (stop - start < 60000) return null;   // under a minute is not worth a row of its own
  const at = new Date(start).toISOString();
  return { id: `slot-${task.id}`, task_id: task.id, employee_id: task.assigned_to, started_at: at, ended_at: new Date(stop).toISOString(), created_at: at };
}

/** The real timer sessions, plus the scheduled time (see scheduledLog) of every task that has no timer session at all. A timer that was
 * used is the truth for its task, so the two are never added together. */
export function logsWithSchedule(tasks: Task[], logs: TaskTimeLog[], nowMs: number): TaskTimeLog[] {
  const timed = new Set(logs.map(l => l.task_id));
  const extra: TaskTimeLog[] = [];
  for (const t of tasks) {
    if (timed.has(t.id)) continue;
    const log = scheduledLog(t, nowMs);
    if (log) extra.push(log);
  }
  return [...logs, ...extra];
}

export function totalsByTask(logs: TaskTimeLog[]): { task_id: string; hours: number }[] {
  const map = new Map<string, number>();
  for (const log of logs) {
    map.set(log.task_id, (map.get(log.task_id) ?? 0) + logHours(log));
  }
  return Array.from(map.entries())
    .map(([task_id, hours]) => ({ task_id, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}
