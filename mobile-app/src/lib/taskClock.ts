// Ported from admin-web/lib/taskSchedule.ts (the parts the phone needs) — keep the two in step.
// Tasks run on the clock: nobody accepts or starts one. The manager enters a task for a day and a time slot, and by the clock it is
// upcoming until its slot begins, in progress while the slot is running and done once the slot has ended.
import type { Task } from '../types';

/** A stretch of the day, in hours since midnight (9 = 9:00, 13.5 = 1:30 PM). */
export type Slot = { start: number; end: number };

/** "09:30:00" (a Postgres `time`) -> 9.5. null for a missing or garbled value. */
export function timeToHour(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** The task's slot, or null when it has none (no time set yet). */
export function taskSlot(task: Pick<Task, 'start_time' | 'end_time'>): Slot | null {
  const start = timeToHour(task.start_time);
  const end = timeToHour(task.end_time);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

export const slotLength = (slot: Slot) => slot.end - slot.start;

/** A day and a clock time ("09:30:00") on that day, read as Nepal time (UTC+5:45), as milliseconds. Null when either is missing or garbled. */
function nepalMs(day: string | null, time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!day || !m) return null;
  const ms = Date.parse(`${day}T${m[1].padStart(2, '0')}:${m[2]}:00+05:45`);
  return Number.isNaN(ms) ? null : ms;
}

/** The moment a task's time begins / is over: its day and start / end time as Nepal time. Null when it has no slot or no day. */
export function slotStartMs(task: Pick<Task, 'due_date' | 'start_time' | 'end_time'>): number | null {
  return taskSlot(task) ? nepalMs(task.due_date, task.start_time) : null;
}
export function slotEndMs(task: Pick<Task, 'due_date' | 'start_time' | 'end_time'>): number | null {
  return taskSlot(task) ? nepalMs(task.due_date, task.end_time) : null;
}

/** A task still to be done (pending or in progress) with a time slot is pending until its slot begins, in progress while it is running and
 * completed ('approved') once its end has passed. Anything else (no slot, sent in, completed, rejected) comes back as it is. */
export function withTimeStatus<T extends Task>(task: T, nowMs: number): T {
  if (task.status !== 'pending' && task.status !== 'in_progress') return task;
  const end = slotEndMs(task);
  if (end === null) return task;
  if (nowMs >= end) return { ...task, status: 'approved' };
  const start = slotStartMs(task);
  if (task.status === 'pending' && start !== null && nowMs >= start) return { ...task, status: 'in_progress' };
  return task;
}

function clock(hour: number): string {
  const h = Math.floor(hour);
  const min = Math.round((hour - h) * 60);
  return `${h % 12 || 12}:${String(min).padStart(2, '0')}`;
}

/** "2:00–3:00 PM", "9:00–12:00". */
export function formatSlot(slot: Slot): string {
  return `${clock(slot.start)}–${clock(slot.end)}${slot.end > 12 ? ' PM' : ''}`;
}

/** "3 h", "1.5 h". */
export function formatDuration(hours: number): string {
  return `${Math.round(hours * 10) / 10} h`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Tue" for a date key (YYYY-MM-DD). */
export function weekdayName(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is the earlier one. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** "25 min left", "1 h 5 min left". */
export function timeLeft(minutes: number): string {
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`;
}
