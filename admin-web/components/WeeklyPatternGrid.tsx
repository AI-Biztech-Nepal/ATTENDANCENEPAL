'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import DepartmentDropdown from '@/components/DepartmentDropdown';
import PasteWeeklyRosterDialog from '@/components/PasteWeeklyRosterDialog';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { useConfirm } from '@/components/ConfirmDialog';
import { todayAnchor } from '@/lib/calendar';
import { buildPaintOptions, departmentOf, UNSET, WEEK_OFF_VALUE, type PaintOption } from '@/lib/shiftPalette';
import type { Employee, Shift } from '@/lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type PatternRow = { employee_id: string; weekday: number; shift_id: string | null };

/** The weekly-mode roster editor: one row per employee, Sun-Sat columns —
 * click a brush above, then click a day to paint it, instead of opening a
 * dropdown per cell. Grouped by department (when a company actually uses
 * more than one), searchable, with per-row copy/paste and a Save-changes
 * bar so nothing writes until you save — matching the Attendance Report's
 * own staged-edit pattern. */
export default function WeeklyPatternGrid() {
  const confirm = useConfirm();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [patternRows, setPatternRows] = useState<PatternRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedEmployeeId, setCopiedEmployeeId] = useState<string | null>(null);
  const [pastingEmployeeId, setPastingEmployeeId] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const [brush, setBrush] = useState<string>(WEEK_OFF_VALUE);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);

  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const shiftById = useMemo(() => new Map(templateShifts.map(s => [s.id, s])), [templateShifts]);
  const paintOptions = useMemo(() => buildPaintOptions(templateShifts), [templateShifts]);
  const paintByValue = useMemo(() => new Map(paintOptions.map(o => [o.value, o])), [paintOptions]);
  const weekdays = [0, 1, 2, 3, 4, 5, 6];

  // A brush the last-loaded shift list no longer has (a template got
  // deleted while it was selected) falls back to Week Off rather than
  // painting an id that no longer exists.
  useEffect(() => {
    if (templateShifts.length > 0 && brush !== WEEK_OFF_VALUE && brush !== UNSET && !shiftById.has(brush)) {
      setBrush(WEEK_OFF_VALUE);
    }
  }, [templateShifts, shiftById, brush]);

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

  // Department grouping only earns its keep once a company actually has
  // more than one — a single-department (or department-less) company gets
  // a flat list instead of a dropdown and collapsible header that would
  // always show exactly one, always-open group.
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
    return weekdays.reduce((sum, wd) => {
      const v = currentValue(employeeId, wd);
      if (v === UNSET || v === WEEK_OFF_VALUE) return sum;
      const shift = shiftById.get(v);
      if (!shift) return sum;
      const [sh, sm] = shift.start_time.split(':').map(Number);
      const [eh, em] = shift.end_time.split(':').map(Number);
      let minutes = eh * 60 + em - (sh * 60 + sm);
      if (minutes <= 0) minutes += 24 * 60; // overnight shift
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
          <span className="text-sm font-semibold text-ink">Weekly Roster</span>
          <p className="text-xs text-slate-500">One Sun–Sat pattern that repeats every week.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search employees"
              className="h-9 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {useDepartments && <DepartmentDropdown options={deptOptions} value={dept} onChange={setDept} />}
          <button
            type="button"
            onClick={() => setPasteDialogOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-accent px-3 text-sm font-semibold text-accent shadow-sm hover:bg-accent/5"
          >
            <CopyIcon className="h-3.5 w-3.5" />
            Copy to Monthly Roster
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
                  active ? 'border-ink bg-ink text-white shadow-sm' : `border-slate-200 bg-white text-slate-600 hover:border-slate-300`
                }`}
              >
                {o.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-white' : o.dot}`} />}
                {o.label}
                {o.sub && <span className="font-normal opacity-70">{o.sub}</span>}
              </button>
            );
          })}
        </div>
        <span className="ml-auto hidden text-xs text-slate-400 sm:inline">
          Click a day to paint it with <strong className="text-ink">{paintByValue.get(brush)?.label}</strong>
        </span>
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
            Copied {employees.find(e => e.id === copiedEmployeeId)?.name ?? 'an employee'}&apos;s pattern — click the paste
            icon on any other row to apply it. Saves immediately, as many times as you like.
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
            Create at least one shift above first (e.g. Day Duty, Night Duty, Day &amp; Night Duty) — this pattern assigns
            one of those to each employee per weekday.
          </p>
        ) : (
          <>
          <HorizontalScrollButtons targetRef={tableScrollRef} />
          <div ref={tableScrollRef} className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2.5 font-medium">Employee</th>
                  {weekdays.map(wd => (
                    <th key={wd} className="whitespace-nowrap px-1.5 py-2.5 text-center font-medium">
                      {WEEKDAY_LABELS[wd]}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Hours/wk</th>
                  <th className="whitespace-nowrap px-2 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <GroupRows
                    key={group.name ?? '__all'}
                    group={group}
                    collapsed={!!(group.name && collapsed[group.name])}
                    onToggle={() => group.name && setCollapsed(c => ({ ...c, [group.name!]: !c[group.name!] }))}
                    weekdays={weekdays}
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
                    <td colSpan={weekdays.length + 3} className="px-4 py-8 text-center text-sm text-slate-400">
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

      <PasteWeeklyRosterDialog
        open={pasteDialogOpen}
        onClose={() => setPasteDialogOpen(false)}
        initialAnchor={todayAnchor()}
        onPasted={() => setPasteDialogOpen(false)}
      />
    </div>
  );
}

function GroupRows({
  group,
  collapsed,
  onToggle,
  weekdays,
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
  weekdays: number[];
  currentValue: (employeeId: string, weekday: number) => string;
  setCell: (employeeId: string, weekday: number, value: string) => void;
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
  const colSpan = weekdays.length + 3;
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
                  <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-10 w-10 text-sm" />
                  <span className="truncate font-medium text-ink">{emp.name}</span>
                </div>
              </td>
              {weekdays.map(wd => {
                const value = currentValue(emp.id, wd);
                const dirty = `${emp.id}|${wd}` in pending;
                return (
                  <td key={wd} className={`px-1 py-1.5 text-center ${rowBg}`}>
                    <button
                      type="button"
                      onClick={() => setCell(emp.id, wd, brush)}
                      title={
                        value === UNSET
                          ? `Paint ${emp.name}'s ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd]} with the selected brush`
                          : `${paintByValue.get(value)?.label}${paintByValue.get(value)?.sub ? ` (${paintByValue.get(value)!.sub})` : ''} — click to paint over it`
                      }
                      className={`flex h-9 w-full flex-col items-center justify-center gap-0 truncate rounded-md border px-1 text-xs font-semibold leading-tight shadow-sm transition-transform hover:-translate-y-px hover:shadow ${cellClass(value, dirty)}`}
                    >
                      {value === UNSET ? (
                        '—'
                      ) : (
                        <>
                          <span className="w-full truncate">{paintByValue.get(value)?.label}</span>
                          {paintByValue.get(value)?.sub && (
                            <span className="w-full truncate text-[9px] font-normal opacity-70">{paintByValue.get(value)!.sub}</span>
                          )}
                        </>
                      )}
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
                    title="This employee's pattern is copied — click to clear"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-good/40 bg-good-bg text-good-text"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </button>
                ) : copiedEmployeeId ? (
                  <button
                    type="button"
                    onClick={() => onPaste(emp.id)}
                    disabled={pastingEmployeeId === emp.id}
                    title="Paste the copied pattern onto this employee"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-accent/40 bg-accent/5 text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    <PasteIcon className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCopy(emp.id)}
                    title="Copy this employee's whole week"
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
