'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { buildMonth, stepAnchor, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee } from '@/lib/types';
import { fetchMyCompanyWeekOffConfig, type RosterMode } from '@/lib/weekOff';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BATCH = 500;

type PatternRow = { employee_id: string; weekday: number; shift_id: string | null };

/** Fills a whole month of exact-date shifts (employee_daily_shifts) from the
 * company's recurring weekly pattern (employee_weekly_pattern) — one click
 * instead of rebuilding the same Sun–Sat pattern by hand every month.
 *
 * Each date's weekday looks up that employee's pattern for that weekday; an
 * employee with no pattern row for a given weekday leaves that date alone
 * (nothing to paste, not a Week Off). A month never divides evenly into
 * Sun–Sat weeks — its last week is simply cut short at the month's last
 * real day, which the preview grid below shows directly instead of stating
 * as a separate rule. */
export default function PasteWeeklyRosterDialog({
  open,
  onClose,
  initialAnchor,
  onPasted,
}: {
  open: boolean;
  onClose: () => void;
  initialAnchor: CalendarAnchor;
  onPasted: () => void;
}) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(initialAnchor);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [patternRows, setPatternRows] = useState<PatternRow[]>([]);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rosterMode, setRosterMode] = useState<RosterMode>('monthly');
  const [loading, setLoading] = useState(true);
  const [overwrite, setOverwrite] = useState<'replace' | 'keep'>('replace');
  const [switchToo, setSwitchToo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; monthLabel: string } | null>(null);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const monthDates = useMemo(() => month.weeks.flat().filter(c => c.inMonth), [month]);

  // Reset to the caller's month (and clear any leftover state from a
  // previous open) every time the dialog opens, rather than once on mount —
  // a plain component instance is reused across opens.
  useEffect(() => {
    if (!open) return;
    setAnchor(initialAnchor);
    setOverwrite('replace');
    setSwitchToo(false);
    setError(null);
    setDone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const start = monthDates[0]?.adKey;
    const end = monthDates[monthDates.length - 1]?.adKey;
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id'),
      start && end
        ? supabase.from('employee_daily_shifts').select('employee_id, work_date').gte('work_date', start).lte('work_date', end)
        : Promise.resolve({ data: [] as { employee_id: string; work_date: string }[] }),
      fetchMyCompanyWeekOffConfig(),
    ]).then(([empRes, patternRes, existingRes, config]) => {
      setEmployees(empRes.data ?? []);
      setPatternRows(patternRes.data ?? []);
      setExistingKeys(new Set((existingRes.data ?? []).map(r => `${r.employee_id}|${r.work_date}`)));
      setCompanyId(config.companyId);
      setRosterMode(config.rosterMode);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, month.label]);

  const patternByEmployeeWeekday = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of patternRows) map.set(`${r.employee_id}|${r.weekday}`, r.shift_id);
    return map;
  }, [patternRows]);

  const employeesWithPattern = useMemo(() => new Set(patternRows.map(r => r.employee_id)).size, [patternRows]);

  // Every (employee, date) this paste would actually write, given the
  // current Replace/Keep choice — computed up front so the dialog can show
  // a real count and disable Paste when there is nothing to do, rather than
  // discovering that only after the button is clicked.
  const plannedWrites = useMemo(() => {
    const out: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    for (const emp of employees) {
      for (const cell of monthDates) {
        const weekday = new Date(cell.adKey + 'T00:00:00Z').getUTCDay();
        const key = `${emp.id}|${weekday}`;
        if (!patternByEmployeeWeekday.has(key)) continue; // no pattern for this weekday — leave the date alone
        if (overwrite === 'keep' && existingKeys.has(`${emp.id}|${cell.adKey}`)) continue;
        out.push({ employee_id: emp.id, work_date: cell.adKey, shift_id: patternByEmployeeWeekday.get(key) ?? null });
      }
    }
    return out;
  }, [employees, monthDates, patternByEmployeeWeekday, overwrite, existingKeys]);

  const lastCell = monthDates[monthDates.length - 1];
  const lastWeekday = lastCell ? WEEKDAY_LABELS[new Date(lastCell.adKey + 'T00:00:00Z').getUTCDay()] : '';

  async function handlePaste() {
    if (plannedWrites.length === 0) return;
    setSaving(true);
    setError(null);
    for (let i = 0; i < plannedWrites.length; i += BATCH) {
      const { error: upsertError } = await supabase
        .from('employee_daily_shifts')
        .upsert(plannedWrites.slice(i, i + BATCH), { onConflict: 'employee_id,work_date' });
      if (upsertError) {
        setSaving(false);
        setError(upsertError.message);
        return;
      }
    }
    if (switchToo && rosterMode !== 'monthly' && companyId) {
      await supabase.from('companies').update({ roster_mode: 'monthly' }).eq('id', companyId);
    }
    setSaving(false);
    setDone({ count: plannedWrites.length, monthLabel: month.label });
    onPasted();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        {done ? (
          <>
            <h3 className="mb-2 text-lg font-semibold text-ink">Pasted into {done.monthLabel}</h3>
            <p className="mb-5 text-sm text-slate-600">
              {done.count} employee-day{done.count === 1 ? '' : 's'} set from the weekly pattern. Hand-edit any single day
              on the grid same as before.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-ink">Paste weekly roster into a month</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Each day of the month gets the shift from the same weekday of the Recurring Weekly pattern, for every
              employee it applies to.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="w-16 text-xs font-medium text-slate-600">Month</span>
              <button
                type="button"
                onClick={() => setAnchor(a => stepAnchor(system, a, -1))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50"
              >
                ←
              </button>
              <span className="min-w-[9rem] text-center text-sm font-semibold text-ink">{month.label}</span>
              <button
                type="button"
                onClick={() => setAnchor(a => stepAnchor(system, a, 1))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50"
              >
                →
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 p-2">
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAY_LABELS.map(l => (
                  <span key={l}>{l}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {month.weeks.flat().map((cell, i) => (
                  <span
                    key={i}
                    className={`flex h-7 items-center justify-center rounded-md text-xs font-semibold ${
                      cell.inMonth ? 'bg-good-bg text-good-text' : 'bg-slate-50 text-slate-300'
                    }`}
                  >
                    {cell.displayDay}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {monthDates.length} days · last week ends <strong className="text-ink">{lastWeekday} {lastCell?.displayDay}</strong>
                {' — the rest of that week belongs to the next month and is left alone.'}
              </p>
            </div>

            <fieldset className="mt-4 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-xs font-medium text-slate-600">If a day already has a shift</legend>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" checked={overwrite === 'replace'} onChange={() => setOverwrite('replace')} className="text-accent" />
                Replace it with the weekly roster
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" checked={overwrite === 'keep'} onChange={() => setOverwrite('keep')} className="text-accent" />
                Keep it, only fill empty days
              </label>
            </fieldset>

            {rosterMode !== 'monthly' && (
              <label className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                <input
                  type="checkbox"
                  checked={switchToo}
                  onChange={e => setSwitchToo(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-accent"
                />
                <span>
                  Also switch to the <strong className="text-ink">Monthly Roster</strong> now. Otherwise the pasted month
                  is saved but not used for attendance until you switch.
                </span>
              </label>
            )}

            <p className="mt-4 text-xs text-slate-500">
              {loading
                ? 'Loading…'
                : employeesWithPattern === 0
                  ? 'No one has a Recurring Weekly pattern set yet — set one on the Weekly Roster first.'
                  : `Will set ${plannedWrites.length} employee-day${plannedWrites.length === 1 ? '' : 's'}, from ${employeesWithPattern} employee${
                      employeesWithPattern === 1 ? '' : 's'
                    } with a weekly pattern.`}
            </p>

            {error && <p className="mt-3 text-sm text-critical">Could not paste: {error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePaste}
                disabled={saving || loading || plannedWrites.length === 0}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Pasting…' : `Paste into ${month.label.split(' ')[0]} (${monthDates.length} days)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
