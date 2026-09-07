'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import NepaliDate from 'nepali-date-converter';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import RosterModeSwitch from '@/components/RosterModeSwitch';
import RosterCellPicker, { type RosterCellOption } from '@/components/RosterCellPicker';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { useConfirm } from '@/components/ConfirmDialog';
import { buildMonth, monthDateRange, stepWeek, weekRange, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, Shift } from '@/lib/types';
import type { RosterMode } from '@/lib/weekOff';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Two sentinel cell values, distinct from any real shift_id: "no row for
 * this cell at all" (falls back to the employee's normal shift) vs. "an
 * explicit Week Off row" (shift_id stored as null) — see employee_daily_shifts'
 * design (20260806100000_employee_daily_shifts.sql). */
const UNSET = 'unset';
const WEEK_OFF_VALUE = 'week-off';

type RosterRow = { employee_id: string; work_date: string; shift_id: string | null };

function shortDate(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function shortBsDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return NepaliDate.fromAD(new Date(y, m - 1, d)).format('D/M');
}

/** The Sun-Sat week structure itself always stays AD (see weekRange's own
 * comment — the duty roster is filled in real calendar weeks regardless of
 * display system), but the label shown to the user should still follow the
 * global AD/BS switch like every other date on the page, rather than being
 * silently stuck on AD forever. */
