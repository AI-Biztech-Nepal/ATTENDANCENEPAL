'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { ClockIcon, StatusTag, type TagTone } from '@/components/employee/parts';
import PointsCard from '@/components/employee/PointsCard';
import DatePicker from '@/components/DatePicker';
import TaskHoursChart from '@/components/TaskHoursChart';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { totalsByTask } from '@/lib/taskHours';
import type { Task, TaskStatus, TaskTimeLog } from '@/lib/types';

const STATUS_TONE: Record<TaskStatus, TagTone> = {
  pending: 'warning',
  in_progress: 'info',
  submitted: 'neutral',
  approved: 'good',
  rejected: 'critical',
};

// The board's four columns. A rejected task has been reviewed, so it sits with the approved ones.
const COLUMNS: { key: string; title: string; statuses: TaskStatus[] }[] = [
  { key: 'todo', title: 'To do', statuses: ['pending'] },
  { key: 'doing', title: 'In progress', statuses: ['in_progress'] },
  { key: 'review', title: 'Waiting for review', statuses: ['submitted'] },
  { key: 'done', title: 'Done', statuses: ['approved', 'rejected'] },
];

const EMPTY_TASK_FORM = { title: '', description: '', due_date: '' };

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function MyTasksPage() {
  usePageTitle('My Tasks');
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<TaskTimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hoursTab, setHoursTab] = useState<'task' | 'time'>('task');

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTasks(data ?? []));
    supabase
      .from('task_time_logs')
      .select('*')
      .eq('employee_id', empId)
      .then(({ data }) => setLogs(data ?? []));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (profile?.employee_id) {
        setEmployeeId(profile.employee_id);
        reload(profile.employee_id);
      }
    });
  }, []);

  const runningLog = logs.find(l => l.ended_at === null) ?? null;

  useEffect(() => {
    if (!runningLog) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [runningLog]);

  async function startTimer(taskId: string) {
    setBusyId(taskId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('start_task_timer', { p_task_id: taskId });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (employeeId) reload(employeeId);
  }

  async function stopTimer(logId: string) {
    setBusyId(logId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('stop_task_timer', { p_log_id: logId });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (employeeId) reload(employeeId);
  }

  async function submit(id: string) {
    setBusyId(id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('submit_task', {
      p_task_id: id,
      p_work_notes: noteDraft[id] || null,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (employeeId) reload(employeeId);
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setTaskFormError(null);
    setCreatingTask(true);
    const { error: insertError } = await supabase.from('tasks').insert({
      title: taskForm.title,
      description: taskForm.description || null,
      due_date: taskForm.due_date || null,
      assigned_to: employeeId,
      assigned_by: userId,
      points: 0,
      status: 'pending',
      source: 'self',
    });
    setCreatingTask(false);
    if (insertError) {
      setTaskFormError(insertError.message);
      return;
    }
    setTaskForm(EMPTY_TASK_FORM);
    setShowTaskForm(false);
    reload(employeeId);
  }

  const taskTotals = totalsByTask(logs);
  const taskHours = (taskId: string) => taskTotals.find(t => t.task_id === taskId)?.hours ?? 0;
  const maxHours = Math.max(0, ...taskTotals.map(r => r.hours));

  // One card per task, the same on a phone (a single list, grouped like the board) and on a
  // computer (inside its column).
  function renderTask(t: Task, colKey: string) {
    const isRunningHere = runningLog?.task_id === t.id;
    const hours = taskHours(t.id);
    const meta = [
      `${t.points} pts`,
      t.due_date ? `Due ${formatAdDate(t.due_date, system)}` : null,
      hours > 0 ? `${hours} ${hours === 1 ? 'hr' : 'hrs'} logged` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const actionBtn = 'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-extrabold disabled:opacity-60 lg:h-11 lg:text-[13px]';
    return (
      <article
        key={t.id}
        className={`rounded-2xl bg-white ${isRunningHere ? 'border-2 border-brand p-3 lg:p-[15px]' : 'border border-slate-200 p-3.5 lg:p-4'}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-extrabold leading-5">
            {t.title}
            {t.source === 'self' && <span className="ml-1.5 text-[11px] font-medium text-slate-500 lg:hidden">(self-created)</span>}
          </h3>
          {isRunningHere ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-[13px] font-extrabold tabular-nums text-brand">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand" />
              {formatElapsed(runningLog.started_at, now)}
            </span>
          ) : (
            /* On the board the column already says the status; only the Done column needs the verdict. */
            <span className={colKey === 'done' ? '' : 'lg:hidden'}>
              <StatusTag tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</StatusTag>
            </span>
          )}
        </div>
        {t.source === 'self' && <p className="mt-0.5 hidden text-[11px] font-semibold text-[#586474] lg:block">Self-created</p>}
        {t.description && <p className="mt-1 text-[13px] font-medium leading-[18px] text-slate-600 lg:mt-1.5">{t.description}</p>}
        <p className="mt-1.5 text-xs font-semibold text-slate-500 lg:mt-2 lg:text-[#586474]">{meta}</p>

        {t.review_note && (
          <p className="mt-2 rounded-[10px] bg-slate-50 px-2.5 py-2 text-[13px] leading-[18px] text-slate-600 lg:mt-2.5 lg:bg-slate-100 lg:px-3 lg:py-2.5">
            <b>Feedback:</b> {t.review_note}
          </p>
        )}

        {t.status === 'pending' && (
          <button
            disabled={busyId === t.id}
            onClick={() => startTimer(t.id)}
            className={`${actionBtn} mt-2.5 bg-brand text-white lg:mt-3`}
          >
            <CheckIcon className="h-4 w-4" />
            Accept Task
          </button>
        )}

        {t.status === 'in_progress' && (
          <div className="mt-2.5 lg:mt-3">
            {runningLog && !isRunningHere && (
              <p className="mb-3 rounded-[10px] bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-600">
                Timer running on another task — hold it first to resume this one.
              </p>
            )}
            <label htmlFor={`note-${t.id}`} className="mb-1.5 block text-xs font-bold text-slate-600">
              Work notes
            </label>
            <textarea
              id={`note-${t.id}`}
              placeholder="What did you do? (optional)"
              value={noteDraft[t.id] ?? ''}
              onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
              rows={2}
              className="h-16 w-full resize-none rounded-[10px] border border-slate-300 px-3 py-2.5 text-[13px] font-medium text-ink placeholder:text-slate-400"
            />
            <div className="mt-2.5 flex gap-2">
              {isRunningHere ? (
                <button
                  disabled={busyId === runningLog.id}
                  onClick={() => stopTimer(runningLog.id)}
                  className={`${actionBtn} flex-1 border border-slate-300 bg-white text-brand hover:bg-slate-50`}
                >
                  <PauseIcon className="h-3.5 w-3.5" />
                  Hold
                </button>
              ) : !runningLog ? (
                <button
                  disabled={busyId === t.id}
                  onClick={() => startTimer(t.id)}
                  className={`${actionBtn} flex-1 border border-slate-300 bg-white text-brand hover:bg-slate-50`}
                >
                  <PlayIcon className="h-3.5 w-3.5" />
                  Resume
                </button>
              ) : null}
              <button
                disabled={busyId === t.id}
                onClick={() => submit(t.id)}
                className={`${actionBtn} flex-1 bg-brand text-white hover:bg-brand/90`}
              >
                <CheckIcon className="h-4 w-4" />
                Complete
              </button>
            </div>
          </div>
        )}

        {t.status === 'submitted' && (
          <p className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-slate-600 lg:mt-3 lg:rounded-[10px] lg:bg-slate-100 lg:px-3 lg:py-2.5">
            <ClockIcon className="hidden h-4 w-4 lg:block" />
            <span>
              Awaiting review<span className="lg:hidden">.</span>
            </span>
          </p>
        )}
      </article>
    );
  }

  if (loading) {
    return (
      <>
        <p className="p-4 text-center text-sm text-slate-500">Loading…</p>
      </>
    );
  }

  const taskCount = tasks.length === 0 ? 'No tasks yet' : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;

  return (
    <>
      {!employeeId ? (
        <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <div className="lg:px-8 lg:pb-10 lg:pt-7">
          {/* Computer: how many tasks, and the way to add one. A phone has its own "Tasks" row below. */}
          <div className="mb-5 hidden items-center justify-between gap-4 lg:flex">
            <p className="text-base font-bold text-slate-700">
              {taskCount}
              {runningLog ? ' · 1 timer running' : ''}
            </p>
            <button
              onClick={() => setShowTaskForm(true)}
              className="flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand/90"
            >
              <PlusIcon className="h-[18px] w-[18px]" />
              New task
            </button>
          </div>

          <div className="mx-4 mt-4 lg:mx-0 lg:mt-0">
            <div className="mb-2.5 flex items-center justify-between lg:hidden">
              <h2 className="text-base font-extrabold">Tasks</h2>
              <button onClick={() => setShowTaskForm(true)} className="h-11 rounded-xl bg-brand px-4 text-[13px] font-extrabold text-white">
                + New Task
              </button>
            </div>

            {error && (
              <p role="alert" className="mb-3 rounded-xl bg-[#fee2e2] px-3.5 py-2.5 text-sm font-semibold text-[#b91c1c]">
                {error}
              </p>
            )}

            {tasks.length === 0 && <p className="py-6 text-center text-sm text-slate-500 lg:hidden">No tasks yet.</p>}

            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(230px,1fr))] lg:items-start lg:gap-4">
              {COLUMNS.map(col => {
                const items = tasks.filter(t => col.statuses.includes(t.status));
                return (
                  <section
                    key={col.key}
                    aria-label={col.title}
                    className="contents lg:block lg:rounded-[20px] lg:bg-[#e8edf3] lg:p-3"
                  >
                    <div className="hidden h-10 items-center justify-between px-1.5 lg:flex">
                      <h2 className="text-sm font-extrabold">{col.title}</h2>
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-xl bg-white px-2 text-xs font-extrabold text-slate-600">
                        {items.length}
                      </span>
                    </div>
                    <div className="contents lg:flex lg:flex-col lg:gap-2.5">
                      {items.map(t => renderTask(t, col.key))}
                      {items.length === 0 && <p className="hidden px-1.5 pb-3 pt-1 text-[13px] font-semibold text-slate-500 lg:block">Nothing here</p>}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-6">
              <section aria-label="Hours" className="rounded-2xl border border-slate-200 bg-white p-3.5 lg:rounded-[20px] lg:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-extrabold lg:text-lg lg:leading-6">Hours</h2>
                  <div role="group" aria-label="Hours view" className="flex rounded-xl bg-slate-100 p-[3px]">
                    {(
                      [
                        ['task', 'By task'],
                        ['time', 'Over time'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setHoursTab(key)}
                        aria-pressed={hoursTab === key}
                        className={`h-9 rounded-[9px] px-3.5 text-[13px] ${
                          hoursTab === key ? 'bg-white font-extrabold text-brand shadow-[0_1px_2px_rgba(15,23,42,0.12)]' : 'font-bold text-slate-600 hover:text-ink'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {hoursTab === 'task' ? (
                  taskTotals.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-600">No time logged yet. Accept a task to start the timer.</p>
                  ) : (
                    taskTotals.map(row => {
                      const task = tasks.find(t => t.id === row.task_id);
                      const pct = maxHours > 0 ? (row.hours / maxHours) * 100 : 0;
                      return (
                        <div key={row.task_id} className="mb-3 last:mb-0 lg:mb-0 lg:flex lg:h-[42px] lg:items-center lg:gap-5">
                          <div className="flex justify-between text-xs font-semibold lg:block lg:w-[210px] lg:shrink-0 lg:text-sm">
                            <span className="truncate">{task?.title ?? 'Deleted task'}</span>
                            <span className="font-extrabold tabular-nums lg:hidden">{row.hours}</span>
                          </div>
                          <div className="mt-1 h-2.5 rounded-[5px] bg-slate-100 lg:mt-0 lg:flex-1">
                            <div className="h-2.5 rounded-[5px] bg-brand" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="hidden w-12 shrink-0 text-right text-sm font-extrabold tabular-nums lg:block">{row.hours} h</span>
                        </div>
                      );
                    })
                  )
                ) : (
                  <TaskHoursChart logs={logs} tasks={tasks} bare />
                )}
              </section>
              <PointsCard employeeId={employeeId} />
            </div>
          </div>
        </div>
      )}

      {showTaskForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleCreateTask} className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-xl">
            <h3 className="text-xl font-extrabold">New Task</h3>
            <p className="mb-4 mt-1 text-[13px] font-medium text-slate-600">
              Self-created tasks start with 0 points — HR can award points when they review it.
            </p>

            <label htmlFor="new-task-title" className="mb-1.5 block text-xs font-bold text-slate-600">
              Title
            </label>
            <input
              id="new-task-title"
              required
              value={taskForm.title}
              onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
              className="mb-3 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium"
            />

            <label htmlFor="new-task-description" className="mb-1.5 block text-xs font-bold text-slate-600">
              Description (optional)
            </label>
            <textarea
              id="new-task-description"
              value={taskForm.description}
              onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium"
            />

            <label className="mb-1.5 block text-xs font-bold text-slate-600">Due date (optional)</label>
            <div className="mb-3">
              <DatePicker value={taskForm.due_date} onChange={v => setTaskForm(f => ({ ...f, due_date: v }))} placeholder="Select due date" />
            </div>

            {taskFormError && <p className="mb-3 text-sm font-semibold text-[#b91c1c]">{taskFormError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTaskForm(false)}
                className="h-11 rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingTask}
                className="h-11 rounded-xl bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand/90 disabled:opacity-60"
              >
                {creatingTask ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className={className} aria-hidden="true">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  );
}
