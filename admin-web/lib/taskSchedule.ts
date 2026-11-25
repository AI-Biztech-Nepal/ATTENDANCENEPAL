import type { LeaveRequest, Task } from './types';

/** A stretch of the day, in hours since midnight (9 = 9:00, 13.5 = 1:30 PM). */
export type Slot = { start: number; end: number };

/** The hours the Tasks timetable shows, as whole hours since midnight: `start` is the hour of the first column, `end` the hour the last
 * column ends at. It follows the company's own shifts (see workingDay); a task can be given any half hour inside it. */
export type DayRange = { start: number; end: number };

/** What the timetable shows when the company has no shifts of its own: 9 AM to 6 PM. */
export const DEFAULT_DAY: DayRange = { start: 9, end: 18 };

/** Tasks are given in half hours. */
export const SLOT_STEP = 0.5;

/** The grid has two columns for every hour. */
export const columnsOf = (range: DayRange) => (range.end - range.start) * 2;

/** The hour of each heading: for 9 to 18, 9, 10, … 17. */
export const hoursOf = (range: DayRange) => Array.from({ length: range.end - range.start }, (_, i) => range.start + i);

/** Every half hour a slot can start at: for 9 to 18, 9, 9.5, … 17.5. */
export const slotStarts = (range: DayRange) => Array.from({ length: columnsOf(range) }, (_, i) => range.start + i * SLOT_STEP);

/** How long a shift is, in hours; a shift that ends the next morning (22:00 to 06:00) runs through midnight. */
export function shiftLength(shift: { start_time: string; end_time: string }): number {
  const a = timeToHour(shift.start_time);
  const b = timeToHour(shift.end_time);
  if (a === null || b === null || a === b) return 0;
  return b > a ? b - a : 24 - a + b;
}

/**
 * The hours the timetable covers for a company: from the earliest shift start to the latest shift end, widened to whole hours. A
 * shift that ends the next morning counts for both of its parts (its evening on the day it starts and its morning on the day it
 * ends), which makes the day twenty-four hours long. The usual 9 to 6 is used when the company has no shift, and is added when
 * someone has none of their own and so works the default one (`includeDefault`).
 */
export function workingDay(shifts: { start_time: string; end_time: string }[], includeDefault: boolean): DayRange {
  const parts: Slot[] = [];
  if (includeDefault || shifts.length === 0) parts.push({ start: DEFAULT_DAY.start, end: DEFAULT_DAY.end });
  for (const sh of shifts) {
    const a = timeToHour(sh.start_time);
    const b = timeToHour(sh.end_time);
    if (a === null || b === null || a === b) continue;
    if (b > a) parts.push({ start: a, end: b });
    else parts.push({ start: a, end: 24 }, { start: 0, end: b });
  }
  if (parts.length === 0) return { ...DEFAULT_DAY };
  const start = Math.max(0, Math.floor(Math.min(...parts.map(p => p.start))));
  const end = Math.min(24, Math.ceil(Math.max(...parts.map(p => p.end))));
  return end > start ? { start, end } : { start, end: Math.min(24, start + 1) };
}

/** The range for one day: the company's hours, widened to take in every task slot on that day, so a task left outside them (after the
 * shifts changed) is never hidden. */
export function rangeWithTasks(range: DayRange, tasks: Pick<Task, 'due_date' | 'start_time' | 'end_time'>[], date: string): DayRange {
  let { start, end } = range;
  for (const t of tasks) {
    if (t.due_date !== date) continue;
    const slot = taskSlot(t);
    if (!slot) continue;
    start = Math.min(start, Math.max(0, Math.floor(slot.start)));
    end = Math.max(end, Math.min(24, Math.ceil(slot.end)));
  }
  return { start, end };
}

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

/** Tasks run on the clock: nobody accepts or starts one. A task that is still to be done (pending or in progress) and has a time slot is
 * pending until its slot begins, in progress while the slot is running and completed once the slot's end has passed. This is the task as it
 * is to be shown at `nowMs`. Anything else (no slot, sent in, completed, rejected) comes back as it is. */
export function withTimeStatus<T extends Task>(task: T, nowMs: number): T {
  if (task.status !== 'pending' && task.status !== 'in_progress') return task;
  const end = slotEndMs(task);
  if (end === null) return task;
  if (nowMs >= end) return { ...task, status: 'approved' };
  const start = slotStartMs(task);
  if (task.status === 'pending' && start !== null && nowMs >= start) return { ...task, status: 'in_progress' };
  return task;
}

export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.start < b.end && a.end > b.start;
}

export function slotLength(slot: Slot): number {
  return slot.end - slot.start;
}

/** A task as it sits on the grid, which has two columns for every hour: `colStart` is 1-based, `span` the number of half hours. */
export type Placement = { task: Task; slot: Slot; colStart: number; span: number };

/** The employee's scheduled tasks on `date`, in time order, as grid placements. A slot that runs outside the day's range is clipped to
 * the columns that exist; one entirely outside them is left off the grid. A time that is not on a half hour is drawn on the
 * half hours around it. */
export function placementsFor(tasks: Task[], employeeId: string, date: string, range: DayRange = DEFAULT_DAY): Placement[] {
  const out: Placement[] = [];
  for (const task of tasks) {
    if (task.assigned_to !== employeeId || task.due_date !== date) continue;
    const slot = taskSlot(task);
    if (!slot) continue;
    const first = Math.max(Math.floor(slot.start * 2) / 2, range.start);
    const last = Math.min(Math.ceil(slot.end * 2) / 2, range.end);
    if (last <= first) continue;
    out.push({ task, slot, colStart: Math.round((first - range.start) * 2) + 1, span: Math.round((last - first) * 2) });
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

/** Where "now" sits across the day's columns, as a percentage, or null outside them. */
export function nowPercent(minuteOfDay: number, range: DayRange = DEFAULT_DAY): number | null {
  const hour = minuteOfDay / 60;
  if (hour < range.start || hour > range.end) return null;
  return ((hour - range.start) / (range.end - range.start)) * 100;
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

/** "9:00 AM" / "2:00 PM" / "12:00 AM" for midnight (hour 24 is the end of the day). */
export function formatHourFull(hour: number): string {
  return `${clock(hour)} ${hour % 24 >= 12 ? 'PM' : 'AM'}`;
}

/** "9 AM" / "2 PM": a whole hour, for the ends of a strip. */
export function formatHourShort(hour: number): string {
  return `${Math.floor(hour) % 12 || 12} ${hour % 24 >= 12 ? 'PM' : 'AM'}`;
}

/** "9:00–12:00", "2:00–5:00 PM", "9:30–10:00": AM/PM is added only once the slot reaches the afternoon (AM when it runs to midnight). */
export function formatSlot(slot: Slot): string {
  return `${clock(slot.start)}–${clock(slot.end)}${slot.end >= 24 ? ' AM' : slot.end > 12 ? ' PM' : ''}`;
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
