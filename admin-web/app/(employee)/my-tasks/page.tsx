'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import TaskHoursChart from '@/components/TaskHoursChart';
import FormDialog from '@/components/employee/FormDialog';
import PointsCard from '@/components/employee/PointsCard';
import { PageBody } from '@/components/employee/parts';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { totalsByTask } from '@/lib/taskHours';
import type { Task, TaskStatus, TaskTimeLog } from '@/lib/types';

const STATUS_TONE: Record<TaskStatus, 'warning' | 'info' | 'neutral' | 'good' | 'critical'> = {
  pending: 'warning',
  in_progress: 'info',
  submitted: 'neutral',
  approved: 'good',
  rejected: 'critical',
};

const FILTERS = ['pending', 'in_progress', 'submitted', 'approved', 'rejected', 'All'] as const;
type Filter = (typeof FILTERS)[number];

const EMPTY_TASK_FORM = { title: '', description: '', due_date: '' };
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';
const INPUT = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
const PRIMARY_SM = 'rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50';
const OUTLINE_SM = 'rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50';

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** The employee's own tasks, laid out like the owner console's Tasks page: filter pills, the task
 * table beside the points and leaderboard, then the hours. Instead of Review, each task carries
 * what the employee does with it — accept it, hold or resume the timer, complete it. */
