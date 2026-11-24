import type { Task, TaskTimeLog } from './types';
import { slotEndMs, slotStartMs } from './taskSchedule';

function logHours(log: TaskTimeLog): number {
  const start = new Date(log.started_at).getTime();
  const end = new Date(log.ended_at ?? new Date().toISOString()).getTime();
  return Math.max(0, (end - start) / 3600000);
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
