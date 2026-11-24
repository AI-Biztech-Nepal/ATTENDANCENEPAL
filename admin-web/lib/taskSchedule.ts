import type { LeaveRequest, Task } from './types';

/** The Tasks timetable's working day: one column per hour, 9 AM to 6 PM. */
export const DAY_START_HOUR = 9;
export const DAY_END_HOUR = 18;
/** Start hours of the columns: 9, 10, … 17. */
export const SLOT_HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

/** A stretch of the day, in hours since midnight (9 = 9:00, 13.5 = 1:30 PM). */
export type Slot = { start: number; end: number };

/** "09:30:00" (a Postgres `time`) -> 9.5. null for a missing or garbled value. */
export function timeToHour(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** 9 -> "09:00:00", the form a Postgres `time` column takes. */
export function hourToTime(hour: number): string {
  const h = Math.floor(hour);
  const min = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

/** The task's slot, or null when it has none (not scheduled yet). */
export function taskSlot(task: Pick<Task, 'start_time' | 'end_time'>): Slot | null {
  const start = timeToHour(task.start_time);
  const end = timeToHour(task.end_time);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** A day and a clock time ("09:30:00") on that day, read as Nepal time (UTC+5:45), as milliseconds. Null when either is missing or garbled. */
function nepalMs(day: string | null, time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!day || !m) return null;
  const ms = Date.parse(`${day}T${m[1].padStart(2, '0')}:${m[2]}:00+05:45`);
  return Number.isNaN(ms) ? null : ms;
}

/** The moment a task's time begins: its day and its start time, read as Nepal time, as milliseconds. Null when it has no slot or no day. */
export function slotStartMs(task: Pick<Task, 'due_date' | 'start_time' | 'end_time'>): number | null {
  return taskSlot(task) ? nepalMs(task.due_date, task.start_time) : null;
}

/** The moment a task's time is over: its day and its end time, read as Nepal time (UTC+5:45), as milliseconds. Null when it has
 * no slot or no day. */
export function slotEndMs(task: Pick<Task, 'due_date' | 'start_time' | 'end_time'>): number | null {
  return taskSlot(task) ? nepalMs(task.due_date, task.end_time) : null;
}

/** A task that is still to be done (pending or in progress) and has a time slot is completed once the slot's end has passed: this is
 * the task as it is to be shown at `nowMs`. Anything else (no slot, already sent in, completed, rejected) comes back as it is. */
export function withTimeStatus<T extends Task>(task: T, nowMs: number): T {
  if (task.status !== 'pending' && task.status !== 'in_progress') return task;
  const end = slotEndMs(task);
  return end !== null && nowMs >= end ? { ...task, status: 'approved' } : task;
}

export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.start < b.end && a.end > b.start;
}

export function slotLength(slot: Slot): number {
  return slot.end - slot.start;
}

/** A task as it sits on the 9-column grid: `colStart` is 1-based, `span` the number of hours. */
export type Placement = { task: Task; slot: Slot; colStart: number; span: number };

/** The employee's scheduled tasks on `date`, in time order, as grid placements. A slot that runs outside
 * 9-6 is clipped to the columns that exist; one entirely outside them is left off the grid. */
export function placementsFor(tasks: Task[], employeeId: string, date: string): Placement[] {
  const out: Placement[] = [];
  for (const task of tasks) {
    if (task.assigned_to !== employeeId || task.due_date !== date) continue;
    const slot = taskSlot(task);
    if (!slot) continue;
    const first = Math.max(Math.floor(slot.start), DAY_START_HOUR);
    const last = Math.min(Math.ceil(slot.end), DAY_END_HOUR);
    if (last <= first) continue;
    out.push({ task, slot, colStart: first - DAY_START_HOUR + 1, span: last - first });
  }
  return out.sort((a, b) => a.slot.start - b.slot.start);
}

/** Hours the employee already has booked on a day. */
export function bookedHours(placements: Placement[]): number {
  return placements.reduce((sum, p) => sum + slotLength(p.slot), 0);
}

/** The task that overlaps `slot` for this employee on `date`, if any (the one being edited is ignored). */
export function findClash(tasks: Task[], employeeId: string, date: string, slot: Slot, ignoreTaskId?: string): Task | null {
  for (const task of tasks) {
    if (task.id === ignoreTaskId || task.assigned_to !== employeeId || task.due_date !== date) continue;
    const other = taskSlot(task);
    if (other && slotsOverlap(slot, other)) return task;
  }
  return null;
}

/** Whether the employee is on approved leave on `date`. Pending or rejected requests don't count. */
export function isOnLeave(
  leaves: Pick<LeaveRequest, 'employee_id' | 'start_date' | 'end_date' | 'status'>[],
  employeeId: string,
  date: string
): boolean {
  return leaves.some(l => l.status === 'approved' && l.employee_id === employeeId && l.start_date <= date && date <= l.end_date);
}

/** Where "now" sits across the 9-6 columns, as a percentage, or null outside working hours. */
export function nowPercent(minuteOfDay: number): number | null {
  const hour = minuteOfDay / 60;
  if (hour < DAY_START_HOUR || hour > DAY_END_HOUR) return null;
  return ((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100;
}

function clock(hour: number): string {
  const h = Math.floor(hour);
  const min = Math.round((hour - h) * 60);
  return `${h % 12 || 12}:${String(min).padStart(2, '0')}`;
}

/** "9:00" for 9, "1:30" for 13.5 — twelve-hour clock, no AM/PM. */
export function formatHour(hour: number): string {
  return clock(hour);
}

/** "9:00 AM" / "2:00 PM". */
export function formatHourFull(hour: number): string {
  return `${clock(hour)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** "9:00–12:00", "2:00–5:00 PM": AM/PM is added only once the slot reaches the afternoon. */
export function formatSlot(slot: Slot): string {
  return `${clock(slot.start)}–${clock(slot.end)}${slot.end > 12 ? ' PM' : ''}`;
}

/** A date key (YYYY-MM-DD) moved by whole days — pure calendar arithmetic, no time zone involved. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is the earlier one. */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

/** How far a day is from today, in words: "today", "tomorrow", "yesterday", "in 5 days", "3 days ago", "in 6 weeks". */
export function relativeDayLabel(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const abs = Math.abs(n);
  const span = abs >= 28 ? `${Math.round(abs / 7)} weeks` : `${abs} days`;
  return n > 0 ? `in ${span}` : `${span} ago`;
}

/** "Sun" / "Sunday" for a date key, in the viewer's language. */
export function weekdayName(iso: string, style: 'short' | 'long' = 'short'): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: style });
}

/** "3 h", "1.5 h". */
export function formatDuration(hours: number): string {
  return `${Math.round(hours * 10) / 10} h`;
}
