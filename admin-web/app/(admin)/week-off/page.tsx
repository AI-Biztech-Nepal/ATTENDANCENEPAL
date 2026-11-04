'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import DatePicker from '@/components/DatePicker';
import ComboBox from '@/components/ComboBox';
import { useConfirm } from '@/components/ConfirmDialog';
import { buildMonth, formatAdDate, stepAnchor, todayAnchor, type CalendarSystem } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { datesInRange, fetchUpcomingHolidays, type PredefinedHoliday } from '@/lib/nepalHolidays';
import type { CompanyHoliday, HolidayScope } from '@/lib/types';

const SCOPE_OPTIONS: { value: HolidayScope; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];
const SCOPE_LABEL: Record<HolidayScope, string> = { all: 'Everyone', male: 'Male only', female: 'Female only' };
const SCOPE_CHIP: Record<HolidayScope, string> = {
  all: 'text-slate-500',
  male: 'rounded-full bg-info-bg px-2 py-0.5 text-info-text',
  female: 'rounded-full bg-pink-50 px-2 py-0.5 text-pink-700',
};

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SUGGESTIONS_SHOWN = 5;

// `id` is set only when EDITING an existing holiday row — then handleAddHoliday
// updates that row in place (name, date and scope are all editable, and the
// date can be moved to a free day). Blank `id` means a new holiday.
// holiday_end_date only travels with the form while a predefined multi-day
// pick (Dashain, Tihar, ...) is active — it's what makes handleAddHoliday
// write one row per day in the range instead of just holiday_date. It's
// blanked back out the moment the date is hand-edited away from that pick's
// start day, or the name no longer matches a predefined entry at all.
const EMPTY_FORM = { id: '', holiday_date: '', holiday_end_date: '', name: '', applies_to: 'all' as HolidayScope };

// Best-effort: the Edge Function that actually sends push notifications is
// separate infrastructure (needs an Expo/EAS project + `supabase functions
// deploy`, both requiring credentials this app doesn't have) — until that's
// deployed, this call harmlessly no-ops (Supabase returns a "not found"
// error for an undeployed function, which we swallow rather than blocking
// the admin's save).
async function notifyWeekOffChange() {
  try {
    await supabase.functions.invoke('notify-week-off');
  } catch {
    // Not deployed yet — see supabase/functions/notify-week-off/README.md.
  }
}

// ---- date helpers (AD keys in, text in the active calendar out) ---------------------------------------------------
function addDay(key: string, n = 1) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
/** The day number shown on a date badge, in the active calendar. */
function dayNumber(key: string, system: CalendarSystem) {
  return system === 'BS' ? formatAdDate(key, 'BS').split(' ')[0] : String(Number(key.slice(8, 10)));
}
function monthShort(key: string, system: CalendarSystem) {
  if (system === 'BS') return (formatAdDate(key, 'BS').split(' ')[1] ?? '').slice(0, 3).toUpperCase();
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
}
/** "Kartik 2083" / "November 2026" — what a month group in the list is called. */
function monthGroupLabel(key: string, system: CalendarSystem) {
  if (system === 'BS') {
    const [, month, year] = formatAdDate(key, 'BS').split(' ');
    return `${month} ${year}`;
  }
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function yearOf(key: string, system: CalendarSystem) {
  return system === 'BS' ? formatAdDate(key, 'BS').split(' ')[2] : key.slice(0, 4);
}
function weekdayName(key: string, style: 'long' | 'short' = 'long') {
  return new Date(key + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: style, timeZone: 'UTC' });
}
/** The same date in the calendar that is not showing — a quiet second line under each holiday. */
function otherCalendarDate(key: string, system: CalendarSystem) {
  try {
    return formatAdDate(key, system === 'AD' ? 'BS' : 'AD');
  } catch {
    return '';
  }
}
function whenLabel(daysAway: number) {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return `In ${daysAway} days`;
}

