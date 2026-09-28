import { supabase } from './supabase';

export type PredefinedHoliday = {
  name: string;
  /** AD date, 'YYYY-MM-DD' — first day of the holiday. */
  start: string;
  /** AD date, 'YYYY-MM-DD' — last day of the holiday (same as start if it's a single day). */
  end: string;
};

/** Every date 'YYYY-MM-DD' from start to end inclusive. */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Holidays whose last day hasn't passed yet, soonest first — what the New
 * Holiday form's Name suggestions should show. Reads `nepal_public_holidays`,
 * a live mirror of hamropatro.com's Nepal government public holiday
 * calendar kept fresh by a daily scrape (supabase/functions/sync-nepal-
 * holidays, see that function's README) rather than a hardcoded list —
 * Nepali festival dates are lunar/panchang-based and shift every BS year,
 * so there's no way to compute or predict them, only pull them from a real
 * published calendar on a schedule. This is why the table (and this
 * function) isn't scoped to one BS year: whatever year the scrape most
 * recently found is whatever shows up here, so it carries over to a new BS
 * year on its own once that year's holidays are published, instead of
 * getting stuck on whichever year the code happened to be written in. */
export async function fetchUpcomingHolidays(todayIso: string): Promise<PredefinedHoliday[]> {
  const { data, error } = await supabase
    .from('nepal_public_holidays')
    .select('name, start_date, end_date')
    .gte('end_date', todayIso)
    .order('start_date', { ascending: true });
  if (error || !data) return [];
  return data.map(h => ({ name: h.name, start: h.start_date, end: h.end_date }));
}
