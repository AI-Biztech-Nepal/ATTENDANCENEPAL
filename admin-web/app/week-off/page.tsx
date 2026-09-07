'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import DatePicker from '@/components/DatePicker';
import ComboBox from '@/components/ComboBox';
import { useConfirm } from '@/components/ConfirmDialog';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { buildMonth, formatAdDate, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { datesInRange, fetchUpcomingHolidays, type PredefinedHoliday } from '@/lib/nepalHolidays';
import type { CompanyHoliday, HolidayScope } from '@/lib/types';

const SCOPE_OPTIONS: { value: HolidayScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];
const SCOPE_LABEL: Record<HolidayScope, string> = { all: 'All', male: 'Male', female: 'Female' };

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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

export default function WeekOffPage() {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(todayAnchor);

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

  return (
    <AppShell title="Holidays">
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        Holiday dates — treated as a paid day in Payroll. &ldquo;Applies to&rdquo; is <span className="font-medium">All</span> by default, or
        set it to <span className="font-medium">Male</span> / <span className="font-medium">Female</span> for a gender-specific holiday like Teej.
        Every holiday stays fully editable — use <span className="font-medium">Edit</span> to change its name, date or scope. Distinct from
        assigning one employee a Week Off on the Shifts page&apos;s Weekly Roster.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAnchor(a => stepAnchor(system, a, -1))}
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-ink">{month.label}</span>
            <button
              type="button"
              onClick={() => setAnchor(a => stepAnchor(system, a, 1))}
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
            {WEEKDAY_LABELS.map(w => (
              <span key={w}>{w}</span>
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
                  className={`flex h-9 w-9 flex-col items-center justify-center rounded-lg text-xs transition-colors ${
                    !cell.inMonth
                      ? 'cursor-default text-slate-300'
                      : holiday
                        ? 'bg-accent font-semibold text-white hover:bg-accent/90'
                        : cell.isToday
                          ? 'bg-accent/10 font-semibold text-accent hover:bg-accent/20'
                          : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cell.displayDay}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setAnchor(todayAnchor())}
            className="mt-3 w-full text-center text-[11px] font-medium text-accent hover:underline"
          >
            Back to today
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Holidays</h2>
            <button
              onClick={() => {
                setForm(EMPTY_FORM);
                setShowForm(true);
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
            >
              + New Holiday
            </button>
          </div>
          <HorizontalScrollButtons targetRef={tableScrollRef} />
          <div ref={tableScrollRef} className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">Date</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">Name</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">Applies to</th>
                  <th className="whitespace-nowrap py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {holidays.map(h => (
                  <tr key={h.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{formatAdDate(h.holiday_date, system)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 font-medium text-ink">{h.name}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4">
                      {h.applies_to === 'all' ? (
                        <span className="text-slate-400">All</span>
                      ) : (
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                          {SCOPE_LABEL[h.applies_to]}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right">
                      <button onClick={() => editHoliday(h)} className="mr-3 text-xs font-medium text-accent hover:underline">
                        Edit
                      </button>
                      <button onClick={() => handleDeleteHoliday(h.id)} className="text-xs font-medium text-critical hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && holidays.length === 0 && <p className="py-4 text-sm text-slate-400">No holidays added yet.</p>}
          </div>
        </div>
      </div>

      {showForm && (() => {
        const isEditing = !!form.id;
        const dateCollision = holidaysByDate.get(form.holiday_date);
        const collidesWithOther = !!dateCollision && dateCollision.id !== form.id;
        return (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
            <form onSubmit={handleAddHoliday} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
              <h3 className="mb-4 text-lg font-semibold text-ink">{isEditing ? 'Edit Holiday' : 'New Holiday'}</h3>
              <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
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
              <p className="mb-3 text-[11px] text-slate-400">Pick a suggestion for this year&apos;s government holidays, or type your own.</p>
              <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
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
                <p className="mb-3 text-xs font-medium text-accent">
                  Spans {datesInRange(form.holiday_date, form.holiday_end_date).length} days: {formatAdDate(form.holiday_date, system)} –{' '}
                  {formatAdDate(form.holiday_end_date, system)}
                </p>
              )}

              <label className="mb-1 block text-xs font-medium text-slate-600">Applies to</label>
              <select
                value={form.applies_to}
                onChange={e => setForm(f => ({ ...f, applies_to: e.target.value as HolidayScope }))}
                className="mb-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {SCOPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mb-3 text-[11px] text-slate-400">
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
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.holiday_date || (isEditing && collidesWithOther)}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add holiday'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}
    </AppShell>
  );
}