type Run = { index: number; length: number; start: string; end: string };

export default function WeekOffPage() {
  usePageTitle('Holidays');
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const nextRowRef = useRef<HTMLDivElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(todayAnchor);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  function reload() {
    supabase
      .from('company_holidays')
      .select('*')
      .order('holiday_date', { ascending: true })
      .then(({ data }) => {
        setHolidays(data ?? []);
        setLoading(false);
      });
  }
  useEffect(reload, []);

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, CompanyHoliday>();
    for (const h of holidays) map.set(h.holiday_date, h);
    return map;
  }, [holidays]);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);

  // "Today" for the predefined-holiday suggestions, re-checked once a day
  // rather than only read once at mount — an admin panel left open for
  // multiple days would otherwise keep suggesting a holiday that already
  // passed until the page is manually reloaded.
  const [today, setToday] = useState(nepalTodayIso);
  useEffect(() => {
    const id = setInterval(() => setToday(nepalTodayIso()), 24 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Suggestions for the Name field's datalist — every predefined Nepal
  // public holiday whose last day hasn't passed yet, soonest first. Pulled
  // live from nepal_public_holidays (a daily hamropatro.com scrape, see
  // lib/nepalHolidays.ts) rather than anything bundled with the app, so it
  // carries over to a new BS year on its own once that year's holidays are
  // actually published — nothing here needs updating when that happens.
  const [upcoming, setUpcoming] = useState<PredefinedHoliday[]>([]);
  useEffect(() => {
    fetchUpcomingHolidays(today).then(setUpcoming);
  }, [today]);
  const predefinedByName = useMemo(() => new Map(upcoming.map(h => [h.name, h])), [upcoming]);

  // The government holidays this company has not put on its calendar yet — shown as one-tap chips.
  const notAddedYet = useMemo(() => upcoming.filter(h => !holidaysByDate.has(h.start)), [upcoming, holidaysByDate]);

  // A festival is saved one row per day, all with the same name and scope: consecutive days like that form a "run",
  // so the list can say "Day 2 of 5" and the banner "5-day holiday" while edit/delete still act on a single day.
  const runs = useMemo(() => {
    const info = new Map<string, Run>();
    let i = 0;
    while (i < holidays.length) {
      let j = i;
      while (
        j + 1 < holidays.length &&
        holidays[j + 1].name === holidays[i].name &&
        holidays[j + 1].applies_to === holidays[i].applies_to &&
        addDay(holidays[j].holiday_date) === holidays[j + 1].holiday_date
      ) {
        j++;
      }
      for (let k = i; k <= j; k++) {
        info.set(holidays[k].id, { index: k - i + 1, length: j - i + 1, start: holidays[i].holiday_date, end: holidays[j].holiday_date });
      }
      i = j + 1;
    }
    return info;
  }, [holidays]);

  const nextHoliday = useMemo(() => holidays.find(h => h.holiday_date >= today) ?? null, [holidays, today]);
  const comingUp = useMemo(() => holidays.filter(h => h.holiday_date >= today).length, [holidays, today]);
  const thisYear = useMemo(() => holidays.filter(h => yearOf(h.holiday_date, system) === yearOf(today, system)).length, [holidays, today, system]);

  // The list is grouped by month, in the calendar the page is showing.
  const groups = useMemo(() => {
    const out: { label: string; items: CompanyHoliday[] }[] = [];
    for (const h of holidays) {
      const label = monthGroupLabel(h.holiday_date, system);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(h);
      else out.push({ label, items: [h] });
    }
    return out;
  }, [holidays, system]);

  // Open the list at the next holiday rather than at the oldest one on record.
  useEffect(() => {
    const box = listRef.current;
    const row = nextRowRef.current;
    if (!box || !row) return;
    // The box is the row's offset parent, so offsetTop is already measured from the box's top; leave room for
    // the sticky month heading above the row.
    const heading = box.querySelector('h3');
    box.scrollTop = Math.max(0, row.offsetTop - (heading ? heading.offsetHeight : 40));
  }, [loading, nextHoliday?.id]);

  function openNew(prefill?: Partial<typeof EMPTY_FORM>) {
    setForm({ ...EMPTY_FORM, ...prefill });
    setShowForm(true);
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!form.holiday_date || !form.name.trim()) return;
    setSaving(true);
    const name = form.name.trim();

    // Editing an existing row: update it in place — name, date and scope are
    // all editable. Multi-day range picks don't apply when editing a single
    // saved holiday.
    if (form.id) {
      const { error } = await supabase
        .from('company_holidays')
        .update({ holiday_date: form.holiday_date, name, applies_to: form.applies_to })
        .eq('id', form.id);
      setSaving(false);
      if (error) {
        alert(error.code === '23505' ? 'Another holiday already exists on that date.' : `Could not save: ${error.message}`);
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      reload();
      notifyWeekOffChange();
      return;
    }

    // A predefined multi-day pick (Dashain, Tihar, ...) writes one row per
    // day in its range, all sharing the same name — a plain single-day pick
    // (custom name, or a predefined one-day holiday) is just the one row,
    // same as before. Upsert instead of insert either way: clicking an
    // already-marked calendar day pre-fills its date, so re-submitting that
    // day renames it instead of hitting the (company_id, holiday_date)
    // unique constraint.
    const dates =
      form.holiday_end_date && form.holiday_end_date > form.holiday_date
        ? datesInRange(form.holiday_date, form.holiday_end_date)
        : [form.holiday_date];
    const { error } = await supabase
      .from('company_holidays')
      .upsert(
        dates.map(holiday_date => ({ holiday_date, name, applies_to: form.applies_to })),
        { onConflict: 'company_id,holiday_date' }
      );
    setSaving(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
    notifyWeekOffChange();
  }

  function editHoliday(h: CompanyHoliday) {
    setForm({ id: h.id, holiday_date: h.holiday_date, holiday_end_date: '', name: h.name, applies_to: h.applies_to });
    setShowForm(true);
  }

  async function handleDeleteHoliday(id: string) {
    if (!(await confirm('Delete this holiday?', { title: 'Delete holiday?', confirmLabel: 'Delete', tone: 'danger' }))) return;
    const { error } = await supabase.from('company_holidays').delete().eq('id', id);
    if (error) alert(`Couldn't delete: ${error.message}`);
    reload();
  }

  const nextRun = nextHoliday ? runs.get(nextHoliday.id) : undefined;
  const nextDaysAway = nextHoliday ? Math.max(0, daysBetween(today, nextHoliday.holiday_date)) : 0;
  const visibleSuggestions = showAllSuggestions ? notAddedYet : notAddedYet.slice(0, SUGGESTIONS_SHOWN);

  return (
    <div className="space-y-5">
      {/* The next holiday, and the way to add one. */}
      <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-[18px] border border-[#d5e6dc] bg-[linear-gradient(135deg,#e6f4ec_0%,#f3faf6_55%,#ffffff_100%)] px-6 py-5 shadow-[0_1px_2px_rgba(6,78,59,0.04),0_8px_24px_-14px_rgba(6,78,59,0.22)]">
        <div className="min-w-0">
          {loading ? (
            <div className="h-8 w-56 animate-pulse rounded-lg bg-white/70" />
          ) : nextHoliday ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-brand-deep">{nextHoliday.name}</h2>
                <span className="rounded-full bg-brand px-2.5 py-1 text-[13px] font-extrabold text-white">Next · {whenLabel(nextDaysAway).toLowerCase()}</span>
                {nextHoliday.applies_to !== 'all' && (
                  <span className={`text-xs font-bold ${SCOPE_CHIP[nextHoliday.applies_to]}`}>{SCOPE_LABEL[nextHoliday.applies_to]}</span>
                )}
              </div>
              <p className="mt-1 text-sm font-semibold text-[#586474]">
                {weekdayName(nextHoliday.holiday_date)}, {formatAdDate(nextHoliday.holiday_date, system)}
                {nextRun && nextRun.length > 1 && (
                  <>
                    {' '}
                    – {formatAdDate(nextRun.end, system)} · {nextRun.length}-day holiday
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-brand-deep">No upcoming holidays</h2>
              <p className="mt-1 text-sm font-semibold text-[#586474]">Add one, or pick from the government holidays below.</p>
            </>
          )}
          {!loading && holidays.length > 0 && (
            <p className="mt-2 text-[13px] font-semibold text-[#586474]">
              {thisYear} {thisYear === 1 ? 'holiday' : 'holidays'} this year · {comingUp} still to come
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => openNew()}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-brand/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <PlusIcon className="h-4 w-4" />
          New holiday
        </button>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        {/* On a phone the wrapper disappears (display: contents) so the three cards can be ordered calendar, holidays, suggestions; from lg up it is the left column. */}
        <div className="contents lg:block lg:min-w-0 lg:space-y-5">
          <section aria-label="Calendar" className="order-1 rounded-[18px] border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setAnchor(a => stepAnchor(system, a, -1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-ink"
              >
                <ChevronIcon className="h-4 w-4" dir="left" />
              </button>
              <span className="text-[15px] font-extrabold text-ink">{month.label}</span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setAnchor(a => stepAnchor(system, a, 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-ink"
              >
                <ChevronIcon className="h-4 w-4" dir="right" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500">
              {WEEKDAY_LABELS.map(w => (
                <span key={w} className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {month.weeks.flat().map((cell, i) => {
                const holiday = holidaysByDate.get(cell.adKey);
                return (
                  <button
                    key={`${cell.adKey}-${i}`}
                    type="button"
                    disabled={!cell.inMonth}
                    title={holiday?.name}
                    aria-label={holiday ? `${cell.displayDay}, ${holiday.name}` : String(cell.displayDay)}
                    onClick={() => {
                      setForm({
                        id: holiday?.id ?? '',
                        holiday_date: cell.adKey,
                        holiday_end_date: '',
                        name: holiday?.name ?? '',
                        applies_to: holiday?.applies_to ?? 'all',
                      });
                      setShowForm(true);
                    }}
                    className={`flex h-11 items-center justify-center rounded-xl text-sm transition-colors ${
                      !cell.inMonth
                        ? 'cursor-default text-slate-300'
                        : holiday
                          ? `bg-brand font-extrabold text-white hover:bg-brand/90 ${cell.isToday ? 'ring-2 ring-brand/40 ring-offset-2' : ''}`
                          : cell.isToday
                            ? 'bg-brand-light font-extrabold text-brand ring-1 ring-inset ring-brand/30 hover:bg-brand-light/70'
                            : 'font-semibold text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {cell.displayDay}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <span className="flex items-center gap-3 text-xs font-semibold text-[#586474]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[4px] bg-brand" />
                  Holiday
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[4px] bg-brand-light ring-1 ring-inset ring-brand/40" />
                  Today
                </span>
              </span>
              <button
                type="button"
                onClick={() => setAnchor(todayAnchor())}
                className="text-xs font-extrabold text-brand hover:underline"
              >
                Back to today
              </button>
            </div>
          </section>

          {/* This year's government holidays that are not on the calendar yet: one tap opens the form filled in. */}
          {notAddedYet.length > 0 && (
            <section aria-label="Government holidays not added yet" className="order-3 rounded-[18px] border border-slate-200 bg-white p-5">
              <h2 className="text-base font-extrabold text-ink">Government holidays not added yet</h2>
              <p className="mt-0.5 text-xs font-semibold text-[#586474]">Tap one to add it with its dates.</p>
              <div className="mt-3 flex flex-col gap-2">
                {visibleSuggestions.map(h => (
                  <button
                    key={`${h.name}-${h.start}`}
                    type="button"
                    onClick={() => openNew({ name: h.name, holiday_date: h.start, holiday_end_date: h.end })}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand/40 hover:bg-brand-light/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
                      <PlusIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-ink">{h.name}</span>
                      <span className="block truncate text-xs font-semibold text-[#586474]">
                        {h.start === h.end ? formatAdDate(h.start, system) : `${formatAdDate(h.start, system)} – ${formatAdDate(h.end, system)}`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {notAddedYet.length > SUGGESTIONS_SHOWN && (
                <button
                  type="button"
                  onClick={() => setShowAllSuggestions(v => !v)}
                  className="mt-3 text-[13px] font-extrabold text-brand hover:underline"
                >
                  {showAllSuggestions ? 'Show fewer' : `Show ${notAddedYet.length - SUGGESTIONS_SHOWN} more`}
                </button>
              )}
            </section>
          )}
        </div>

        <section aria-label="All holidays" className="order-2 min-w-0 rounded-[18px] border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-extrabold text-ink">All holidays</h2>
            {!loading && holidays.length > 0 && <span className="text-xs font-bold text-[#586474]">{holidays.length} days</span>}
          </div>
          <div ref={listRef} className="relative max-h-[640px] overflow-y-auto px-2 pb-2">
            {loading && (
              <div className="space-y-3 p-3" aria-hidden="true">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="flex animate-pulse items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-slate-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-1/3 rounded bg-slate-100" />
                      <div className="h-3 w-1/4 rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && holidays.length === 0 && (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-bold text-ink">No holidays added yet</p>
                <p className="mt-1 text-sm text-slate-500">Add your first one, or pick from the government holidays below.</p>
                <button
                  type="button"
                  onClick={() => openNew()}
                  className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-extrabold text-white hover:bg-brand/90"
                >
                  New holiday
                </button>
              </div>
            )}
            {groups.map(group => (
              <div key={group.label}>
                <h3 className="sticky top-0 z-[1] bg-white/95 px-3 pb-1.5 pt-4 text-xs font-extrabold tracking-[0.04em] text-[#586474] backdrop-blur-sm">
                  {group.label}
                </h3>
                {group.items.map(h => {
                  const run = runs.get(h.id);
                  const daysAway = daysBetween(today, h.holiday_date);
                  const passed = daysAway < 0;
                  const isNext = nextHoliday?.id === h.id;
                  return (
                    <div
                      key={h.id}
                      ref={isNext ? nextRowRef : undefined}
                      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50 focus-within:bg-slate-50 ${passed ? 'opacity-60' : ''}`}
                    >
                      <span
                        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none ${
                          passed ? 'bg-slate-100 text-slate-500' : 'bg-brand-light text-brand-deep'
                        }`}
                      >
                        <span className="text-lg font-extrabold">{dayNumber(h.holiday_date, system)}</span>
                        <span className="mt-0.5 text-[10px] font-bold tracking-wide">{monthShort(h.holiday_date, system)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="truncate text-sm font-bold text-ink">{h.name}</span>
                          {run && run.length > 1 && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-[#586474]">
                              Day {run.index} of {run.length}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs font-semibold text-[#586474]">
                          {weekdayName(h.holiday_date, 'short')}
                          {otherCalendarDate(h.holiday_date, system) && ` · ${otherCalendarDate(h.holiday_date, system)}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1 text-xs font-bold">
                        <span className={SCOPE_CHIP[h.applies_to]}>{SCOPE_LABEL[h.applies_to]}</span>
                        {!passed && <span className="text-brand">{whenLabel(daysAway)}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => editHoliday(h)}
                          aria-label={`Edit ${h.name}`}
                          title="Edit"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-brand hover:shadow-sm"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHoliday(h.id)}
                          aria-label={`Delete ${h.name}`}
                          title="Delete"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-critical hover:shadow-sm"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>

      {showForm && (() => {
        const isEditing = !!form.id;
        const dateCollision = holidaysByDate.get(form.holiday_date);
        const collidesWithOther = !!dateCollision && dateCollision.id !== form.id;
        return (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
            <form
              onSubmit={handleAddHoliday}
              role="dialog"
              aria-modal="true"
              aria-label={isEditing ? 'Edit holiday' : 'New holiday'}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg"
            >
              <h3 className="mb-4 text-lg font-extrabold text-ink">{isEditing ? 'Edit holiday' : 'New holiday'}</h3>
              <label className="mb-1 block text-xs font-bold text-slate-600">Name</label>
              <div className="mb-1">
                <ComboBox
                  value={form.name}
                  placeholder="e.g. Dashain"
                  onChange={name => {
                    const predefined = predefinedByName.get(name);
                    setForm(f => ({
                      ...f,
                      name,
                      holiday_date: predefined ? predefined.start : f.holiday_date,
                      holiday_end_date: predefined ? predefined.end : '',
                    }));
                  }}
                  options={upcoming.map(h => ({
                    label: h.name,
                    sub: h.start === h.end ? formatAdDate(h.start, system) : `${formatAdDate(h.start, system)} – ${formatAdDate(h.end, system)}`,
                  }))}
                />
              </div>
              {/* Suggestions are this year's government-gazetted public
                  holidays (kept fresh by a daily scrape, see
                  lib/nepalHolidays.ts), soonest first — picking one fills in
                  its date (and, for a multi-day festival like Dashain/Tihar,
                  its whole span) below. */}
              <p className="mb-3 text-[11px] text-slate-500">Pick a suggestion for this year&apos;s government holidays, or type your own.</p>
              <label className="mb-1 block text-xs font-bold text-slate-600">Date</label>
              <div className="mb-1">
                <DatePicker
                  value={form.holiday_date}
                  onChange={v =>
                    setForm(f => ({
                      ...f,
                      holiday_date: v,
                      // Hand-editing the date breaks the link to whatever
                      // predefined range was picked — falls back to a plain
                      // single day instead of silently keeping a stale range.
                      holiday_end_date: predefinedByName.get(f.name)?.start === v ? f.holiday_end_date : '',
                    }))
                  }
                />
              </div>
              {form.holiday_end_date && form.holiday_end_date > form.holiday_date && (
                <p className="mb-3 text-xs font-bold text-brand">
                  Spans {datesInRange(form.holiday_date, form.holiday_end_date).length} days: {formatAdDate(form.holiday_date, system)} –{' '}
                  {formatAdDate(form.holiday_end_date, system)}
                </p>
              )}

              <span id="holiday-applies-to" className="mb-1 mt-2 block text-xs font-bold text-slate-600">
                Applies to
              </span>
              <div role="radiogroup" aria-labelledby="holiday-applies-to" className="mb-1 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                {SCOPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={form.applies_to === opt.value}
                    onClick={() => setForm(f => ({ ...f, applies_to: opt.value }))}
                    className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                      form.applies_to === opt.value ? 'bg-white text-brand-deep shadow-sm' : 'text-slate-600 hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mb-3 text-[11px] text-slate-500">
                Choose &ldquo;Male&rdquo; or &ldquo;Female&rdquo; for a gender-specific holiday (e.g. Teej) — it&rsquo;s a paid day off just for
                those employees, and everyone else works a normal day. Employees with no gender set always work a normal day on a gendered holiday.
              </p>

              {collidesWithOther && (
                <p className="mb-3 text-xs text-warning-text">
                  {isEditing
                    ? `“${dateCollision!.name}” is already on this date — pick a free day.`
                    : `This date already has “${dateCollision!.name}” — saving will overwrite it.`}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.holiday_date || (isEditing && collidesWithOther)}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-extrabold text-white hover:bg-brand/90 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add holiday'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ChevronIcon({ className, dir }: { className?: string; dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}
function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
