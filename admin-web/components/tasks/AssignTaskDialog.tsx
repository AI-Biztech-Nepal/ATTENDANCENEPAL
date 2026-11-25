'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DatePicker from '@/components/DatePicker';
import { formatAdDate, otherCalendarHint } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  SLOT_STEP,
  addDays,
  findClash,
  formatDuration,
  formatHourFull,
  formatSlot,
  hourToTime,
  isOnLeave,
  placementsFor,
  rangeWithTasks,
  relativeDayLabel,
  slotStarts,
  taskSlot,
  weekdayName,
  type DayRange,
  type Slot,
} from '@/lib/taskSchedule';
import type { CompanyHoliday, Employee, LeaveRequest, Task } from '@/lib/types';
import DayStrip from './DayStrip';

export type AssignInitial = {
  employeeId: string;
  /** The day the timetable is showing, YYYY-MM-DD. */
  date: string;
  /** The time that was clicked, in hours (9.5 = 9:30), or null to start at the employee's first free time. */
  startHour: number | null;
  /** Set when the task already exists and only needs a time ("Pick a time"): title and employee are then fixed. */
  scheduleTask: Task | null;
};

type Props = {
  /** The company's working day: the hours a task can be given (widened for a day that already has a task outside them). */
  range: DayRange;
  /** Active employees, in the order they should be listed. */
  employees: Employee[];
  tasks: Task[];
  leaves: LeaveRequest[];
  /** Titles used before, newest first, for the "reuse a title" suggestions. */
  knownTitles: string[];
  /** Today's date (Nepal), YYYY-MM-DD — what "tomorrow" and "in 5 days" are measured from. */
  today: string;
  /** Company holidays from today on, so a holiday can be pointed out when it is picked. */
  holidays: CompanyHoliday[];
  initial: AssignInitial;
  onClose: () => void;
  /** The task was saved: the day it is on (so the timetable can go there) and a sentence saying what happened. */
  onSaved: (saved: { date: string; message: string }) => void;
};

/** The "Today, Tomorrow, then the next five days" row under the date box. */
const QUICK_DAYS = 7;
const CHIP = 'min-h-[36px] rounded-full border px-3 text-[12.5px] font-semibold';
const CHIP_ON = 'border-teal-700 bg-teal-50 text-teal-900 ring-1 ring-teal-700';
const CHIP_OFF = 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

const LABEL = 'mb-1.5 block text-xs font-bold text-slate-700';
const FIELD = 'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink';
const HINT = 'mt-1.5 text-xs text-slate-600';

/** The first time on the day an hour is free for the employee, else the first half hour that is, else the start of the day. */
function firstFreeStart(tasks: Task[], employeeId: string, date: string, range: DayRange, ignoreId?: string): number {
  const starts = slotStarts(range);
  for (const length of [1, SLOT_STEP]) {
    for (const h of starts) {
      if (h + length > range.end) continue;
      if (!findClash(tasks, employeeId, date, { start: h, end: h + length }, ignoreId)) return h;
    }
  }
  return starts[0];
}

/** Assign a task to an employee for a day and time of the working day, in half hours. Opens from the Assign task button, from a
 * click on a free time (employee, day and start time already filled in), or from "Pick a time" on a task that has
 * none yet. It checks the slot as you type — no overlap with the employee's other tasks, nobody on leave — and the
 * database enforces the same, so a stale screen can't double-book anyone. */
