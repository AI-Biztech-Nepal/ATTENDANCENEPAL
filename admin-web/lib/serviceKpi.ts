import NepaliDate from 'nepali-date-converter';
import type { CalendarSystem } from './calendar';
import { addDays } from './taskSchedule';

// KPI 2, services performed. The numbers come from service_records, which the Import section fills from the
// company's booking file. Plain code with no network, so it can be tested on its own; useServiceKpi.ts reads the rows.

/** How many services each person performed, from rows of `{ employee_id }`. */
export function countByEmployee(rows: { employee_id: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.employee_id, (out.get(r.employee_id) ?? 0) + 1);
  return out;
}

/** The day of the month and the month's name for an AD date key, in the calendar being shown. */
export function dayAndMonth(adKey: string, system: CalendarSystem): { day: number; month: string } {
  const [y, m, d] = adKey.split('-').map(Number);
  if (system === 'BS') {
    const n = NepaliDate.fromAD(new Date(y, m - 1, d));
    return { day: n.getDate(), month: n.format('MMMM') };
  }
  return { day: d, month: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) };
}

export type WeekBar = {
  from: string;
  to: string;
  /** "1–7 Nov", "29 Nov", or "22 Nov, today". */
  label: string;
  value: number;
  /** The week that is still going: its bar is drawn pale, because it will grow. */
  partial: boolean;
};

/**
 * One bar per week of the month `start`..`end` (AD date keys): the first seven days, the next seven, and so on, the
 * last one shorter. Weeks that have not begun are left out. The week that holds today is marked `partial`
 * while the month is still going. `dates` are the days (AD date keys) the services were performed on.
 */
export function weekBars(dates: string[], start: string, end: string, today: string, system: CalendarSystem): WeekBar[] {
  const bars: WeekBar[] = [];
  for (let from = start; from <= end; from = addDays(from, 7)) {
    if (from > today) break;
    const to = addDays(from, 6) < end ? addDays(from, 6) : end;
    const a = dayAndMonth(from, system);
    const b = dayAndMonth(to, system);
    const partial = from <= today && today <= to && today <= end;
    const label = partial && from === today ? `${a.day} ${a.month}, today` : from === to ? `${a.day} ${a.month}` : `${a.day}–${b.day} ${b.month}`;
    bars.push({ from, to, label, value: dates.filter(d => d >= from && d <= to).length, partial });
  }
  return bars;
}

/** A tidy top for a bar chart's axis: three equal steps of 1, 2 or 5 (times a power of ten) that hold `max`. A step is
 * never less than 1, because these are counts. */
export function niceScale(max: number): { max: number; ticks: number[] } {
  const raw = Math.max(max, 3) / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  return { max: step * 3, ticks: [0, step, step * 2, step * 3] };
}

export const serviceWord = (n: number) => (n === 1 ? 'service' : 'services');
