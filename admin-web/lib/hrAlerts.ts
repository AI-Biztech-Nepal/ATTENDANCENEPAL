'use client';

import { useEffect, useMemo, useState } from 'react';
import NepaliDate from 'nepali-date-converter';
import { supabase, supabaseConfigured } from './supabase';
import { fetchAll } from './leaveBalance';
import { isUntouched, type EmployeeSeparation, type SettlementStatus } from './employeeSeparation';
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

// --- exits -------------------------------------------------------------------

/** handed_in: the employee handed in a resignation and HR has not started on it yet.
 * notice: still working, with an exit under way.
 * settlement: has left, but the final settlement is not completed. */
export type ExitKind = 'handed_in' | 'notice' | 'settlement';

export type ExitAlert = {
  /** The employee's id. */
  id: string;
  name: string;
  designation: string | null;
  photoUrl: string | null;
  kind: ExitKind;
  lastWorkingOn: string | null;
  /** Days from today to the last working day; negative once it has passed. */
  daysLeft: number | null;
  handedInOn: string | null;
  settlement: SettlementStatus;
};

type SeparationEmployee = { name: string; designation: string | null; profile_photo_url: string | null; status: 'active' | 'inactive' };

/** An employee_separations row with the person it belongs to, as the bell's query returns it. */
export type SeparationRow = EmployeeSeparation & { employee: SeparationEmployee | SeparationEmployee[] | null };

/** Every exit that is not finished, most urgent first: a resignation HR has not started on, then people
 * serving notice (soonest last day first), then people who have left but are not fully settled. Whether it
 * was the employee or an admin who started it does not matter here — an admin marking someone resigned
 * lists them as awaiting settlement. */
export function exitAlerts(rows: SeparationRow[], today: Date): ExitAlert[] {
  const out: ExitAlert[] = [];
  for (const r of rows) {
    if (r.settlement_status === 'completed') continue;
    const emp = Array.isArray(r.employee) ? r.employee[0] : r.employee;
    if (!emp) continue;
    const kind: ExitKind = emp.status === 'inactive' ? 'settlement' : r.requested_by_employee && isUntouched(r) ? 'handed_in' : 'notice';
    const last = r.last_working_on ? parseKey(r.last_working_on) : null;
    out.push({
      id: r.employee_id,
      name: emp.name,
      designation: emp.designation,
      photoUrl: emp.profile_photo_url,
      kind,
      lastWorkingOn: r.last_working_on,
      daysLeft: last ? daysBetween(today, last) : null,
      handedInOn: r.resignation_submitted_on,
      settlement: r.settlement_status,
    });
  }
  const rank: Record<ExitKind, number> = { handed_in: 0, notice: 1, settlement: 2 };
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
    if (a.kind === 'handed_in') return (b.handedInOn ?? '').localeCompare(a.handedInOn ?? '') || a.name.localeCompare(b.name);
    if (a.kind === 'notice') return (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

/** The chip for an exit row. `tone` picks its colour: bad is red, warn amber, info blue, neutral grey. */
export function exitLabel(e: ExitAlert): { text: string; tone: 'bad' | 'warn' | 'info' | 'neutral' } {
  if (e.kind === 'handed_in') return { text: 'New resignation', tone: 'warn' };
  if (e.kind === 'settlement') return { text: e.settlement === 'processed' ? 'Settlement processed' : 'Settlement pending', tone: 'info' };
  const d = e.daysLeft;
  if (d === null) return { text: 'Serving notice', tone: 'neutral' };
  if (d < 0) return { text: 'Last day passed', tone: 'bad' };
  if (d === 0) return { text: 'Last day today', tone: 'warn' };
  if (d === 1) return { text: '1 day left', tone: 'warn' };
  return { text: `${d} days left`, tone: 'neutral' };
}

/** "14 Kartik" / "5 Nov" — a date without its year, in the active calendar. */
export function formatDayMonth(key: string, system: CalendarSystem): string {
  const d = parseKey(key);
  if (!d) return key;
  if (system === 'AD') return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return NepaliDate.fromAD(d).format('D MMMM');
}

// --- data --------------------------------------------------------------------

/** Contracts ending soon, exits under way and birthdays coming up, for the top bar's bell.
 * Reloaded on every page change (so renewing a contract clears it as soon as
 * you leave the profile), when the tab comes back into view, and every half
 * hour — dates only move once a day, so there is no minute-by-minute polling.
 * The columns come from the HR-profile migration; until it has been run the
 * query fails and the panel simply has nothing to show. */
export function useHrAlerts(system: CalendarSystem, refreshKey: string) {
  const [rows, setRows] = useState<HrRow[]>([]);
  const [separations, setSeparations] = useState<SeparationRow[]>([]);
  const [today, setToday] = useState(startOfToday);

  useEffect(() => {
    if (!supabaseConfigured) return;
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
      // Exits not yet settled. Until the separation migration has been run this errors, and there is nothing to list.
      Promise.resolve(
        supabase.from('employee_separations').select('*, employee:employees(name, designation, profile_photo_url, status)').neq('settlement_status', 'completed')
      ).then(({ data, error }) => {
        if (active) setSeparations(error ? [] : ((data ?? []) as unknown as SeparationRow[]));
      });
    };
    load();
    const timer = setInterval(load, 30 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshKey]);

  return useMemo(
    () => ({ contracts: contractAlerts(rows, today), birthdays: upcomingBirthdays(rows, system, today), exits: exitAlerts(separations, today) }),
    [rows, separations, system, today]
  );
}
