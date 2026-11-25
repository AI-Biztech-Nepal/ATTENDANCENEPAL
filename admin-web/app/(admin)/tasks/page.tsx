'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Avatar from '@/components/Avatar';
import DatePicker from '@/components/DatePicker';
import AssignTaskDialog, { type AssignInitial } from '@/components/tasks/AssignTaskDialog';
import TaskDetailPanel from '@/components/tasks/TaskDetailPanel';
import TaskTimetable from '@/components/tasks/TaskTimetable';
import { STATUS_LABEL, isOpen } from '@/components/tasks/taskStyles';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso, punchMinuteOfDay, resolveShift } from '@/lib/shift';
import {
  addDays,
  formatHourFull,
  formatSlot,
  isOnLeave,
  nowPercent,
  placementsFor,
  rangeWithTasks,
  shiftLength,
  slotEndMs,
  taskSlot,
  weekdayName,
  withTimeStatus,
  workingDay,
} from '@/lib/taskSchedule';
import type { CompanyHoliday, Employee, LeaveRequest, Shift, Task, TaskStatus } from '@/lib/types';

/** What the key above the timetable can filter by: a task status, or people on leave. */
type Filter = TaskStatus | 'leave';

/** The status buttons, in the order they sit after "All". */
const STATUS_FILTERS: TaskStatus[] = ['pending', 'in_progress', 'submitted', 'approved', 'rejected'];

const PRIMARY = 'rounded-[10px] bg-teal-700 text-sm font-extrabold text-white hover:bg-teal-800';
const SELECT = 'h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-ink';
const ROUND_BTN = 'flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

/** The Tasks page: a day timetable — employees down the side, the company's working hours across (from its shifts, a column for every
 * half hour), a block for every task at the time it was assigned for. A block opens the full detail (and the review); a free hour, or the Assign task
 * button, opens the assign dialog. */
