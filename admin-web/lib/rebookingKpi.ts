// KPI 5, rebooking rate: of the customers an employee served in a month, how many came back. Plain code with no
// network, so it can be tested on its own; useRebookingKpi.ts reads the rows. A customer is only a scrambled code
// (customer_key) made by the import, never a name, which is enough to tell that two services were for the same person.

/** One service for a customer: who performed it, which customer, on which day (AD date key). */
export type CustomerVisit = { employee_id: string; customer_key: string; performed_on: string };

/** `served` customers, of whom `back` booked again. */
export type Rebooking = { served: number; back: number };

/** Whole days from one AD date key to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/**
 * Each person's rebooking for the month `start`..`end` (AD date keys).
 *
 * - A customer is *served* by a person in the month when the person performed a service for them in it, however many
 *   times: that counts once.
 * - They *booked again* when the customer has a service on a later day than the person's first one for them in the
 *   month, no more than `windowDays` days after it. The later service can be with anyone and can fall after the
 *   month ends, so `visits` should run `windowDays` past `end`. The last day of the window counts.
 * - A customer who has not come back is "not yet", not "never": a visit in the last `windowDays` days may still return.
 *
 * Visits with no customer code are left out. People with no customers in the month have no entry.
 */
export function computeRebooking(visits: CustomerVisit[], start: string, end: string, windowDays: number): Map<string, Rebooking> {
  const days = new Map<string, string[]>();
  const firstVisit = new Map<string, Map<string, string>>();
  for (const v of visits) {
    if (!v.customer_key) continue;
    const list = days.get(v.customer_key) ?? [];
    list.push(v.performed_on);
    days.set(v.customer_key, list);
    if (v.performed_on < start || v.performed_on > end) continue;
    const mine = firstVisit.get(v.employee_id) ?? new Map<string, string>();
    const seen = mine.get(v.customer_key);
    if (seen === undefined || v.performed_on < seen) mine.set(v.customer_key, v.performed_on);
    firstVisit.set(v.employee_id, mine);
  }
  const out = new Map<string, Rebooking>();
  for (const [employeeId, customers] of firstVisit) {
    let back = 0;
    for (const [customer, first] of customers) {
      if ((days.get(customer) ?? []).some(d => d > first && daysBetween(first, d) <= windowDays)) back += 1;
    }
    out.set(employeeId, { served: customers.size, back });
  }
  return out;
}

/** The rate as a whole percent, or null when there was nobody to count. */
export const rebookingPct = (r: Rebooking): number | null => (r.served > 0 ? Math.round((r.back / r.served) * 100) : null);
