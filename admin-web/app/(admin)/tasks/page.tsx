'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Avatar from '@/components/Avatar';
import DatePicker from '@/components/DatePicker';
import TaskHoursChart from '@/components/TaskHoursChart';
import AssignTaskDialog, { type AssignInitial } from '@/components/tasks/AssignTaskDialog';
import TaskDetailPanel from '@/components/tasks/TaskDetailPanel';
import TaskTimetable from '@/components/tasks/TaskTimetable';
import { STATUS_LABEL, isOpen } from '@/components/tasks/taskStyles';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso, punchMinuteOfDay } from '@/lib/shift';
import { totalsByTask } from '@/lib/taskHours';
import {
  addDays,
  formatHourFull,
  formatSlot,
  isOnLeave,
  nowPercent,
  placementsFor,
  taskSlot,
  weekdayName,
} from '@/lib/taskSchedule';
import type { CompanyHoliday, Employee, LeaveRequest, Task, TaskStatus, TaskTimeLog } from '@/lib/types';

type Tab = 'schedule' | 'hours';
/** What the key above the timetable can filter by: a task status, or people on leave. */
type Filter = TaskStatus | 'leave';

/** The status buttons, in the order they sit after "All". */
const STATUS_FILTERS: TaskStatus[] = ['pending', 'in_progress', 'submitted', 'approved', 'rejected'];

const PRIMARY = 'rounded-[10px] bg-teal-700 text-sm font-extrabold text-white hover:bg-teal-800';
const SELECT = 'h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-ink';
const ROUND_BTN = 'flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

/** The Tasks page: a day timetable — employees down the side, the working hours 9 to 6 across, a block for every task
 * at the hours it was assigned for. A block opens the full detail (and the review); a free hour, or the Assign task
 * button, opens the assign dialog. The hours worked sit on their own tab. */
