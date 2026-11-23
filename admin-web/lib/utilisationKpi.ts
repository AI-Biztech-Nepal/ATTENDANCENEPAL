// KPI 6, hour utilisation per day: how much of a working day a person spends with customers. Plain code with no network,
// so it can be tested on its own; useServiceKpi.ts reads the rows. The time comes from the booking file (the minutes
// each service took), the working day from Settings, and the days worked from the attendance records.

/** One service as far as time is concerned. `minutes` is empty when the file did not say how long it took. */
export type TimedService = { employee_id: string; performed_on: string; minutes: number | null };

/** The time one person spent with customers in a month: the minutes, and on how many different days. */
export type MonthTime = { minutes: number; days: number };

/** Each person's time with customers in the rows. Services with no time are left out. */
export function timeByEmployee(rows: TimedService[]): Map<string, MonthTime> {
  const acc = new Map<string, { minutes: number; days: Set<string> }>();
  for (const r of rows) {
    if (r.minutes == null || !(r.minutes > 0)) continue;
    const a = acc.get(r.employee_id) ?? { minutes: 0, days: new Set<string>() };
    a.minutes += r.minutes;
    a.days.add(r.performed_on);
    acc.set(r.employee_id, a);
  }
  return new Map([...acc.entries()].map(([id, a]) => [id, { minutes: a.minutes, days: a.days.size }]));
}

/** One person's time in the rows that fall in `start`..`end` (rows of that person only), or null when there is none. */
export function monthTime(rows: { performed_on: string; minutes: number | null }[], start: string, end: string): MonthTime | null {
  const inMonth = rows.filter(r => r.performed_on >= start && r.performed_on <= end).map(r => ({ employee_id: 'x', performed_on: r.performed_on, minutes: r.minutes }));
  return timeByEmployee(inMonth).get('x') ?? null;
}

export type Utilisation = {
  /** Whole percent of the working day spent with customers (can pass 100 when someone is booked past the day). */
  pct: number;
  /** Hours with a customer on an average day, to one decimal. */
  avgHours: number;
  /** The working day it is measured against, in hours. */
  hoursPerDay: number;
  /** The days it is averaged over. */
  days: number;
};

/**
 * Time with customers out of the working day, averaged over the days worked.
 *
 * - `presentDays` is the days the person was at work (from attendance), or null for someone excused from attendance.
 * - The days worked are the larger of that and the days they have timed services on, so a service on a day the
 *   attendance records miss never pushes the average above what the day could hold.
 * - A day at work with no service is a day with nothing with a customer, which is what pulls the average down.
 *
 * Null when there is no time to count, no day worked, or no working day set.
 */
export function utilisation(time: MonthTime | null | undefined, presentDays: number | null, hoursPerDay: number): Utilisation | null {
  if (!time || !(time.minutes > 0) || !(hoursPerDay > 0)) return null;
  const days = Math.max(presentDays ?? 0, time.days);
  if (days <= 0) return null;
  const avg = time.minutes / days / 60;
  return { pct: Math.round((avg / hoursPerDay) * 100), avgHours: Math.round(avg * 10) / 10, hoursPerDay, days };
}

/** 9 -> "9", 7.5 -> "7.5", 6.4 -> "6.4". */
export const hoursText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

/** The rest of the working day, in hours (never below 0). */
export const restOfDay = (u: Utilisation) => Math.max(0, Math.round((u.hoursPerDay - u.avgHours) * 10) / 10);
