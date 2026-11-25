// KPI 5, rebooking rate: of the customers an employee served in a month, how many came back. Plain code with no
// network, so it can be tested on its own; useRebookingKpi.ts reads the rows. A customer is the key the import made from
// their phone number or name (customer_key), which tells that two services were for the same person.

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

/** Pass this as the last day to read visits up to, when there is no limit: every later visit counts. */
export const NO_END = '9999-12-31';

/**
 * Each person's rebooking for the month `start`..`end` (AD date keys).
 *
 * - A customer is *served* by a person in the month when the person performed a service for them in it, however many
 *   times: that counts once.
 * - They *booked again* when the customer has a service on any later day than the person's first one for them in the
 *   month, with no time limit: whenever the customer comes back, it is a rebooking. The later service can be with anyone,
 *   and can fall after the month ends, so `visits` should run from `start` with no end.
 * - A customer who has not come back is "not yet": they may still come back.
 *
 * Visits with no customer are left out. People with no customers in the month have no entry.
 */
export function computeRebooking(visits: CustomerVisit[], start: string, end: string): Map<string, Rebooking> {
  const last = new Map<string, string>();
  const firstVisit = new Map<string, Map<string, string>>();
  for (const v of visits) {
    if (!v.customer_key) continue;
    const seenLast = last.get(v.customer_key);
    if (seenLast === undefined || v.performed_on > seenLast) last.set(v.customer_key, v.performed_on);
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
      if ((last.get(customer) ?? '') > first) back += 1;
    }
    out.set(employeeId, { served: customers.size, back });
  }
  return out;
}

/** The rate as a whole percent, or null when there was nobody to count. */
export const rebookingPct = (r: Rebooking): number | null => (r.served > 0 ? Math.round((r.back / r.served) * 100) : null);
