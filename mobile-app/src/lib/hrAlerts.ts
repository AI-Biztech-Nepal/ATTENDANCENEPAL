import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import NepaliDate from 'nepali-date-converter';
import { supabase } from './supabase';
import { fetchAll } from './leaveBalance';
import type { CalendarSystem } from './calendar';

/** A contract is flagged this many months before it ends. */
export const CONTRACT_WARNING_MONTHS = 1;
/** Birthdays are listed this many days ahead. */
export const BIRTHDAY_LOOKAHEAD_DAYS = 30;

type HrRow = {
  id: string;
  name: string;
  designation: string | null;
  profile_photo_url: string | null;
  employment_type: string | null;
  contract_end: string | null;
  date_of_birth: string | null;
};

export type ContractAlert = {
  id: string;
  name: string;
  designation: string | null;
  photoUrl: string | null;
  /** AD date key (YYYY-MM-DD) of the last day of the contract. */
  endKey: string;
  /** Days from today to the end date; negative once the contract has ended. */
  daysLeft: number;
};

export type BirthdayAlert = {
  id: string;
  name: string;
  designation: string | null;
  photoUrl: string | null;
  /** AD date key (YYYY-MM-DD) of the coming birthday. */
  dateKey: string;
  daysAway: number;
  /** The age they turn, counted in the active calendar (BS years in BS). */
  turning: number;
};

// --- dates (all LOCAL midnight, like the rest of the site) -------------------

const DAY_MS = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Rounded, not floored, so a daylight-saving change can't turn "tomorrow" into 0 or 2.
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Same day of the month `n` months on, or the month's last day if it has no such day. */
function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay));
}

// --- contracts ---------------------------------------------------------------

/** Active employees on a contract that has ended, or ends within a month.
 * Most overdue first, then soonest. A contract that already ended stays listed
 * until HR renews it (sets a later end date) or marks the person as having left —
 * someone still working without a contract is exactly what this is meant to catch. */
export function contractAlerts(rows: HrRow[], today: Date): ContractAlert[] {
  const horizon = addMonths(today, CONTRACT_WARNING_MONTHS);
  const out: ContractAlert[] = [];
  for (const r of rows) {
    if (r.employment_type !== 'contract' || !r.contract_end) continue;
    const end = parseKey(r.contract_end);
    if (!end || end > horizon) continue;
    out.push({
      id: r.id,
      name: r.name,
      designation: r.designation,
      photoUrl: r.profile_photo_url,
      endKey: toKey(end),
      daysLeft: daysBetween(today, end),
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

// --- birthdays ---------------------------------------------------------------

/** The next time `dob`'s month and day come round (today counts), in whichever
 * calendar is showing. A birthday that doesn't exist in the coming year (29 Feb,
 * or day 32 of a BS month that has 31 that year) lands on the month's last day. */
function nextBirthday(dob: Date, system: CalendarSystem, today: Date): { date: Date; turning: number } | null {
  if (system === 'AD') {
    for (let add = 0; add < 2; add++) {
      const year = today.getFullYear() + add;
      const lastDay = new Date(year, dob.getMonth() + 1, 0).getDate();
      const date = new Date(year, dob.getMonth(), Math.min(dob.getDate(), lastDay));
      if (date >= today) return { date, turning: year - dob.getFullYear() };
    }
    return null;
  }
  const bsDob = NepaliDate.fromAD(dob).getBS();
  const bsToday = NepaliDate.fromAD(today).getBS();
  for (let add = 0; add < 2; add++) {
    const year = bsToday.year + add;
    const lastDay = new NepaliDate(year, bsDob.month + 1, 0).getDate();
    const ad = new NepaliDate(year, bsDob.month, Math.min(bsDob.date, lastDay)).getAD();
    const date = new Date(ad.year, ad.month, ad.date);
    if (date >= today) return { date, turning: year - bsDob.year };
  }
  return null;
}

export function upcomingBirthdays(rows: HrRow[], system: CalendarSystem, today: Date): BirthdayAlert[] {
  const out: BirthdayAlert[] = [];
  for (const r of rows) {
    if (!r.date_of_birth) continue;
    const dob = parseKey(r.date_of_birth);
    if (!dob) continue;
    try {
      const next = nextBirthday(dob, system, today);
      if (!next || next.turning < 1) continue;
      const daysAway = daysBetween(today, next.date);
      if (daysAway > BIRTHDAY_LOOKAHEAD_DAYS) continue;
      out.push({
        id: r.id,
        name: r.name,
        designation: r.designation,
        photoUrl: r.profile_photo_url,
        dateKey: toKey(next.date),
        daysAway,
        turning: next.turning,
      });
    } catch {
      // A date the Nepali calendar can't convert (outside its supported years) —
      // skip that one person rather than lose the whole list.
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
}

/** "14 Kartik" / "5 Nov" — a date without its year, in the active calendar. */
export function formatDayMonth(key: string, system: CalendarSystem): string {
  const d = parseKey(key);
  if (!d) return key;
  if (system === 'AD') return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return NepaliDate.fromAD(d).format('D MMMM');
}

// --- data --------------------------------------------------------------------

/** Contracts ending soon and birthdays coming up, for the owner's bell.
 * Reloaded when `refreshKey` changes (the bell passes a new value each time it is
 * opened), when the app comes back to the foreground, and every half hour — dates
 * only move once a day, so there is no minute-by-minute polling. The columns come
 * from the HR-profile migration; until it has been run the query fails and there is
 * simply nothing to list. */
export function useHrAlerts(system: CalendarSystem, refreshKey: number) {
  const [rows, setRows] = useState<HrRow[]>([]);
  const [today, setToday] = useState(startOfToday);

  useEffect(() => {
    let active = true;
    const load = () => {
      setToday(startOfToday());
      fetchAll<HrRow>((from, to) =>
        supabase
          .from('employees')
          .select('id, name, designation, profile_photo_url, employment_type, contract_end, date_of_birth')
          .eq('status', 'active')
          .or('date_of_birth.not.is.null,and(employment_type.eq.contract,contract_end.not.is.null)')
          .order('name')
          .range(from, to)
      ).then(data => {
        if (active) setRows(data);
      });
    };
    load();
    const timer = setInterval(load, 30 * 60 * 1000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') load();
    });
    return () => {
      active = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [refreshKey]);

  return useMemo(
    () => ({ contracts: contractAlerts(rows, today), birthdays: upcomingBirthdays(rows, system, today) }),
    [rows, system, today]
  );
}
