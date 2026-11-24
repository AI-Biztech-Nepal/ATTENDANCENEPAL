// What sits behind a KPI card on a person's page: the lines of the report that opens when a card is clicked. Plain code
// with no network, so it can be tested on its own; useKpiReport.ts reads the rows. Nothing here names a customer or a
// colleague: a guest is only the scrambled code made by the import.

import { daysBetween, type CustomerVisit } from './rebookingKpi';

/** The reports a card can open (the cards with a graph). */
export type ReportKind = 'attendance' | 'services' | 'rebooking' | 'utilisation' | 'feedback' | 'nps' | 'colleagues';

/** One service as the reports need it. */
export type ServiceRow = { performed_on: string; service: string | null; minutes: number | null };

export const NOT_NAMED = 'Not named in the file';

export type ServiceTypeLine = { service: string; count: number; minutes: number };
export type ServiceDayLine = { date: string; count: number; minutes: number };

/** The services grouped by what was done, the most frequent first (then the longest, then by name). */
export function servicesByType(rows: ServiceRow[]): ServiceTypeLine[] {
  const by = new Map<string, ServiceTypeLine>();
  for (const r of rows) {
    const name = r.service?.trim() || NOT_NAMED;
    const line = by.get(name) ?? { service: name, count: 0, minutes: 0 };
    line.count += 1;
    line.minutes += r.minutes && r.minutes > 0 ? r.minutes : 0;
    by.set(name, line);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.service.localeCompare(b.service));
}

/** The services grouped by day, oldest first. */
export function servicesByDay(rows: ServiceRow[]): ServiceDayLine[] {
  const by = new Map<string, ServiceDayLine>();
  for (const r of rows) {
    const line = by.get(r.performed_on) ?? { date: r.performed_on, count: 0, minutes: 0 };
    line.count += 1;
    line.minutes += r.minutes && r.minutes > 0 ? r.minutes : 0;
    by.set(r.performed_on, line);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type UtilisationDayLine = {
  date: string;
  /** Services that day that have a time. */
  services: number;
  minutes: number;
  /** Whole percent of the working day spent with customers. */
  pct: number;
  /** The person was at work that day (from attendance), whether or not they had a service. */
  atWork: boolean;
};

/**
 * Each day that was worked, with the time spent with customers and its share of the working day. A day is a day with a timed
 * service or a day at work, so a day at work with no service shows 0 and is what pulls the average down (the same days
 * the card averages over). Oldest first.
 */
export function utilisationByDay(rows: ServiceRow[], presentDates: string[], hoursPerDay: number): UtilisationDayLine[] {
  const minutes = new Map<string, { services: number; minutes: number }>();
  for (const r of rows) {
    if (!r.minutes || r.minutes <= 0) continue;
    const m = minutes.get(r.performed_on) ?? { services: 0, minutes: 0 };
    m.services += 1;
    m.minutes += r.minutes;
    minutes.set(r.performed_on, m);
  }
  const present = new Set(presentDates);
  const dates = [...new Set([...minutes.keys(), ...present])].sort();
  return dates.map(date => {
    const m = minutes.get(date) ?? { services: 0, minutes: 0 };
    return { date, services: m.services, minutes: m.minutes, pct: hoursPerDay > 0 ? Math.round((m.minutes / 60 / hoursPerDay) * 100) : 0, atWork: present.has(date) };
  });
}

/** 'back' = came back within the window; 'may_return' = not yet, but the window is still open; 'not_yet' = the window has closed. */
export type GuestState = 'back' | 'not_yet' | 'may_return';

export type GuestLine = {
  /** The scrambled code from the import. Never a name. */
  key: string;
  /** The person's first service for this guest in the month, and how many they did for them in it. */
  first: string;
  visits: number;
  /** The first later visit within the window (with anyone), when there was one. */
  returnedOn: string | null;
  state: GuestState;
};

/**
 * The guests one person served in the month `start`..`end` and whether each came back, counted by the same rule as the
 * rebooking rate (see computeRebooking): a guest booked again when they have a service on a later day than the person's
 * first one for them, no more than `windowDays` days after it, with anyone. `visits` should run `windowDays` past `end`.
 * Oldest first visit first.
 */
export function rebookingGuests(visits: CustomerVisit[], employeeId: string, start: string, end: string, windowDays: number, today: string): GuestLine[] {
  const days = new Map<string, string[]>();
  const mine = new Map<string, { first: string; visits: number }>();
  for (const v of visits) {
    if (!v.customer_key) continue;
    const list = days.get(v.customer_key) ?? [];
    list.push(v.performed_on);
    days.set(v.customer_key, list);
    if (v.employee_id !== employeeId || v.performed_on < start || v.performed_on > end) continue;
    const m = mine.get(v.customer_key);
    if (!m) mine.set(v.customer_key, { first: v.performed_on, visits: 1 });
    else {
      m.visits += 1;
      if (v.performed_on < m.first) m.first = v.performed_on;
    }
  }
  const out: GuestLine[] = [];
  for (const [key, m] of mine) {
    const later = (days.get(key) ?? []).filter(d => d > m.first && daysBetween(m.first, d) <= windowDays).sort();
    const returnedOn = later[0] ?? null;
    out.push({ key, first: m.first, visits: m.visits, returnedOn, state: returnedOn ? 'back' : daysBetween(m.first, today) < windowDays ? 'may_return' : 'not_yet' });
  }
  return out.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : a.key.localeCompare(b.key)));
}