function bsWeekLabel(startKey: string, endKey: string): string {
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const bsStart = NepaliDate.fromAD(new Date(sy, sm - 1, sd));
  const bsEnd = NepaliDate.fromAD(new Date(ey, em - 1, ed));
  const startLabel = bsStart.getYear() === bsEnd.getYear() ? bsStart.format('D MMMM') : bsStart.format('D MMMM YYYY');
  return `${startLabel} – ${bsEnd.format('D MMMM YYYY')}`;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function parseAdKey(value: string): CalendarAnchor {
  const [y, m, d] = value.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export default function WeeklyRosterGrid({
  companyId,
  rosterMode,
  onRosterModeChange,
}: {
  companyId: string | null;
  rosterMode: RosterMode;
  onRosterModeChange: (mode: RosterMode) => void;
}) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(todayIso);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  // "employeeId|date" -> a real shift_id, WEEK_OFF_VALUE, or UNSET — staged
  // here until Save is clicked, not written on every pick.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  // Clipboard-style copy/paste between employees: Copy marks a source
  // employee, then Paste on any other employee's row writes that source's
  // whole Sun-Sat week onto them immediately — no modal, no separate Save
  // step. Stays set across multiple pastes so one Copy can go out to
  // several employees one click at a time.
  const [copiedEmployeeId, setCopiedEmployeeId] = useState<string | null>(null);
  const [pastingEmployeeId, setPastingEmployeeId] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  // Multi-target paste: check several employees below a Copy, then one
  // "Paste to N selected" writes the copied week to all of them in a single
  // request instead of clicking Paste on each row individually. Cleared
  // whenever the copied source changes so a stale selection never carries
  // over to a different source's paste.
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [pastingSelected, setPastingSelected] = useState(false);

  useEffect(() => {
    setSelectedTargetIds(new Set());
  }, [copiedEmployeeId]);

  const week = useMemo(() => weekRange(anchor), [anchor]);
  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const cellOptions: RosterCellOption[] = useMemo(
    () => [
      { id: UNSET, label: '—' },
      { id: WEEK_OFF_VALUE, label: 'Week Off' },
      ...templateShifts.map(s => ({ id: s.id, label: s.name, sub: `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` })),
    ],
    [templateShifts]
  );
  const today = todayIso();

  // "The month" this bulk-copy fills the rest of — anchored to the middle
  // of the displayed week (Wednesday), not its first day. A Sun-Sat week
  // straddling a month boundary (very common in BS, whose months rarely
  // land on week boundaries) would otherwise anchor to whichever month is
  // about to end in a day or two, leaving almost nothing left to copy into.
  const monthAnchor = useMemo(() => parseAdKey(week.dates[3]), [week.dates]);
  const monthRange = useMemo(() => monthDateRange(system, monthAnchor), [system, monthAnchor]);
  const monthLabel = useMemo(() => buildMonth(system, monthAnchor).label, [system, monthAnchor]);
  const remainingDates = useMemo(() => {
    const weekSet = new Set(week.dates);
    const out: string[] = [];
    const cur = new Date(monthRange.start + 'T00:00:00Z');
    const end = new Date(monthRange.end + 'T00:00:00Z');
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      if (!weekSet.has(key)) out.push(key);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }, [monthRange, week.dates]);

  function reload() {
    setLoading(true);
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('shifts').select('*'),
      supabase
        .from('employee_daily_shifts')
        .select('employee_id, work_date, shift_id')
        .gte('work_date', week.start)
        .lte('work_date', week.end),
    ]).then(([empRes, shiftsRes, rosterRes]) => {
      setEmployees((empRes.data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      setShifts(shiftsRes.data ?? []);
      setRosterRows(rosterRes.data ?? []);
      setLoading(false);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [week.start, week.end]);

  useEffect(() => {
    setPending({});
    setSaveError(null);
  }, [week.start]);

  function currentValue(employeeId: string, date: string): string {
    const key = `${employeeId}|${date}`;
    if (key in pending) return pending[key];
    const row = rosterRows.find(r => r.employee_id === employeeId && r.work_date === date);
    if (!row) return UNSET;
    return row.shift_id === null ? WEEK_OFF_VALUE : row.shift_id;
  }

  function setCell(employeeId: string, date: string, value: string) {
    setPending(p => ({ ...p, [`${employeeId}|${date}`]: value }));
  }

  // Writes the copied employee's whole Sun-Sat week onto `targetId` straight
  // to Supabase. Only a source day that actually has a pick (not —) writes
  // anything, leaving whatever's already on that target day alone if the
  // source day itself is blank. A target day that already has its OWN
  // assignment is a real conflict, though — that's silently destructive
  // without a specific warning, so it's only allowed through an explicit
  // confirm naming exactly which days already have a roster and would get
  // overwritten. A target with no conflicts at all pastes immediately, no
  // dialog — the whole point of Paste is fast, repeated application onto
  // still-blank rows. Also drops any of the target's own still-unsaved
  // manual picks on the days just written, so the grid doesn't keep
  // showing a stale pending value that no longer matches what Paste just
  // saved underneath it.
  async function pasteToEmployee(targetId: string) {
    if (!copiedEmployeeId || copiedEmployeeId === targetId) return;
    const sourceName = employees.find(e => e.id === copiedEmployeeId)?.name ?? 'the copied employee';
    const targetName = employees.find(e => e.id === targetId)?.name ?? 'this employee';
    const sourcePicks = week.dates
      .map(date => ({ date, value: currentValue(copiedEmployeeId, date) }))
      .filter(p => p.value !== UNSET);
    if (sourcePicks.length === 0) return;
    const conflictDates = sourcePicks.filter(p => currentValue(targetId, p.date) !== UNSET).map(p => shortDate(p.date));
    if (conflictDates.length > 0) {
      const denyMsg =
        `${targetName} already has a shift roster assigned on ${conflictDates.length} of these day` +
        `${conflictDates.length === 1 ? '' : 's'} (${conflictDates.join(', ')}).\n\n` +
        `Paste ${sourceName}'s week anyway and overwrite ${conflictDates.length === 1 ? 'it' : 'them'}?`;
      if (!(await confirm(denyMsg, { title: 'Roster already assigned', confirmLabel: 'Overwrite', tone: 'danger' }))) return;
    }
    setPastingEmployeeId(targetId);
    setPasteError(null);
    const upserts = sourcePicks.map(p => ({
      employee_id: targetId,
      work_date: p.date,
      shift_id: p.value === WEEK_OFF_VALUE ? null : p.value,
    }));
    if (upserts.length === 0) {
      setPastingEmployeeId(null);
      return;
    }
    const { error } = await supabase.from('employee_daily_shifts').upsert(upserts, { onConflict: 'employee_id,work_date' });
    setPastingEmployeeId(null);
    if (error) {
      setPasteError(error.message);
      return;
    }
    setPending(p => {
      const next = { ...p };
      for (const u of upserts) delete next[`${targetId}|${u.work_date}`];
      return next;
    });
    reload();
  }

  // Same paste as pasteToEmployee, but fanned out to every selected target
  // in one batch upsert instead of one request per click — same conflict
  // rule too: only a target that already has its own roster on one of the
  // pasted days needs an explicit confirm, and the dialog names which of the
  // selected employees those are, not just a raw count of days.
  async function pasteToSelected() {
    if (!copiedEmployeeId || selectedTargetIds.size === 0) return;
    const targetIds = [...selectedTargetIds].filter(id => id !== copiedEmployeeId);
    if (targetIds.length === 0) return;
    const sourceName = employees.find(e => e.id === copiedEmployeeId)?.name ?? 'the copied employee';
    const sourcePicks = week.dates
      .map(date => ({ date, value: currentValue(copiedEmployeeId, date) }))
      .filter(p => p.value !== UNSET);
    if (sourcePicks.length === 0) return;
    const conflictingTargetIds = targetIds.filter(id => sourcePicks.some(p => currentValue(id, p.date) !== UNSET));
    if (conflictingTargetIds.length > 0) {
      const names = conflictingTargetIds.map(id => employees.find(e => e.id === id)?.name ?? 'Unknown').join(', ');
      const denyMsg =
        `${conflictingTargetIds.length} of the ${targetIds.length} selected employees already ` +
        `${conflictingTargetIds.length === 1 ? 'has' : 'have'} a shift roster assigned on some of these days: ${names}.\n\n` +
        `Paste ${sourceName}'s week anyway and overwrite ${conflictingTargetIds.length === 1 ? 'that roster' : 'those rosters'}?`;
      if (!(await confirm(denyMsg, { title: 'Roster already assigned', confirmLabel: 'Overwrite', tone: 'danger' }))) return;
    }
    setPastingSelected(true);
    setPasteError(null);
    const upserts: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    for (const targetId of targetIds) {
      for (const { date, value } of sourcePicks) {
        upserts.push({ employee_id: targetId, work_date: date, shift_id: value === WEEK_OFF_VALUE ? null : value });
      }
    }
    if (upserts.length === 0) {
      setPastingSelected(false);
      return;
    }
    const { error } = await supabase.from('employee_daily_shifts').upsert(upserts, { onConflict: 'employee_id,work_date' });
    setPastingSelected(false);
    if (error) {
      setPasteError(error.message);
      return;
    }
    setPending(p => {
      const next = { ...p };
      for (const u of upserts) delete next[`${u.employee_id}|${u.work_date}`];
      return next;
    });
    setSelectedTargetIds(new Set());
    reload();
  }

  const pendingCount = Object.keys(pending).length;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    const toUpsert: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    const toDelete: { employee_id: string; work_date: string }[] = [];
    for (const [key, value] of Object.entries(pending)) {
      const [employeeId, date] = key.split('|');
      if (value === UNSET) toDelete.push({ employee_id: employeeId, work_date: date });
      else toUpsert.push({ employee_id: employeeId, work_date: date, shift_id: value === WEEK_OFF_VALUE ? null : value });
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase.from('employee_daily_shifts').upsert(toUpsert, { onConflict: 'employee_id,work_date' });
      if (error) {
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }
    for (const d of toDelete) {
      const { error } = await supabase
        .from('employee_daily_shifts')
        .delete()
        .eq('employee_id', d.employee_id)
        .eq('work_date', d.work_date);
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

  // Takes this week's Sun-Sat pattern (per employee, including anything
  // still pending here) and writes it into every remaining day of the month
  // it falls in, matched by weekday — Monday this week's pick lands on
  // every other Monday left in the month, and so on. Only days where the
  // source week actually has a pick propagate; an employee's untouched (—)
  // weekday leaves whatever's already on the target days alone rather than
  // clearing it. Writes straight to the database (there's nothing to stage
  // — every date it touches is outside this grid, so Save/Cancel above
  // can't cover it), which is why it gets its own confirm step instead.
  async function performCopyToMonth() {
    setCopying(true);
    setCopyError(null);
    const upserts: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    for (const emp of employees) {
      const byWeekday = new Map<number, string | null>();
      week.dates.forEach((date, i) => {
        const value = currentValue(emp.id, date);
        if (value !== UNSET) byWeekday.set(i, value === WEEK_OFF_VALUE ? null : value);
      });
      if (byWeekday.size === 0) continue;
      for (const date of remainingDates) {
        const wd = byWeekday.get(weekdayOf(date));
        if (wd !== undefined) upserts.push({ employee_id: emp.id, work_date: date, shift_id: wd });
      }
    }
    if (upserts.length === 0) {
      setCopying(false);
      setCopyModalOpen(false);
      return;
    }
    const { error } = await supabase.from('employee_daily_shifts').upsert(upserts, { onConflict: 'employee_id,work_date' });
    setCopying(false);
    if (error) {
      setCopyError(error.message);
      return;
    }
    // Every written date is outside the currently displayed week (see
    // remainingDates), so nothing on screen changes — no need to touch
    // rosterRows or reload for a view that can't show those dates anyway.
    setCopyModalOpen(false);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 3000);
  }

  const copyCandidateCount = useMemo(
    () => employees.filter(emp => week.dates.some(date => currentValue(emp.id, date) !== UNSET)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, week.dates, rosterRows, pending]
  );

  const selectableTargetIds = useMemo(
    () => employees.filter(e => e.id !== copiedEmployeeId).map(e => e.id),
    [employees, copiedEmployeeId]
  );
  const allTargetsSelected = selectableTargetIds.length > 0 && selectableTargetIds.every(id => selectedTargetIds.has(id));

  function toggleSelectedTarget(employeeId: string) {
    setSelectedTargetIds(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function toggleSelectAllTargets() {
    setSelectedTargetIds(allTargetsSelected ? new Set() : new Set(selectableTargetIds));
  }

  function cellTone(value: string, dirty: boolean) {
    if (dirty) return 'border-accent bg-accent/10 text-ink font-medium';
    if (value === WEEK_OFF_VALUE) return 'border-warning/30 bg-warning-bg text-warning-text font-semibold';
    if (value === UNSET) return 'border-slate-200 text-slate-400';
    return 'border-accent/30 bg-accent/5 text-ink font-medium';
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setAnchor(stepWeek(anchor, -1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50">
            ←
          </button>
          <span className="text-sm font-semibold text-ink">
            {system === 'AD' ? week.label : bsWeekLabel(week.start, week.end)}
          </span>
          <button onClick={() => setAnchor(stepWeek(anchor, 1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50">
            →
          </button>
        </div>
        <div className="flex items-center gap-3">
          {copyDone && <span className="text-xs font-semibold text-good-text">✓ Copied to rest of {monthLabel}</span>}
          <button
            type="button"
            onClick={() => setCopyModalOpen(true)}
            disabled={copyCandidateCount === 0 || remainingDates.length === 0 || pendingCount > 0}
            title={
              pendingCount > 0
                ? 'Save this week’s changes first'
                : remainingDates.length === 0
                  ? 'This week already covers the whole month'
                  : undefined
            }
            className="rounded-md border border-accent/30 bg-white px-2.5 py-1.5 text-xs font-semibold text-accent shadow-sm hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⧉ Copy this week to rest of {monthLabel}
          </button>
          <RosterModeSwitch companyId={companyId} mode={rosterMode} onChange={onRosterModeChange} />
        </div>
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
            📋 Copied {employees.find(e => e.id === copiedEmployeeId)?.name ?? 'an employee'}&apos;s week — click{' '}
            <strong>📋 Paste</strong> on one employee below, or check several then{' '}
            <strong>Paste to selected</strong>. Saves immediately, as many times as you like.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {selectedTargetIds.size > 0 && (
              <button
                type="button"
                onClick={pasteToSelected}
                disabled={pastingSelected}
                className="rounded-md border border-accent bg-accent px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pastingSelected ? 'Pasting…' : `📋 Paste to ${selectedTargetIds.size} selected`}
              </button>
            )}
            <button onClick={() => setCopiedEmployeeId(null)} className="shrink-0 text-xs font-medium text-slate-600 hover:underline">
              ✕ Clear
            </button>
          </div>
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
            Create at least one shift above first (e.g. Day Duty, Night Duty, Day &amp; Night Duty) — this roster assigns one of
            those to each employee per day.
          </p>
        ) : (
          <>
          <HorizontalScrollButtons targetRef={tableScrollRef} />
          <div ref={tableScrollRef} className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2.5 font-medium">
                    {copiedEmployeeId ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allTargetsSelected}
                          onChange={toggleSelectAllTargets}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-accent focus:ring-accent/30"
                        />
                        Employee
                      </label>
                    ) : (
                      'Employee'
                    )}
                  </th>
                  {week.dates.map((date, i) => (
                    <th key={date} className={`whitespace-nowrap px-1.5 py-2.5 text-center font-medium ${date === today ? 'bg-accent/10 text-accent' : ''}`}>
                      {WEEKDAY_LABELS[i]}
                      <div className="text-[10px] font-normal normal-case text-slate-400">
                        {system === 'AD' ? (
                          <>
                            {shortDate(date)} <span className="text-slate-300">·</span> {shortBsDate(date)}
                          </>
                        ) : (
                          <>
                            {shortBsDate(date)} <span className="text-slate-300">·</span> {shortDate(date)}
                          </>
                        )}
                      </div>
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
                          {copiedEmployeeId && emp.id !== copiedEmployeeId && (
                            <input
                              type="checkbox"
                              checked={selectedTargetIds.has(emp.id)}
                              onChange={() => toggleSelectedTarget(emp.id)}
                              className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-accent focus:ring-accent/30"
                            />
                          )}
                          <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-14 w-14 text-base" />
                          <span className="truncate font-medium text-ink">{emp.name}</span>
                        </div>
                      </td>
                      {week.dates.map(date => {
                        const value = currentValue(emp.id, date);
                        const dirty = `${emp.id}|${date}` in pending;
                        return (
                          <td key={date} className={`px-1 py-1.5 text-center ${date === today ? 'bg-accent/5' : rowBg}`}>
                            <RosterCellPicker
                              value={value}
                              onChange={v => setCell(emp.id, date, v)}
                              options={cellOptions}
                              buttonClassName={`rounded-md border shadow-sm ${cellTone(value, dirty)}`}
                            />
                          </td>
                        );
                      })}
                      <td className={`whitespace-nowrap px-2 py-1.5 text-center ${rowBg}`}>
                        {copiedEmployeeId === emp.id ? (
                          <button
                            type="button"
                            onClick={() => setCopiedEmployeeId(null)}
                            title="This employee's week is copied — click to clear"
                            className="shrink-0 whitespace-nowrap rounded-md border border-good/30 bg-good-bg px-1.5 py-1 text-[10px] font-semibold text-good-text"
                          >
                            📋 Copied ✓
                          </button>
                        ) : copiedEmployeeId ? (
                          <button
                            type="button"
                            onClick={() => pasteToEmployee(emp.id)}
                            disabled={pastingEmployeeId === emp.id}
                            title={`Paste ${employees.find(e => e.id === copiedEmployeeId)?.name ?? "the copied employee"}'s week onto ${emp.name} — saves immediately`}
                            className="shrink-0 whitespace-nowrap rounded-md border border-accent/40 bg-accent/5 px-1.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {pastingEmployeeId === emp.id ? 'Pasting…' : '📋 Paste'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCopiedEmployeeId(emp.id)}
                            disabled={!week.dates.some(date => currentValue(emp.id, date) !== UNSET)}
                            title="Copy this employee's whole week — then click Paste on another employee"
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

      {copyModalOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-2 text-lg font-semibold text-ink">Copy this week to the rest of {monthLabel}?</h3>
            <p className="mb-4 text-sm text-slate-600">
              {copyCandidateCount} employee{copyCandidateCount === 1 ? '' : 's'} with a pick this week will get that same
              Sun–Sat pattern applied to every other day in {monthLabel} ({remainingDates.length} day
              {remainingDates.length === 1 ? '' : 's'}), matched by weekday. A day this week left blank (—) leaves any
              existing pick on the matching days untouched — this only fills in, it never clears. You can still hand-edit
              any single day afterward.
            </p>
            {copyError && <p className="mb-3 text-sm text-critical">Could not copy: {copyError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                disabled={copying}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performCopyToMonth}
                disabled={copying}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {copying ? 'Copying…' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