export default function TasksPage() {
  usePageTitle('Tasks');
  const { system } = useCalendarSystem();
  const todayIso = useMemo(nepalTodayIso, []);

  // The tasks as stored. `tasks` (below) is what is shown: a task whose time is over counts as completed.
  const [rawTasks, setRawTasks] = useState<Task[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  // The company's shifts: they decide which hours the timetable covers.
  const [shifts, setShifts] = useState<Shift[]>([]);
  // One line saying what the last Assign / Pick a time did, shown above the timetable for a few seconds.
  const [notice, setNotice] = useState<string | null>(null);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());

  const [date, setDate] = useState(todayIso);
  const [department, setDepartment] = useState('');
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [showReviewList, setShowReviewList] = useState(false);
  // The key above the timetable is a set of toggles: none picked = show everything.
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [assign, setAssign] = useState<AssignInitial | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);



  const reload = useCallback(() => {
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).then(({ data }) => setRawTasks((data as Task[] | null) ?? []));
    // Every employee, not just active ones — a resigned employee's historical tasks still need their name resolved
    // (employeeName() below), not "Unknown". Assigning a NEW task is restricted to active employees separately.
    supabase
      .from('employees')
      .select('*')
      .then(({ data }) => setEmployees(((data as Employee[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))));
    // Approved leave that hasn't ended long ago: it greys a person's row and stops a task being put on that day.
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .gte('end_date', addDays(todayIso, -60))
      .then(({ data }) => setLeaves((data as LeaveRequest[] | null) ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[] | null) ?? []));
    // Company holidays from today on, so the Assign form can point one out when a future day is picked.
    supabase
      .from('company_holidays')
      .select('*')
      .gte('holiday_date', todayIso)
      .then(({ data }) => setHolidays((data as CompanyHoliday[] | null) ?? []));
    // Which tasks have a timer running right now, for the pulsing dot on a block.
    supabase
      .from('task_time_logs')
      .select('task_id')
      .is('ended_at', null)
      .then(({ data }) => setRunningTaskIds(new Set(((data as { task_id: string }[] | null) ?? []).map(r => r.task_id))));
  }, [todayIso]);
  useEffect(reload, [reload]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice]);

  // "Now" on the timetable moves once a minute. Read after mount so the server and browser never disagree.
  useEffect(() => {
    const read = () => {
      setNowMin(punchMinuteOfDay(new Date().toISOString()));
      setClock(Date.now());
    };
    read();
    const id = setInterval(read, 60000);
    return () => clearInterval(id);
  }, []);

  const tasks = useMemo(() => rawTasks.map(t => withTimeStatus(t, clock)), [rawTasks, clock]);


  // A task whose time is over is completed. The screen already shows it so (withTimeStatus); this also saves it, once, for the people and
  // screens that read the stored status (an employee cannot change a task, and the phone app reads it), and stops a timer still running
  // on it at the moment its time ended. If saving fails it is tried again a minute later. Since 20261125180000_complete_finished_tasks.sql
  // the database does the same every minute on its own (pg_cron); this stays as a backup, and does nothing once the job has run.
  const swept = useRef(new Set<string>());
  useEffect(() => {
    const due = rawTasks.filter(t => (t.status === 'pending' || t.status === 'in_progress') && withTimeStatus(t, clock).status === 'approved' && !swept.current.has(t.id));
    if (due.length === 0) return;
    const ids = due.map(t => t.id);
    ids.forEach(id => swept.current.add(id));
    (async () => {
      const open = await supabase.from('task_time_logs').select('id, task_id, started_at').in('task_id', ids).is('ended_at', null);
      for (const log of ((open.data as { id: string; task_id: string; started_at: string }[] | null) ?? [])) {
        const end = slotEndMs(due.find(t => t.id === log.task_id)!) ?? Date.now();
        await supabase.from('task_time_logs').update({ ended_at: new Date(Math.max(end, new Date(log.started_at).getTime())).toISOString() }).eq('id', log.id);
      }
      const { error } = await supabase.from('tasks').update({ status: 'approved' }).in('id', ids).in('status', ['pending', 'in_progress']);
      if (error) ids.forEach(id => swept.current.delete(id));
      else reload();
    })();
  }, [rawTasks, clock, reload]);

  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  // The hours the timetable covers follow the company's own shifts (the earliest start to the latest end), with the usual 9 to 6 only
  // when there are no shifts, or when someone has none of their own and works that default one. A shift made for someone who has left
  // does not count.
  const dayShifts = useMemo(() => {
    const active = new Set(employees.filter(e => e.status === 'active').map(e => e.id));
    return shifts.filter(s => !s.employee_id || active.has(s.employee_id));
  }, [shifts, employees]);
  const companyDay = useMemo(() => {
    const usesDefault = employees.some(e => e.status === 'active' && resolveShift(e, shifts).id === 'default');
    return workingDay(dayShifts, usesDefault);
  }, [dayShifts, employees, shifts]);
  // How long each person's own shift is (their own, else their department's, else the default), for "6 h of 8 h booked".
  const capacity = useMemo(() => new Map(employees.map(e => [e.id, shiftLength(resolveShift(e, shifts))] as const).filter(([, h]) => h > 0)), [employees, shifts]);
  // The hours shown for the day on screen: the company's, widened if a task already sits outside them that day.
  const range = useMemo(() => rangeWithTasks(companyDay, tasks, date), [companyDay, tasks, date]);
  const employeeName = (id: string) => employeeById.get(id)?.name ?? 'Unknown';
  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  const departments = useMemo(
    () => Array.from(new Set(activeEmployees.map(e => e.department).filter((d): d is string => !!d))).sort((a, b) => a.localeCompare(b)),
    [activeEmployees]
  );
  const rowEmployees = useMemo(
    () => (department ? activeEmployees.filter(e => e.department === department) : activeEmployees),
    [activeEmployees, department]
  );

  const statuses = useMemo(() => STATUS_FILTERS.filter(s => filters.has(s)), [filters]);
  const showLeave = filters.has('leave');
  // The numbers on the filter buttons: tasks per status on the day shown, and how many people are on leave that day.
  const dayCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = { pending: 0, in_progress: 0, submitted: 0, approved: 0, rejected: 0 };
    let leave = 0;
    for (const emp of rowEmployees) {
      if (isOnLeave(leaves, emp.id, date)) {
        leave += 1;
        continue;
      }
      for (const p of placementsFor(tasks, emp.id, date, range)) counts[p.task.status] += 1;
    }
    return { counts, leave };
  }, [rowEmployees, tasks, leaves, date, range]);
  // "All" counts every task on the day shown, whatever its status.
  const dayTotal = STATUS_FILTERS.reduce((sum, s) => sum + dayCounts.counts[s], 0);

  const submittedTasks = useMemo(
    () => tasks.filter(t => t.status === 'submitted').sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [tasks]
  );
  // Open tasks nobody has given a time yet: every task from before the timetable, and the ones employees add for themselves.
  const unscheduledTasks = useMemo(
    () =>
      tasks
        .filter(t => !taskSlot(t) && isOpen(t.status))
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title)),
    [tasks]
  );
  // The same status filter narrows this list too, so the page doesn't show a Pending task while "In progress" is picked.
  const unscheduledShown = useMemo(
    () => (statuses.length > 0 ? unscheduledTasks.filter(t => statuses.includes(t.status)) : unscheduledTasks),
    [unscheduledTasks, statuses]
  );
  const selectedTask = selectedId ? tasks.find(t => t.id === selectedId) ?? null : null;

  // Every title ever assigned at this company, newest first, deduplicated — "bookmarking" a title happens automatically
  // just by having used it once, and since `tasks` is already RLS-scoped to the caller's own company, every admin/HR
  // user here sees the same shared list without a separate table to store it in.
  const knownTitles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tasks) {
      if (seen.has(t.title)) continue;
      seen.add(t.title);
      out.push(t.title);
    }
    return out;
  }, [tasks]);

  const nowPct = date === todayIso && nowMin !== null ? nowPercent(nowMin, range) : null;
  const nowLabel = nowMin !== null ? formatHourFull(nowMin / 60) : '';
  // After the day's last hour the whole working day is behind the "Now" line (there is no line then), so the open tasks are filled all the way.
  const dayOver = date === todayIso && nowMin !== null && nowMin / 60 > range.end;


  function toggleFilter(f: Filter) {
    setFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }
  const clearFilters = useCallback(() => setFilters(new Set()), []);

  function openAssign(employeeId: string, startHour: number | null) {
    setAssign({ employeeId, date, startHour, scheduleTask: null });
  }

  function pickTime(task: Task) {
    setSelectedId(null);
    setAssign({ employeeId: task.assigned_to, date: task.due_date && task.due_date >= todayIso ? task.due_date : date, startHour: null, scheduleTask: task });
  }

  // Approve or reject a submitted task. Resolves to an error message, or null when it worked.
  async function review(task: Task, status: 'approved' | 'rejected', note: string): Promise<string | null> {
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('tasks')
      .update({
        status,
        review_note: note || null,
        reviewed_by: data.user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', task.id);
    if (error) return error.message;
    reload();
    return null;
  }

  // Cancel a task that has not been reviewed: it is deleted. Time tracked on it refers to it, so that goes first.
  // Resolves to an error message, or null when it worked.
  async function cancelTask(task: Task): Promise<string | null> {
    const logs = await supabase.from('task_time_logs').delete().eq('task_id', task.id).select('id');
    if (logs.error) return `Could not cancel the task: ${logs.error.message}`;
    const { data, error } = await supabase.from('tasks').delete().eq('id', task.id).select('id');
    if (error) return `Could not cancel the task: ${error.message}`;
    // .select() so a delete the security rules turn away is noticed instead of "cancelling" nothing.
    if (!((data as unknown[] | null) ?? []).length) return 'Could not cancel the task: nothing was removed. It may already be gone, or you may not be allowed to remove it.';
    reload();
    setNotice(`Cancelled "${task.title}" for ${employeeName(task.assigned_to)}.`);
    return null;
  }

  const closeDetail = useCallback(() => setSelectedId(null), []);
  const closeAssign = useCallback(() => setAssign(null), []);

  return (
    <>
      <div className="space-y-4">
        {notice && (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-label="Previous day" onClick={() => setDate(d => addDays(d, -1))} className={ROUND_BTN}>
                <ChevronIcon className="h-[18px] w-[18px] rotate-180" />
              </button>
              <div className="w-[190px]">
                <DatePicker value={date} onChange={v => v && setDate(v)} ariaLabel="Timetable day" className="h-11 rounded-xl border-slate-300 font-bold" />
              </div>
              <button type="button" aria-label="Next day" onClick={() => setDate(d => addDays(d, 1))} className={ROUND_BTN}>
                <ChevronIcon className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => setDate(todayIso)}
                disabled={date === todayIso}
                className="min-h-[44px] rounded-full border border-slate-300 bg-white px-[18px] text-[13px] font-bold text-ink hover:bg-slate-50 disabled:opacity-50"
              >
                Today
              </button>
            </div>
            <span className="text-sm font-semibold text-slate-600">
              {weekdayName(date, 'long')}
              {date === todayIso ? ' · Today' : ''}
            </span>
            <select aria-label="Department" value={department} onChange={e => setDepartment(e.target.value)} className={SELECT}>
              <option value="">All departments</option>
              {departments.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => openAssign('', null)}
            className={`${PRIMARY} flex min-h-[44px] items-center gap-2 px-5`}
          >
            <PlusIcon className="h-4 w-4" />
            Assign task
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
          <div role="group" aria-label="Filter the timetable by status" className="flex flex-wrap items-center gap-2">
            <FilterButton on={filters.size === 0} onClick={clearFilters} count={dayTotal}>
              All
            </FilterButton>
            {STATUS_FILTERS.map(status => (
              <FilterButton key={status} on={filters.has(status)} onClick={() => toggleFilter(status)} count={dayCounts.counts[status]}>
                {STATUS_LABEL[status]}
              </FilterButton>
            ))}
            <FilterButton on={showLeave} onClick={() => toggleFilter('leave')} count={dayCounts.leave}>
              On leave
            </FilterButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowReviewList(s => !s)}
              aria-expanded={showReviewList}
              aria-controls="needs-review-list"
              disabled={submittedTasks.length === 0}
              className="min-h-[36px] rounded-full border border-amber-300 bg-amber-50 px-3.5 text-[13px] font-extrabold text-amber-800 disabled:opacity-60"
            >
              {submittedTasks.length} need{submittedTasks.length === 1 ? 's' : ''} review
            </button>
            <a
              href="#not-scheduled"
              className={`flex min-h-[36px] items-center rounded-full border border-slate-300 bg-white px-3.5 text-[13px] font-bold text-slate-700 ${
                unscheduledShown.length === 0 ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              {unscheduledShown.length} not scheduled
            </a>
          </div>
        </div>

        {showReviewList && submittedTasks.length > 0 && (
          <section id="needs-review-list" aria-label="Tasks waiting for review" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <ul className="divide-y divide-amber-100">
              {submittedTasks.map(t => {
                const slot = taskSlot(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className="flex min-h-[48px] w-full flex-wrap items-center justify-between gap-2 py-2 text-left"
                    >
                      <span className="text-sm font-bold text-ink">{t.title}</span>
                      <span className="text-[13px] text-slate-700">
                        {employeeName(t.assigned_to)} · {t.due_date ? `${weekdayName(t.due_date)} ${formatAdDate(t.due_date, system)}` : 'No date'}
                        {slot ? ` · ${formatSlot(slot)}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <TaskTimetable
          range={range}
          capacity={capacity}
          employees={rowEmployees}
          tasks={tasks}
          leaves={leaves}
          date={date}
          today={todayIso}
          nowPct={nowPct}
          nowLabel={nowLabel}
          dayOver={dayOver}
          runningTaskIds={runningTaskIds}
          onOpenTask={t => setSelectedId(t.id)}
          onAssign={openAssign}
          statuses={statuses}
          showLeave={showLeave}
          onClearFilters={clearFilters}
        />

        {unscheduledShown.length > 0 && (
          <section id="not-scheduled" aria-labelledby="not-scheduled-title" className="rounded-xl border border-slate-200 bg-white px-6 pb-2 pt-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="not-scheduled-title" className="text-base font-extrabold text-ink">Not scheduled yet</h2>
              <p className="text-[13px] text-slate-600">Tasks with no time slot. They are not on the timetable until you pick one.</p>
            </div>
            <ul className="mt-3">
              {unscheduledShown.map(t => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-slate-200 py-3.5">
                  <button type="button" onClick={() => setSelectedId(t.id)} className="min-w-[220px] flex-[2_1_240px] text-left">
                    <span className="block text-sm font-bold text-ink">{t.title}</span>
                    <span className="mt-0.5 block text-[12.5px] text-slate-600">
                      {t.source === 'self' ? 'Self-assigned · ' : ''}
                      {t.due_date ? `Due ${weekdayName(t.due_date)} ${formatAdDate(t.due_date, system)}` : 'No due date'}
                    </span>
                  </button>
                  <div className="flex flex-[1_1_180px] items-center gap-2.5">
                    <Avatar name={employeeName(t.assigned_to)} photoUrl={employeeById.get(t.assigned_to)?.profile_photo_url} className="h-8 w-8 text-xs" />
                    <span className="text-sm font-semibold text-ink">{employeeName(t.assigned_to)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => pickTime(t)}
                    className="min-h-[40px] rounded-lg border border-teal-700 px-[18px] text-[13px] font-extrabold text-teal-700 hover:bg-teal-50"
                  >
                    Pick a time
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {selectedTask && (
        <TaskDetailPanel
          key={selectedTask.id}
          task={selectedTask}
          employee={employeeById.get(selectedTask.assigned_to)}
          today={todayIso}
          onClose={closeDetail}
          onReview={review}
          onPickTime={pickTime}
          onCancel={cancelTask}
        />
      )}

      {assign && (
        <AssignTaskDialog
          range={companyDay}
          employees={activeEmployees}
          tasks={tasks}
          leaves={leaves}
          knownTitles={knownTitles}
          today={todayIso}
          holidays={holidays}
          initial={assign}
          onClose={closeAssign}
          onSaved={saved => {
            setAssign(null);
            // Go to the day it was put on, so a task given to a future day does not seem to have vanished.
            setDate(saved.date);
            setNotice(saved.message);
            reload();
          }}
        />
      )}
    </>
  );
}

/** One toggle in the key above the timetable: its swatch, its name, and how many that is on the day shown. */
function FilterButton({
  on,
  onClick,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-[36px] items-center gap-2 rounded-full border px-3 text-[12.5px] font-semibold ${
        on ? 'border-teal-700 bg-teal-50 text-teal-900 ring-1 ring-teal-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
      <span className={`rounded-full px-1.5 text-[11.5px] font-extrabold tabular-nums ${on ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{count}</span>
    </button>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