export default function TasksPage() {
  usePageTitle('Tasks');
  const { system } = useCalendarSystem();
  const todayIso = useMemo(nepalTodayIso, []);

  const [tab, setTab] = useState<Tab>('schedule');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
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

  const [hoursEmployeeId, setHoursEmployeeId] = useState('');
  const [hoursLogs, setHoursLogs] = useState<TaskTimeLog[]>([]);


  const reload = useCallback(() => {
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).then(({ data }) => setTasks((data as Task[] | null) ?? []));
    // Every employee, not just active ones — a resigned employee's historical tasks still need their name resolved
    // (employeeName() below), not "Unknown". Assigning a NEW task is restricted to active employees separately.
    supabase
      .from('employees')
      .select('*')
      .then(({ data }) => {
        const sorted = ((data as Employee[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setEmployees(sorted);
        const firstActive = sorted.find(e => e.status === 'active');
        if (firstActive) setHoursEmployeeId(prev => prev || firstActive.id);
      });
    // Approved leave that hasn't ended long ago: it greys a person's row and stops a task being put on that day.
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .gte('end_date', addDays(todayIso, -60))
      .then(({ data }) => setLeaves((data as LeaveRequest[] | null) ?? []));
    // Company holidays from today on, so the Assign form can point one out when a future day is picked.
    supabase
      .from('company_holidays')
      .select('*')
      .gte('holiday_date', todayIso)
      .then(({ data }) => setHolidays((data as CompanyHoliday[] | null) ?? []));
    // Which tasks have a timer running right now, for the green dot on a block.
    supabase
      .from('task_time_logs')
      .select('task_id')
      .is('ended_at', null)
      .then(({ data }) => setRunningTaskIds(new Set(((data as { task_id: string }[] | null) ?? []).map(r => r.task_id))));
  }, [todayIso]);
  useEffect(reload, [reload]);

  useEffect(() => {
    if (!hoursEmployeeId) return;
    supabase
      .from('task_time_logs')
      .select('*')
      .eq('employee_id', hoursEmployeeId)
      .then(({ data }) => setHoursLogs((data as TaskTimeLog[] | null) ?? []));
  }, [hoursEmployeeId]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice]);

  // "Now" on the timetable moves once a minute. Read after mount so the server and browser never disagree.
  useEffect(() => {
    const read = () => setNowMin(punchMinuteOfDay(new Date().toISOString()));
    read();
    const id = setInterval(read, 60000);
    return () => clearInterval(id);
  }, []);

  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
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
      for (const p of placementsFor(tasks, emp.id, date)) counts[p.task.status] += 1;
    }
    return { counts, leave };
  }, [rowEmployees, tasks, leaves, date]);
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

  const nowPct = date === todayIso && nowMin !== null ? nowPercent(nowMin) : null;
  const nowLabel = nowMin !== null ? formatHourFull(nowMin / 60) : '';

  const hoursTaskTotals = useMemo(() => totalsByTask(hoursLogs), [hoursLogs]);
  const employeeTasks = useMemo(() => tasks.filter(t => t.assigned_to === hoursEmployeeId), [tasks, hoursEmployeeId]);

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

  const closeDetail = useCallback(() => setSelectedId(null), []);
  const closeAssign = useCallback(() => setAssign(null), []);

  const TAB_BASE = 'flex min-h-[48px] shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-0.5 text-sm';

  return (
    <>
      <div role="tablist" aria-label="Tasks sections" className="mb-5 flex gap-x-7 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] md:overflow-visible [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          role="tab"
          id="tab-schedule"
          aria-selected={tab === 'schedule'}
          aria-controls="panel-schedule"
          onClick={() => setTab('schedule')}
          className={`${TAB_BASE} -mb-px ${tab === 'schedule' ? 'border-teal-700 font-extrabold text-teal-700' : 'border-transparent font-bold text-slate-600 hover:text-ink'}`}
        >
          Schedule
        </button>
        <button
          type="button"
          role="tab"
          id="tab-hours"
          aria-selected={tab === 'hours'}
          aria-controls="panel-hours"
          onClick={() => setTab('hours')}
          className={`${TAB_BASE} -mb-px ${tab === 'hours' ? 'border-teal-700 font-extrabold text-teal-700' : 'border-transparent font-bold text-slate-600 hover:text-ink'}`}
        >
          Hours
        </button>
      </div>

      {tab === 'schedule' && (
        <div role="tabpanel" id="panel-schedule" aria-labelledby="tab-schedule" className="space-y-4">
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
            employees={rowEmployees}
            tasks={tasks}
            leaves={leaves}
            date={date}
            today={todayIso}
            nowPct={nowPct}
            nowLabel={nowLabel}
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
      )}

      {tab === 'hours' && (
        <div role="tabpanel" id="panel-hours" aria-labelledby="tab-hours">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 max-w-xs">
                <label htmlFor="hours-employee" className="mb-1 block text-xs font-medium text-slate-600">Hours worked by</label>
                <select
                  id="hours-employee"
                  value={hoursEmployeeId}
                  onChange={e => setHoursEmployeeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
              <h2 className="mb-3 text-sm font-semibold text-ink">Hours by Task</h2>
              {hoursTaskTotals.length === 0 ? (
                <p className="text-sm text-slate-400">No time logged yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {hoursTaskTotals.map(row => {
                    const task = employeeTasks.find(t => t.id === row.task_id);
                    return (
                      <div key={row.task_id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-ink">{task?.title ?? 'Deleted task'}</span>
                        <span className="font-semibold text-ink">{row.hours} hrs</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <TaskHoursChart logs={hoursLogs} tasks={employeeTasks} />
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <TaskDetailPanel
          key={selectedTask.id}
          task={selectedTask}
          employee={employeeById.get(selectedTask.assigned_to)}
          today={todayIso}
          onClose={closeDetail}
          onReview={review}
          onPickTime={pickTime}
        />
      )}

      {assign && (
        <AssignTaskDialog
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
