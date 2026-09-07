'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import RosterModeSwitch from '@/components/RosterModeSwitch';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { useConfirm } from '@/components/ConfirmDialog';
import type { Employee, Shift } from '@/lib/types';
import type { RosterMode } from '@/lib/weekOff';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Same UNSET / Week-Off sentinel convention as WeeklyRosterGrid /
 * MonthlyRosterGrid, just keyed by weekday (0-6) instead of an exact date —
 * see employee_weekly_pattern's design (20260818100000_employee_weekly_pattern.sql). */
const UNSET = 'unset';
const WEEK_OFF_VALUE = 'week-off';

type PatternRow = { employee_id: string; weekday: number; shift_id: string | null };

/** The weekly-mode roster editor: one row per employee, Sun-Sat columns, no
 * date navigation — a pick here applies to every coming week automatically
 * (see resolveShiftForDate() in lib/shift.ts), so unlike WeeklyRosterGrid
 * there's no "copy this week to the rest of the month" button and no week
 * paging; the pattern already covers every future week on its own. */
export default function WeeklyPatternGrid({
  companyId,
  rosterMode,
  onRosterModeChange,
}: {
  companyId: string | null;
  rosterMode: RosterMode;
  onRosterModeChange: (mode: RosterMode) => void;
}) {
  const confirm = useConfirm();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [patternRows, setPatternRows] = useState<PatternRow[]>([]);
  const [loading, setLoading] = useState(true);
  // "employeeId|weekday" -> a real shift_id, WEEK_OFF_VALUE, or UNSET —
  // staged here until Save is clicked, not written on every pick.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Clipboard-style copy/paste between employees: Copy marks a source
  // employee, then Paste on any other employee's row writes that source's
  // whole Sun-Sat pattern onto them immediately — no modal, no separate
  // Save step. Stays set across multiple pastes so one Copy can go out to
  // several employees one click at a time.
  const [copiedEmployeeId, setCopiedEmployeeId] = useState<string | null>(null);
  const [pastingEmployeeId, setPastingEmployeeId] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const shiftById = useMemo(() => new Map(templateShifts.map(s => [s.id, s])), [templateShifts]);
  const weekdays = [0, 1, 2, 3, 4, 5, 6];

  function reload() {
    setLoading(true);
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('shifts').select('*'),
      supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id'),
    ]).then(([empRes, shiftsRes, patternRes]) => {
      setEmployees((empRes.data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      setShifts(shiftsRes.data ?? []);
      setPatternRows(patternRes.data ?? []);
      setLoading(false);
    });
  }
  useEffect(reload, []);

  function currentValue(employeeId: string, weekday: number): string {
    const key = `${employeeId}|${weekday}`;
    if (key in pending) return pending[key];
    const row = patternRows.find(r => r.employee_id === employeeId && r.weekday === weekday);
    if (!row) return UNSET;
    return row.shift_id === null ? WEEK_OFF_VALUE : row.shift_id;
  }

  function setCell(employeeId: string, weekday: number, value: string) {
    setPending(p => ({ ...p, [`${employeeId}|${weekday}`]: value }));
  }

  // Writes the copied employee's whole Sun-Sat pattern onto `targetId`
  // straight to Supabase — but only after an explicit confirm, so nothing
  // changes without the admin actually saying so. Only a source weekday
  // that actually has a pick (not —) writes anything, leaving whatever's
  // already on that target weekday alone. Also drops any of the target's
  // own still-unsaved manual picks on the weekdays just written, so the
  // grid doesn't keep showing a stale pending value that no longer matches
  // what Paste just saved underneath it.
  async function pasteToEmployee(targetId: string) {
    if (!copiedEmployeeId || copiedEmployeeId === targetId) return;
    const sourceName = employees.find(e => e.id === copiedEmployeeId)?.name ?? 'the copied employee';
    const targetName = employees.find(e => e.id === targetId)?.name ?? 'this employee';
    const proceed = await confirm(
      `Paste ${sourceName}'s pattern onto ${targetName}? This overwrites their matching weekdays right away.`,
      { title: 'Overwrite weekly pattern?', confirmLabel: 'Overwrite', tone: 'danger' }
    );
    if (!proceed) return;
    setPastingEmployeeId(targetId);
    setPasteError(null);
    const upserts: { employee_id: string; weekday: number; shift_id: string | null }[] = [];
    for (const weekday of weekdays) {
      const value = currentValue(copiedEmployeeId, weekday);
      if (value !== UNSET) upserts.push({ employee_id: targetId, weekday, shift_id: value === WEEK_OFF_VALUE ? null : value });
    }
    if (upserts.length === 0) {
      setPastingEmployeeId(null);
      return;
    }
    const { error } = await supabase.from('employee_weekly_pattern').upsert(upserts, { onConflict: 'employee_id,weekday' });
    setPastingEmployeeId(null);
    if (error) {
      setPasteError(error.message);
      return;
    }
    setPending(p => {
      const next = { ...p };
      for (const u of upserts) delete next[`${targetId}|${u.weekday}`];
      return next;
    });
    reload();
  }

  const pendingCount = Object.keys(pending).length;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    const toUpsert: { employee_id: string; weekday: number; shift_id: string | null }[] = [];
    const toDelete: { employee_id: string; weekday: number }[] = [];
    for (const [key, value] of Object.entries(pending)) {
      const [employeeId, weekdayStr] = key.split('|');
      const weekday = Number(weekdayStr);
      if (value === UNSET) toDelete.push({ employee_id: employeeId, weekday });
      else toUpsert.push({ employee_id: employeeId, weekday, shift_id: value === WEEK_OFF_VALUE ? null : value });
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase.from('employee_weekly_pattern').upsert(toUpsert, { onConflict: 'employee_id,weekday' });
      if (error) {
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }
    for (const d of toDelete) {
      const { error } = await supabase
        .from('employee_weekly_pattern')
        .delete()
        .eq('employee_id', d.employee_id)
        .eq('weekday', d.weekday);
      if (error) {
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }

    setSaving(false);
    setPending({});
    reload();
  }

  function cellTone(value: string, dirty: boolean) {
    if (dirty) return 'border-accent bg-accent/10 text-ink font-medium';
    if (value === WEEK_OFF_VALUE) return 'border-warning/30 bg-warning-bg text-warning-text font-semibold';
    if (value === UNSET) return 'border-slate-200 text-slate-400';
    return 'border-accent/30 bg-accent/5 text-ink font-medium';
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-good-bg via-good-bg/40 to-transparent px-4 py-3 sm:px-6">
        <div>
          <span className="text-sm font-semibold text-ink">Recurring Weekly Pattern</span>
          <p className="text-xs text-slate-500">Set once — applies to every coming week automatically.</p>
        </div>
        <RosterModeSwitch companyId={companyId} mode={rosterMode} onChange={onRosterModeChange} />
      </div>

      {pendingCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-accent/20 bg-accent/5 px-4 py-3 sm:px-6">
          <span className="text-sm font-medium text-ink">
            {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setPending({})} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {copiedEmployeeId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-good/20 bg-good-bg px-4 py-2.5 text-sm sm:px-6">
          <span className="font-medium text-good-text">
            📋 Copied {employees.find(e => e.id === copiedEmployeeId)?.name ?? 'an employee'}&apos;s pattern — click{' '}
            <strong>📋 Paste</strong> on any other employee below to apply it. Saves immediately, as many times as you like.
          </span>
          <button onClick={() => setCopiedEmployeeId(null)} className="shrink-0 text-xs font-medium text-slate-600 hover:underline">
            ✕ Clear
          </button>
        </div>
      )}
      {pasteError && (
        <div className="border-b border-critical/20 bg-critical-bg px-4 py-2.5 text-sm text-critical-text sm:px-6">Could not paste: {pasteError}</div>
      )}

      <div className="p-4 sm:p-6">
        {loading ? (
          <p className="text-center text-sm text-slate-400">Loading…</p>
        ) : employees.length === 0 ? (
          <p className="text-center text-sm text-slate-400">No active employees.</p>
        ) : templateShifts.length === 0 ? (
          <p className="text-center text-sm text-slate-400">
            Create at least one shift above first (e.g. Day Duty, Night Duty, Day &amp; Night Duty) — this pattern assigns
            one of those to each employee per weekday.
          </p>
        ) : (
          <>
          <HorizontalScrollButtons targetRef={tableScrollRef} />
          <div ref={tableScrollRef} className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2.5 font-medium">Employee</th>
                  {weekdays.map(wd => (
                    <th key={wd} className="whitespace-nowrap px-1.5 py-2.5 text-center font-medium">
                      {WEEKDAY_LABELS[wd]}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-2 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => {
                  const rowBg = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                  return (
                    <tr key={emp.id} className="border-b border-slate-100 last:border-0">
                      <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 ${rowBg}`}>
                        <div className="flex items-center gap-2">
                          <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-14 w-14 text-base" />
                          <span className="truncate font-medium text-ink">{emp.name}</span>
                        </div>
                      </td>
                      {weekdays.map(wd => {
                        const value = currentValue(emp.id, wd);
                        const dirty = `${emp.id}|${wd}` in pending;
                        return (
                          <td key={wd} className={`px-1 py-1.5 text-center ${rowBg}`}>
                            <select
                              value={value}
                              onChange={e => setCell(emp.id, wd, e.target.value)}
                              title={shiftById.get(value)?.name}
                              className={`w-full rounded-md border px-1 py-1 text-xs shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${cellTone(
                                value,
                                dirty
                              )}`}
                            >
                              <option value={UNSET}>—</option>
                              <option value={WEEK_OFF_VALUE}>Week Off</option>
                              {templateShifts.map(s => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                      <td className={`whitespace-nowrap px-2 py-1.5 text-center ${rowBg}`}>
                        {copiedEmployeeId === emp.id ? (
                          <button
                            type="button"
                            onClick={() => setCopiedEmployeeId(null)}
                            title="This employee's pattern is copied — click to clear"
                            className="shrink-0 whitespace-nowrap rounded-md border border-good/30 bg-good-bg px-1.5 py-1 text-[10px] font-semibold text-good-text"
                          >
                            📋 Copied ✓
                          </button>
                        ) : copiedEmployeeId ? (
                          <button
                            type="button"
                            onClick={() => pasteToEmployee(emp.id)}
                            disabled={pastingEmployeeId === emp.id}
                            title={`Paste ${employees.find(e => e.id === copiedEmployeeId)?.name ?? "the copied employee"}'s pattern onto ${emp.name} — saves immediately`}
                            className="shrink-0 whitespace-nowrap rounded-md border border-accent/40 bg-accent/5 px-1.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {pastingEmployeeId === emp.id ? 'Pasting…' : '📋 Paste'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCopiedEmployeeId(emp.id)}
                            disabled={!weekdays.some(wd => currentValue(emp.id, wd) !== UNSET)}
                            title="Copy this employee's whole pattern — then click Paste on another employee"
                            className="shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-slate-500 hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            📋 Copy
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {saveError && <p className="mt-3 text-sm text-critical">Could not save: {saveError}</p>}
      </div>

    </div>
  );
}