export default function MyTasksPage() {
  usePageTitle('My Tasks');
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<TaskTimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('All');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
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
    const { error: rpcError } = await supabase.rpc('submit_task', { p_task_id: id, p_work_notes: noteDraft[id] || null });
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

  const filtered = useMemo(() => (filter === 'All' ? tasks : tasks.filter(t => t.status === filter)), [tasks, filter]);
  const taskTotals = useMemo(() => totalsByTask(logs), [logs]);
  const todayIso = useMemo(nepalTodayIso, []);
  const isOverdue = (t: Task) => (t.status === 'pending' || t.status === 'in_progress') && !!t.due_date && t.due_date < todayIso;
  const hoursOf = (taskId: string) => taskTotals.find(r => r.task_id === taskId)?.hours ?? 0;

  /** Title, description, notes and — while it is in progress — the box for what you did. */
  function taskBody(t: Task) {
    const hours = hoursOf(t.id);
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{t.title}</span>
          {t.source === 'self' && <Badge tone="info">Self-assigned</Badge>}
        </div>
        {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
        {hours > 0 && (
          <div className="mt-0.5 text-xs text-slate-400">
            {hours} {hours === 1 ? 'hr' : 'hrs'} logged
          </div>
        )}
        {t.work_notes && (
          <div className="mt-1 text-xs text-slate-500">
            <span className="font-medium">Your note:</span> {t.work_notes}
          </div>
        )}
        {t.review_note && (
          <div className="mt-1 text-xs text-slate-500">
            <span className="font-medium">Review note:</span> {t.review_note}
          </div>
        )}
        {t.status === 'in_progress' && (
          <textarea
            aria-label={`Work notes for ${t.title}`}
            placeholder="What did you do? (optional)"
            value={noteDraft[t.id] ?? ''}
            onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
            rows={2}
            className={`${INPUT} mt-2 max-w-md resize-none text-xs`}
          />
        )}
      </>
    );
  }

  function statusCell(t: Task) {
    const running = runningLog?.task_id === t.id;
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="whitespace-nowrap">
          <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
        </span>
        {running && runningLog && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-accent">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {formatElapsed(runningLog.started_at, now)}
          </span>
        )}
        {isOverdue(t) && <Badge tone="critical">Overdue</Badge>}
      </div>
    );
  }

  function actions(t: Task) {
    const running = runningLog?.task_id === t.id;
    if (t.status === 'pending') {
      return (
        <button disabled={busyId === t.id} onClick={() => startTimer(t.id)} className={PRIMARY_SM}>
          Accept
        </button>
      );
    }
    if (t.status === 'in_progress') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {running && runningLog ? (
            <button disabled={busyId === runningLog.id} onClick={() => stopTimer(runningLog.id)} className={OUTLINE_SM}>
              Hold
            </button>
          ) : !runningLog ? (
            <button disabled={busyId === t.id} onClick={() => startTimer(t.id)} className={OUTLINE_SM}>
              Resume
            </button>
          ) : (
            <span className="text-xs text-slate-400">Timer running on another task</span>
          )}
          <button disabled={busyId === t.id} onClick={() => submit(t.id)} className={PRIMARY_SM}>
            Complete
          </button>
        </div>
      );
    }
    return <span className="text-xs text-slate-400">{t.status === 'submitted' ? 'Awaiting review' : 'Reviewed'}</span>;
  }

  if (loading) {
    return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!employeeId) {
    return <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>;
  }

  const emptyText = `No ${filter !== 'All' ? filter.replace('_', ' ') + ' ' : ''}tasks${filter === 'All' ? ' yet' : ''}.`;
  const maxHours = Math.max(0, ...taskTotals.map(r => r.hours));

  return (
    <PageBody>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
                filter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <button onClick={() => setShowTaskForm(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
          + New Task
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-text">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100 md:hidden">
            {filtered.map(t => (
              <div key={t.id} className={`p-4 ${runningLog?.task_id === t.id ? 'bg-accent/5' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">{taskBody(t)}</div>
                  <div className="shrink-0">{statusCell(t)}</div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {t.points} pts · Due {formatAdDate(t.due_date, system)}
                </div>
                <div className="mt-3">{actions(t)}</div>
              </div>
            ))}
            {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-400">{emptyText}</p>}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Task</th>
                  <th className="w-20 px-5 py-3 font-medium">Points</th>
                  <th className="w-28 px-5 py-3 font-medium">Due</th>
                  <th className="w-36 px-5 py-3 font-medium">Status</th>
                  <th className="w-56 px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className={`border-b border-slate-100 align-top last:border-0 ${runningLog?.task_id === t.id ? 'bg-accent/5' : ''}`}>
                    <td className="px-5 py-3 text-slate-600">{taskBody(t)}</td>
                    <td className="px-5 py-3 text-slate-600">{t.points}</td>
                    <td className="px-5 py-3 text-slate-600">{formatAdDate(t.due_date, system)}</td>
                    <td className="px-5 py-3">{statusCell(t)}</td>
                    <td className="px-5 py-3">{actions(t)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      {emptyText}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <PointsCard employeeId={employeeId} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        <TaskHoursChart logs={logs} tasks={tasks} />

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Hours by Task</h2>
          {taskTotals.length === 0 ? (
            <p className="text-sm text-slate-400">No time logged yet. Accept a task to start the timer.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {taskTotals.map(row => {
                const task = tasks.find(t => t.id === row.task_id);
                return (
                  <div key={row.task_id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-ink">{task?.title ?? 'Deleted task'}</span>
                      <span className="shrink-0 font-semibold text-ink">{row.hours} hrs</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${maxHours > 0 ? (row.hours / maxHours) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showTaskForm && (
        <FormDialog
          title="New Task"
          note="Self-created tasks start with 0 points — HR can award points when they review it."
          onSubmit={handleCreateTask}
          onClose={() => setShowTaskForm(false)}
          saving={creatingTask}
          savingLabel="Creating…"
          submitLabel="Create task"
          error={taskFormError}
        >
          <label htmlFor="new-task-title" className={LABEL}>
            Title
          </label>
          <input id="new-task-title" required value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} className={`${INPUT} mb-3`} />

          <label htmlFor="new-task-description" className={LABEL}>
            Description (optional)
          </label>
          <textarea
            id="new-task-description"
            value={taskForm.description}
            onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
            rows={3}
            className={`${INPUT} mb-3`}
          />

          <label className={LABEL}>Due date (optional)</label>
          <DatePicker value={taskForm.due_date} onChange={v => setTaskForm(f => ({ ...f, due_date: v }))} placeholder="Select due date" ariaLabel="Due date" />
        </FormDialog>
      )}
    </PageBody>
  );
}