export default function AssignTaskDialog({ range: companyRange, employees, tasks, leaves, knownTitles, today, holidays, initial, onClose, onSaved }: Props) {
  const { system } = useCalendarSystem();
  const scheduleTask = initial.scheduleTask;
  const [employeeId, setEmployeeId] = useState(initial.employeeId);
  const [title, setTitle] = useState(scheduleTask?.title ?? '');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(() =>
    initial.startHour ?? (initial.employeeId ? firstFreeStart(tasks, initial.employeeId, initial.date, rangeWithTasks(companyRange, tasks, initial.date), scheduleTask?.id) : companyRange.start)
  );
  const [end, setEnd] = useState(() => Math.min(companyRange.end, (initial.startHour ?? companyRange.start) + 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const titleBoxRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // A slot opened with no start time starts at the first free one; keep the end an hour after it.
  useEffect(() => {
    if (initial.startHour === null) setEnd(Math.min(companyRange.end, start + 1));
    // Only on first open: after that the manager's own choices win.
  }, []);

  useEffect(() => {
    firstFieldRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const employee = employees.find(e => e.id === employeeId);
  // The company's day, widened for the chosen day if a task already sits outside it.
  const range = useMemo(() => rangeWithTasks(companyRange, tasks, date), [companyRange, tasks, date]);
  const startOptions = useMemo(() => slotStarts(range), [range]);
  const slot: Slot = { start, end };
  const onLeave = !!employeeId && !!date && isOnLeave(leaves, employeeId, date);
  const clash = employeeId && date ? findClash(tasks, employeeId, date, slot, scheduleTask?.id) : null;
  const clashSlot = clash ? taskSlot(clash) : null;
  const problem = onLeave
    ? `${employee?.name ?? 'This employee'} is on leave that day.`
    : clash && clashSlot
      ? `Overlaps "${clash.title}" (${formatSlot(clashSlot)}). Pick another time.`
      : null;

  const dayPlacements = useMemo(
    () => (employeeId && date ? placementsFor(tasks, employeeId, date, range).filter(p => p.task.id !== scheduleTask?.id) : []),
    [tasks, employeeId, date, scheduleTask, range]
  );

  const suggestions = useMemo(() => {
    const term = title.trim().toLowerCase();
    const list = term ? knownTitles.filter(t => t.toLowerCase().includes(term)) : knownTitles;
    return list.slice(0, 8);
  }, [knownTitles, title]);

  const canSave = !!employeeId && !!date && (!!scheduleTask || title.trim().length > 0) && !problem && !saving;

  // The date block: one-tap days, a plain-words reading of the chosen day, and anything worth knowing about it.
  const quickDays = useMemo(() => Array.from({ length: QUICK_DAYS }, (_, i) => addDays(today, i)), [today]);
  const dayNumber = (d: string) => formatAdDate(d, system).split(' ')[0];
  const dayHint = date ? otherCalendarHint(date, system) : '';
  const holiday = date
    ? holidays.find(h => h.holiday_date === date && (h.applies_to === 'all' || h.applies_to === employee?.gender)) ?? null
    : null;

  function changeStart(h: number) {
    setStart(h);
    if (end <= h) setEnd(Math.min(range.end, h + 1));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const when = { due_date: date, start_time: hourToTime(start), end_time: hourToTime(end) };
    let failure: string | undefined;
    if (scheduleTask) {
      const { error: updateError } = await supabase.from('tasks').update(when).eq('id', scheduleTask.id);
      failure = updateError?.message;
    } else {
      const { data } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from('tasks').insert({
        assigned_to: employeeId,
        assigned_by: data.user?.id,
        title: title.trim(),
        description: description.trim() || null,
        ...when,
      });
      failure = insertError?.message;
    }
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    onSaved({
      date,
      message: `${scheduleTask ? 'Scheduled' : 'Assigned'} "${scheduleTask?.title ?? title.trim()}" for ${employee?.name ?? 'the employee'} · ${weekdayName(date)} ${formatAdDate(date, system)} · ${formatSlot(slot)}`,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-task-title"
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-xl bg-white p-6 shadow-xl sm:p-7"
      >
        <h2 id="assign-task-title" className="text-xl font-extrabold tracking-tight text-ink">
          {scheduleTask ? 'Pick a time' : 'Assign task'}
        </h2>
        <p className="mb-5 mt-1 text-[13px] leading-relaxed text-slate-600">
          {scheduleTask ? 'Choose the day and time for this task.' : `Pick who, what, and when in the working day (${formatHourFull(range.start)} – ${formatHourFull(range.end)}).`}
        </p>

        <div className="mb-4">
          <label htmlFor="assign-employee" className={LABEL}>Employee</label>
          <select
            id="assign-employee"
            ref={firstFieldRef}
            required
            disabled={!!scheduleTask}
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            className={`${FIELD} disabled:bg-slate-50 disabled:text-slate-600`}
          >
            <option value="" disabled>Select employee…</option>
            {employees.map(emp => {
              const away = !!date && isOnLeave(leaves, emp.id, date);
              return (
                <option key={emp.id} value={emp.id} disabled={away}>
                  {emp.name}
                  {emp.department ? ` · ${emp.department}` : ''}
                  {away ? ' (on leave)' : ''}
                </option>
              );
            })}
          </select>
          <p className={HINT}>Active employees who are not on leave that day.</p>
        </div>

        <div className="mb-4">
          <label htmlFor="assign-title" className={LABEL}>Title</label>
          <div
            ref={titleBoxRef}
            tabIndex={-1}
            onBlur={e => {
              if (!titleBoxRef.current?.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
            }}
            className="relative"
          >
            <input
              id="assign-title"
              required={!scheduleTask}
              disabled={!!scheduleTask}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="e.g. Website development"
              autoComplete="off"
              className={`${FIELD} disabled:bg-slate-50 disabled:text-slate-600`}
            />
            {!scheduleTask && suggestionsOpen && suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {suggestions.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTitle(t);
                      setSuggestionsOpen(false);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!scheduleTask && <p className={HINT}>Titles you used before show up here. Pick one to reuse it instead of retyping.</p>}
        </div>

        {!scheduleTask && (
          <div className="mb-4">
            <label htmlFor="assign-description" className={LABEL}>
              Description <span className="font-medium text-slate-600">(optional)</span>
            </label>
            <textarea
              id="assign-description"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>
        )}

        <div className="mb-3">
          <span className={LABEL}>Date</span>
          <DatePicker value={date} onChange={v => v && setDate(v)} ariaLabel="Date" className="h-11 rounded-[10px] border-slate-300 font-semibold" />
          <div role="group" aria-label="Quick dates" className="mt-2 flex flex-wrap gap-1.5">
            {quickDays.map((d, i) => (
              <button key={d} type="button" aria-pressed={date === d} onClick={() => setDate(d)} className={`${CHIP} ${date === d ? CHIP_ON : CHIP_OFF}`}>
                {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${weekdayName(d)} ${dayNumber(d)}`}
              </button>
            ))}
          </div>
          {date && (
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {weekdayName(date, 'long')}, {relativeDayLabel(date, today)}
              {dayHint ? ` · ${dayHint}` : ''}
            </p>
          )}
          {date && date < today && (
            <p role="status" className="mt-1 text-xs font-semibold text-amber-800">
              This day has already passed.
            </p>
          )}
          {holiday && (
            <p role="status" className="mt-1 text-xs font-semibold text-amber-800">
              {holiday.name} is a holiday. You can still assign work.
            </p>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="assign-from" className={LABEL}>From</label>
            <select id="assign-from" value={start} onChange={e => changeStart(Number(e.target.value))} className={FIELD}>
              {startOptions.map(h => (
                <option key={h} value={h}>{formatHourFull(h)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assign-to" className={LABEL}>To</label>
            <select id="assign-to" value={end} onChange={e => setEnd(Number(e.target.value))} className={FIELD}>
              {startOptions.filter(h => h + SLOT_STEP > start).map(h => (
                <option key={h + SLOT_STEP} value={h + SLOT_STEP}>{formatHourFull(h + SLOT_STEP)}</option>
              ))}
            </select>
          </div>
        </div>
        {scheduleTask && <p className="-mt-1 mb-3 text-xs text-slate-600">The day you pick also becomes the task&apos;s deadline.</p>}

        {employee && (
          <div className="mb-4 rounded-[10px] border border-slate-200 bg-slate-50 p-3.5">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <div className="text-[13px] font-extrabold text-ink">{employee.name}&apos;s day</div>
              <div className={`text-[13px] font-bold ${problem ? 'text-rose-700' : 'text-teal-700'}`}>
                {formatSlot(slot)} · {formatDuration(end - start)}
              </div>
            </div>
            <DayStrip
              range={range}
              placements={dayPlacements}
              extra={slot}
              extraClashes={!!problem}
              showHours
              label={`${employee.name}'s day: ${dayPlacements.length} task${dayPlacements.length === 1 ? '' : 's'} booked; the new task is ${formatSlot(slot)}`}
            />
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700">
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] border-2 border-dashed border-teal-700 bg-teal-100" />This task</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] border border-slate-300 bg-slate-100" />Already booked</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] border border-slate-200 bg-white" />Free</span>
            </div>
          </div>
        )}

        {problem && (
          <p role="alert" className="mb-4 text-sm font-semibold text-critical-text">
            {problem}
          </p>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-critical-text">{error}</p>}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-[10px] px-5 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="min-h-[44px] rounded-[10px] bg-teal-700 px-[22px] text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : scheduleTask ? 'Save time' : 'Assign task'}
          </button>
        </div>
      </form>
    </div>
  );
}
