import type { CompanyHoliday, Task } from './types';
import { slotLength, taskSlot } from './taskSchedule';

// The Tasks page's week view: the same tasks as the day timetable, seven days at a time. Plain code with no network, so it can be tested
// on its own; components/tasks/TaskWeek.tsx draws it. Only tasks with a time slot are here, as on the day timetable: a task with no
// time is listed under "Not scheduled yet" until it is given one.

/** One employee's scheduled tasks on each of `dates`, every date present (an empty list when there is nothing), each day in time order. */
export function weekTasksFor(tasks: Task[], employeeId: string, dates: string[]): Map<string, Task[]> {
  const out = new Map<string, Task[]>(dates.map(d => [d, []]));
  for (const t of tasks) {
    if (t.assigned_to !== employeeId || !t.due_date || !taskSlot(t)) continue;
    out.get(t.due_date)?.push(t);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (taskSlot(a)?.start ?? 0) - (taskSlot(b)?.start ?? 0) || a.title.localeCompare(b.title));
  }
  return out;
}

/** How many tasks, and how many hours of them, a week holds for one person. */
export function weekLoad(byDay: Map<string, Task[]>): { count: number; hours: number } {
  let count = 0;
  let hours = 0;
  for (const list of byDay.values()) {
    for (const t of list) {
      count += 1;
      const slot = taskSlot(t);
      if (slot) hours += slotLength(slot);
    }
  }
  return { count, hours };
}

/** Why a day is not an ordinary working day for the company. */
export type DayNote = { kind: 'off' | 'holiday'; label: string };

/** The company's weekly off day and holidays among `dates`, by date. A holiday wins over the weekly off day it falls on; a holiday for
 * one gender says so in its label. `weeklyOffDay` is 0 (Sunday) to 6 (Saturday), or null when the company has none. */
export function dayNotes(dates: string[], weeklyOffDay: number | null, holidays: Pick<CompanyHoliday, 'holiday_date' | 'name' | 'applies_to'>[]): Map<string, DayNote> {
  const out = new Map<string, DayNote>();
  for (const date of dates) {
    const holiday = holidays.find(h => h.holiday_date === date);
    if (holiday) {
      const who = holiday.applies_to === 'female' ? ' (women)' : holiday.applies_to === 'male' ? ' (men)' : '';
      out.set(date, { kind: 'holiday', label: `${holiday.name}${who}` });
    } else if (weeklyOffDay !== null && new Date(`${date}T00:00:00Z`).getUTCDay() === weeklyOffDay) {
      out.set(date, { kind: 'off', label: 'Week off' });
    }
  }
  return out;
}

/** How many chips a day's cell draws before it says "+N more". */
export const MAX_CHIPS = 3;
