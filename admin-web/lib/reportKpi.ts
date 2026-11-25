// What sits behind a KPI card on a person's page: the lines of the report that opens when a card is clicked. Plain code
// with no network, so it can be tested on its own; useKpiReport.ts reads the rows. A guest is told apart by the key the
// import made from their phone number or name, and shown by their name when the file had one.

import type { CustomerVisit } from './rebookingKpi';

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

/** 'back' = came back (on any later day, with anyone); 'not_yet' = has not come back so far. */
export type GuestState = 'back' | 'not_yet';

/** A visit as the rebooking report reads it: the person's own visits also bring the guest's name and the row's id, so the
 * guest can be named and their history opened. */
export type ReportVisit = CustomerVisit & { id?: string; customer_name?: string | null };

export type GuestLine = {
  /** The key the import made from the guest's phone number or name (or an older import's scrambled code). */
  key: string;
  /** The guest's name from the bookings file, or null when the file had none (older imports). */
  name: string | null;
  /** One of the person's own visits with this guest, to open the guest's history from; null when not known. */
  anchorId: string | null;
  /** The person's first service for this guest in the month, and how many they did for them in it. */
  first: string;
  visits: number;
  /** The first later visit (with anyone), when there was one. */
  returnedOn: string | null;
  state: GuestState;
};

/**
 * The guests one person served in the month `start`..`end` and whether each came back, counted by the same rule as the
 * rebooking rate (see computeRebooking): a guest booked again when they have a service on any later day than the person's
 * first one for them, with anyone, with no time limit. `visits` should run from `start` with no end. Oldest first visit first.
 */
export function rebookingGuests(visits: ReportVisit[], employeeId: string, start: string, end: string): GuestLine[] {
  const days = new Map<string, string[]>();
  const mine = new Map<string, { first: string; visits: number; name: string | null; anchorId: string | null }>();
  for (const v of visits) {
    if (!v.customer_key) continue;
    const list = days.get(v.customer_key) ?? [];
    list.push(v.performed_on);
    days.set(v.customer_key, list);
    if (v.employee_id !== employeeId || v.performed_on < start || v.performed_on > end) continue;
    const m = mine.get(v.customer_key);
    const name = v.customer_name?.trim() || null;
    if (!m) mine.set(v.customer_key, { first: v.performed_on, visits: 1, name, anchorId: v.id ?? null });
    else {
      m.visits += 1;
      if (v.performed_on < m.first) m.first = v.performed_on;
      if (!m.name && name) m.name = name;
      if (!m.anchorId && v.id) m.anchorId = v.id;
    }
  }
  const out: GuestLine[] = [];
  for (const [key, m] of mine) {
    const later = (days.get(key) ?? []).filter(d => d > m.first).sort();
    const returnedOn = later[0] ?? null;
    out.push({ key, name: m.name, anchorId: m.anchorId, first: m.first, visits: m.visits, returnedOn, state: returnedOn ? 'back' : 'not_yet' });
  }
  return out.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : (a.name ?? a.key).localeCompare(b.name ?? b.key)));
}
