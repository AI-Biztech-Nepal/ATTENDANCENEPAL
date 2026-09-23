'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import DepartmentDropdown from '@/components/DepartmentDropdown';
import PasteWeeklyRosterDialog from '@/components/PasteWeeklyRosterDialog';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { useConfirm } from '@/components/ConfirmDialog';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildPaintOptions, departmentOf, UNSET, WEEK_OFF_VALUE, type PaintOption } from '@/lib/shiftPalette';
import type { Employee, Shift } from '@/lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const todayIso = () => new Date().toISOString().slice(0, 10);

type RosterRow = { employee_id: string; work_date: string; shift_id: string | null };

/** Same grid/data model as before (employee_daily_shifts, one exact date per
 * column) spanning a whole AD/BS month — now the ONLY exact-dates editor
 * (the old per-week grid is retired: this replaces it, so a week is just
 * this grid scrolled to the right spot). Click a brush above, then click a
 * date to paint it, instead of a dropdown per cell; grouped by department
 * when a company uses more than one, with a Save-changes bar so nothing
 * writes until you save. */
export default function MonthlyRosterGrid() {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(todayAnchor);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [brush, setBrush] = useState<string>(WEEK_OFF_VALUE);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);

  const [copiedEmployeeId, setCopiedEmployeeId] = useState<string | null>(null);
  const [pastingEmployeeId, setPastingEmployeeId] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTargetAnchor, setCopyTargetAnchor] = useState<CalendarAnchor | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const monthCells = useMemo(() => month.weeks.flat().filter(c => c.inMonth), [month]);
  const dates = useMemo(() => monthCells.map(c => c.adKey), [monthCells]);
  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const shiftById = useMemo(() => new Map(templateShifts.map(s => [s.id, s])), [templateShifts]);
  const paintOptions = useMemo(() => buildPaintOptions(templateShifts), [templateShifts]);
  const paintByValue = useMemo(() => new Map(paintOptions.map(o => [o.value, o])), [paintOptions]);
  const today = todayIso();

  useEffect(() => {
    if (templateShifts.length > 0 && brush !== WEEK_OFF_VALUE && brush !== UNSET && !shiftById.has(brush)) {
      setBrush(WEEK_OFF_VALUE);
    }
  }, [templateShifts, shiftById, brush]);

  const copyTargetMonth = useMemo(() => (copyTargetAnchor ? buildMonth(system, copyTargetAnchor) : null), [system, copyTargetAnchor]);
  const copyTargetIsSameMonth = useMemo(
    () => (copyTargetAnchor ? monthDateRange(system, copyTargetAnchor).start === dates[0] : false),
    [system, copyTargetAnchor, dates]
  );
  const copyCandidateCount = useMemo(
    () => employees.filter(emp => dates.some(date => currentValue(emp.id, date) !== UNSET)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, dates, rosterRows, pending]
  );

  function reload() {
    if (dates.length === 0) return;
    setLoading(true);
    const start = dates[0];
    const end = dates[dates.length - 1];
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('shifts').select('*'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
    ]).then(([empRes, shiftsRes, rosterRes]) => {
      setEmployees((empRes.data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      setShifts(shiftsRes.data ?? []);
      setRosterRows(rosterRes.data ?? []);
      setLoading(false);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [dates.join(',')]);

  useEffect(() => {
    setPending({});
    setSaveError(null);
    setCopiedEmployeeId(null);
  }, [dates.join(',')]);

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

  function scrollDays(days: number) {
    scrollRef.current?.scrollBy({ left: days * 100, behavior: 'smooth' });
  }

  // Pastes the copied employee's picks across every date shown here onto
  // `targetId`, immediately — same conflict rule as the Weekly Roster's
  // per-employee paste: a source day with no pick leaves the matching
  // target day alone, and any real overlap needs one confirm naming how
  // many days would be overwritten before it writes anything.
  async function pasteToEmployee(targetId: string) {
    if (!copiedEmployeeId || copiedEmployeeId === targetId) return;
    const sourceName = employees.find(e => e.id === copiedEmployeeId)?.name ?? 'the copied employee';
    const targetName = employees.find(e => e.id === targetId)?.name ?? 'this employee';
    const sourcePicks = dates.map(date => ({ date, value: currentValue(copiedEmployeeId, date) })).filter(p => p.value !== UNSET);
    if (sourcePicks.length === 0) return;
    const conflictCount = sourcePicks.filter(p => currentValue(targetId, p.date) !== UNSET).length;
    if (conflictCount > 0) {
      const proceed = await confirm(
        `${targetName} already has a shift assigned on ${conflictCount} of these day${conflictCount === 1 ? '' : 's'}.\n\n` +
          `Paste ${sourceName}'s ${month.label} plan anyway and overwrite ${conflictCount === 1 ? 'it' : 'them'}?`,
        { title: 'Roster already assigned', confirmLabel: 'Overwrite', tone: 'danger' }
      );
      if (!proceed) return;
    }
    setPastingEmployeeId(targetId);
    setPasteError(null);
    const upserts = sourcePicks.map(p => ({ employee_id: targetId, work_date: p.date, shift_id: p.value === WEEK_OFF_VALUE ? null : p.value }));
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

  function openCopyModal() {
    setCopyError(null);
    setCopyTargetAnchor(stepAnchor(system, anchor, 1));
    setCopyModalOpen(true);
  }

  async function performCopyToMonth() {
    if (!copyTargetAnchor) return;
    setCopying(true);
    setCopyError(null);
    const targetCells = buildMonth(system, copyTargetAnchor).weeks.flat().filter(c => c.inMonth);
    const upserts: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    for (const emp of employees) {
      dates.forEach((date, i) => {
        const targetCell = targetCells[i];
        if (!targetCell) return;
        const value = currentValue(emp.id, date);
        if (value === UNSET) return;
        upserts.push({ employee_id: emp.id, work_date: targetCell.adKey, shift_id: value === WEEK_OFF_VALUE ? null : value });
      });
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
    setCopyModalOpen(false);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 3000);
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

  const departmentNames = useMemo(() => {
    const set = new Set(employees.map(departmentOf));
    return [...set].sort((a, b) => (a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)));
  }, [employees]);
  const useDepartments = departmentNames.length > 1;

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => employees.filter(e => (!useDepartments || dept === 'all' || departmentOf(e) === dept) && (!q || e.name.toLowerCase().includes(q))),
    [employees, useDepartments, dept, q]
  );

  const deptOptions = useMemo(
    () => [
      { value: 'all', label: 'All departments', count: employees.length },
      ...departmentNames.map(name => ({ value: name, label: name, count: employees.filter(e => departmentOf(e) === name).length })),
    ],
    [departmentNames, employees]
  );

  function hoursFor(employeeId: string): number {
    return dates.reduce((sum, date) => {
      const v = currentValue(employeeId, date);
      if (v === UNSET || v === WEEK_OFF_VALUE) return sum;
      const shift = shiftById.get(v);
      if (!shift) return sum;
      const [sh, sm] = shift.start_time.split(':').map(Number);
      const [eh, em] = shift.end_time.split(':').map(Number);
      let minutes = eh * 60 + em - (sh * 60 + sm);
      if (minutes <= 0) minutes += 24 * 60;
      return sum + minutes / 60;
    }, 0);
  }

  const groups = useMemo(() => {
    if (!useDepartments) return [{ name: null as string | null, rows: visible }];
    return departmentNames
      .map(name => ({ name, rows: visible.filter(e => departmentOf(e) === name) }))
      .filter(g => g.rows.length > 0);
  }, [useDepartments, departmentNames, visible]);

  function cellClass(value: string, dirty: boolean) {
    const opt = paintByValue.get(value);
    const base = value === UNSET ? 'border-dashed border-slate-200 text-slate-400' : `border-transparent ${opt?.bg ?? 'bg-slate-100'} ${opt?.text ?? 'text-ink'}`;
    return `${base} ${dirty ? 'ring-2 ring-accent ring-offset-1' : ''}`;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 px-4 py-3.5 sm:px-6">
        <div>
          <span className="text-sm font-semibold text-ink">Monthly Roster</span>
          <p className="text-xs text-slate-500">Exact dates, one month at a time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-sm">
            <button onClick={() => setAnchor(a => stepAnchor(system, a, -1))} className="rounded-md px-1.5 py-1 text-slate-500 hover:bg-slate-50">
              ←
            </button>
            <span className="min-w-[7rem] text-center text-sm font-semibold text-ink">{month.label}</span>
            <button onClick={() => setAnchor(a => stepAnchor(system, a, 1))} className="rounded-md px-1.5 py-1 text-slate-500 hover:bg-slate-50">
              →
            </button>
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search employees"
              className="h-9 w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {useDepartments && <DepartmentDropdown options={deptOptions} value={dept} onChange={setDept} />}
          {copyDone && <span className="text-xs font-semibold text-good-text">Copied to {copyTargetMonth?.label}</span>}
          <button
            type="button"
            onClick={openCopyModal}
            disabled={copyCandidateCount === 0 || pendingCount > 0}
            title={pendingCount > 0 ? 'Save this month’s changes first' : copyCandidateCount === 0 ? 'Nothing to copy — no picks this month' : undefined}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Copy this month to…
          </button>
          <button
            type="button"
            onClick={() => setPasteDialogOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-accent px-3 text-sm font-semibold text-accent shadow-sm hover:bg-accent/5"
          >
            <PasteIcon className="h-3.5 w-3.5" />
            Paste weekly roster
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 sm:px-6">
        <span className="text-xs font-semibold text-slate-500">Paint with</span>
        <div role="radiogroup" aria-label="Shift to paint" className="flex flex-wrap gap-1.5">
          {paintOptions.map(o => {
            const active = brush === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setBrush(o.value)}
                title={o.sub}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                  active ? 'border-ink bg-ink text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {o.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-white' : o.dot}`} />}
                {o.label}
                {o.sub && <span className="font-normal opacity-70">{o.sub}</span>}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">Scroll:</span>
          <button type="button" onClick={() => scrollDays(-7)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500 hover:border-accent/40 hover:text-accent">
            ‹
          </button>
          <button type="button" onClick={() => scrollDays(7)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500 hover:border-accent/40 hover:text-accent">
            ›
          </button>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="sticky bottom-4 z-30 mx-4 mt-3 flex items-center gap-4 rounded-xl bg-ink px-4 py-3 shadow-lg sm:mx-6">
          <div className="flex-grow">
            <div className="text-sm font-semibold text-white">
              {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
            </div>
            <div className="text-xs text-slate-300">Nothing is recorded until you save.</div>
          </div>
          <button onClick={() => setPending({})} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10">
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-good px-4 py-2 text-sm font-semibold text-white hover:bg-good/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {copiedEmployeeId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-good/20 bg-good-bg px-4 py-2.5 text-sm sm:px-6">
          <span className="font-medium text-good-text">
            Copied {employees.find(e => e.id === copiedEmployeeId)?.name ?? 'an employee'}&apos;s {month.label} plan — click
            the paste icon on any other row to apply it. Saves immediately, as many times as you like.
          </span>
          <button onClick={() => setCopiedEmployeeId(null)} className="shrink-0 text-xs font-medium text-slate-600 hover:underline">
            Clear
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
            Create at least one shift above first (e.g. Day Duty, Night Duty, Day &amp; Night Duty) — this roster assigns one of
            those to each employee per day.
          </p>
        ) : (
          <>
          <HorizontalScrollButtons targetRef={scrollRef} step={700} />
          <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2.5 font-medium">Employee</th>
                  {monthCells.map(cell => (
                    <th key={cell.adKey} className={`whitespace-nowrap px-1 py-2.5 text-center font-medium ${cell.adKey === today ? 'bg-accent/10 text-accent' : ''}`}>
                      {WEEKDAY_LABELS[new Date(cell.adKey + 'T00:00:00Z').getUTCDay()]}
                      <div className="text-[11px] font-normal normal-case text-slate-400">{cell.displayDay}</div>
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Hours</th>
                  <th className="whitespace-nowrap px-2 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <MonthlyGroupRows
                    key={group.name ?? '__all'}
                    group={group}
                    collapsed={!!(group.name && collapsed[group.name])}
                    onToggle={() => group.name && setCollapsed(c => ({ ...c, [group.name!]: !c[group.name!] }))}
                    dates={dates}
                    today={today}
                    currentValue={currentValue}
                    setCell={setCell}
                    brush={brush}
                    cellClass={cellClass}
                    paintByValue={paintByValue}
                    pending={pending}
                    hoursFor={hoursFor}
                    copiedEmployeeId={copiedEmployeeId}
                    pastingEmployeeId={pastingEmployeeId}
                    onCopy={id => setCopiedEmployeeId(id)}
                    onPaste={pasteToEmployee}
                    onClearCopy={() => setCopiedEmployeeId(null)}
                  />
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={dates.length + 3} className="px-4 py-8 text-center text-sm text-slate-400">
                      No one matches “{query}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        )}

        {saveError && <p className="mt-3 text-sm text-critical">Could not save: {saveError}</p>}
      </div>

      {copyModalOpen && copyTargetAnchor && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-2 text-lg font-semibold text-ink">Copy {month.label} to…</h3>
            <div className="mb-4 flex items-center justify-center gap-3 rounded-lg border border-slate-200 bg-slate-50 py-2.5">
              <button
                type="button"
                onClick={() => setCopyTargetAnchor(a => stepAnchor(system, a!, -1))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50"
              >
                ←
              </button>
              <span className="min-w-[10rem] text-center text-sm font-semibold text-ink">{copyTargetMonth?.label}</span>
              <button
                type="button"
                onClick={() => setCopyTargetAnchor(a => stepAnchor(system, a!, 1))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50"
              >
                →
              </button>
            </div>
            {copyTargetIsSameMonth ? (
              <p className="mb-4 text-sm text-critical">Pick a different month — this is the month you&apos;re already viewing.</p>
            ) : (
              <p className="mb-4 text-sm text-slate-600">
                {copyCandidateCount} employee{copyCandidateCount === 1 ? '' : 's'} with a pick this month will get that same
                plan applied to {copyTargetMonth?.label}, matched by day-of-month position. If the two months are different
                lengths, the extra days at the end are left alone. A day here left blank (—) leaves any existing pick on the
                matching day untouched — this only fills in, it never clears.
              </p>
            )}
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
                disabled={copying || copyTargetIsSameMonth}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {copying ? 'Copying…' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PasteWeeklyRosterDialog
        open={pasteDialogOpen}
        onClose={() => setPasteDialogOpen(false)}
        initialAnchor={anchor}
        onPasted={() => {
          setPasteDialogOpen(false);
          reload();
        }}
      />
    </div>
  );
}

function MonthlyGroupRows({
  group,
  collapsed,
  onToggle,
  dates,
  today,
  currentValue,
  setCell,
  brush,
  cellClass,
  paintByValue,
  pending,
  hoursFor,
  copiedEmployeeId,
  pastingEmployeeId,
  onCopy,
  onPaste,
  onClearCopy,
}: {
  group: { name: string | null; rows: Employee[] };
  collapsed: boolean;
  onToggle: () => void;
  dates: string[];
  today: string;
  currentValue: (employeeId: string, date: string) => string;
  setCell: (employeeId: string, date: string, value: string) => void;
  brush: string;
  cellClass: (value: string, dirty: boolean) => string;
  paintByValue: Map<string, PaintOption>;
  pending: Record<string, string>;
  hoursFor: (employeeId: string) => number;
  copiedEmployeeId: string | null;
  pastingEmployeeId: string | null;
  onCopy: (id: string) => void;
  onPaste: (id: string) => void;
  onClearCopy: () => void;
}) {
  const colSpan = dates.length + 3;
  return (
    <>
      {group.name && (
        <tr>
          <td colSpan={colSpan} className="border-b border-t border-slate-100 bg-slate-50 p-0">
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left">
              <ChevronIcon className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
              <span className="text-sm font-bold text-ink">{group.name}</span>
              <span className="text-xs text-slate-500">
                {group.rows.length} {group.rows.length === 1 ? 'person' : 'people'}
              </span>
            </button>
          </td>
        </tr>
      )}
      {!collapsed &&
        group.rows.map((emp, i) => {
          const rowBg = i % 2 === 1 ? 'bg-slate-50/60' : 'bg-white';
          const hrs = hoursFor(emp.id);
          const isCopySource = copiedEmployeeId === emp.id;
          return (
            <tr key={emp.id} className="border-b border-slate-100 last:border-0">
              <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 ${rowBg}`}>
                <div className="flex items-center gap-2">
                  <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-9 w-9 text-xs" />
                  <span className="truncate font-medium text-ink">{emp.name}</span>
                </div>
              </td>
              {dates.map(date => {
                const value = currentValue(emp.id, date);
                const dirty = `${emp.id}|${date}` in pending;
                return (
                  <td key={date} className={`px-0.5 py-1.5 text-center ${date === today ? 'bg-accent/5' : rowBg}`}>
                    <button
                      type="button"
                      onClick={() => setCell(emp.id, date, brush)}
                      title={
                        value === UNSET
                          ? `Paint ${emp.name} on ${date} with the selected brush`
                          : `${paintByValue.get(value)?.label}${paintByValue.get(value)?.sub ? ` (${paintByValue.get(value)!.sub})` : ''} — click to paint over it`
                      }
                      className={`h-8 w-9 rounded-md border text-[10px] font-bold shadow-sm transition-transform hover:-translate-y-px hover:shadow ${cellClass(value, dirty)}`}
                    >
                      {value === UNSET ? '—' : paintByValue.get(value)?.abbr}
                    </button>
                  </td>
                );
              })}
              <td className={`whitespace-nowrap px-3 py-1.5 text-right text-sm font-semibold text-ink ${rowBg}`}>
                {hrs > 0 ? `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h` : '—'}
              </td>
              <td className={`whitespace-nowrap px-2 py-1.5 text-center ${rowBg}`}>
                {isCopySource ? (
                  <button
                    type="button"
                    onClick={onClearCopy}
                    title="This employee's plan is copied — click to clear"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-good/40 bg-good-bg text-good-text"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </button>
                ) : copiedEmployeeId ? (
                  <button
                    type="button"
                    onClick={() => onPaste(emp.id)}
                    disabled={pastingEmployeeId === emp.id}
                    title="Paste the copied plan onto this employee"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-accent/40 bg-accent/5 text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    <PasteIcon className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCopy(emp.id)}
                    title="Copy this employee's whole month"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:border-accent/40 hover:text-accent"
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function PasteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 4h6v3H9z" />
      <path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
