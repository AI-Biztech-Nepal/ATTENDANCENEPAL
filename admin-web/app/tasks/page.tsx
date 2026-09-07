'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import Leaderboard from '@/components/Leaderboard';
import TaskHoursChart from '@/components/TaskHoursChart';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { totalsByTask } from '@/lib/taskHours';
import type { Employee, PointRedemption, Task, TaskStatus, TaskTimeLog } from '@/lib/types';

const EMPTY_FORM = { employee_id: '', title: '', description: '', points: 10, due_date: '' };

const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

export default function TasksPage() {
  const { system } = useCalendarSystem();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<TaskStatus | 'All'>('submitted');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [pointsDraft, setPointsDraft] = useState<Record<string, number>>({});
  const [reviewingTask, setReviewingTask] = useState<Task | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [titleSuggestionsOpen, setTitleSuggestionsOpen] = useState(false);
  const titleBoxRef = useRef<HTMLDivElement>(null);

  const [hoursEmployeeId, setHoursEmployeeId] = useState('');
  const [hoursLogs, setHoursLogs] = useState<TaskTimeLog[]>([]);

  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);
  const [redemptionFilter, setRedemptionFilter] = useState<'pending' | 'approved' | 'rejected' | 'All'>('pending');
  const [busyRedemptionId, setBusyRedemptionId] = useState<string | null>(null);
  const [redemptionError, setRedemptionError] = useState<string | null>(null);

  function reload() {
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).then(({ data }) => setTasks(data ?? []));
    // Fetches every employee, not just active ones — a resigned employee's
    // historical tasks still need their name resolved (employeeName()
    // below), not "Unknown". Assigning a NEW task is restricted to active
    // employees separately, via activeEmployees.
    supabase
      .from('employees')
      .select('*')
      .then(({ data }) => {
        const sorted = (data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setEmployees(sorted);
        const firstActive = sorted.find(e => e.status === 'active');
        if (firstActive) setHoursEmployeeId(prev => prev || firstActive.id);
      });
    supabase
      .from('point_redemptions')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRedemptions(data ?? []));
  }
  useEffect(reload, []);

  useEffect(() => {
    if (!hoursEmployeeId) return;
    supabase
      .from('task_time_logs')
      .select('*')
      .eq('employee_id', hoursEmployeeId)
      .then(({ data }) => setHoursLogs(data ?? []));
  }, [hoursEmployeeId]);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';
  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  const hoursTaskTotals = useMemo(() => totalsByTask(hoursLogs), [hoursLogs]);
  const employeeTasks = useMemo(() => tasks.filter(t => t.assigned_to === hoursEmployeeId), [tasks, hoursEmployeeId]);

  const filtered = useMemo(() => (filter === 'All' ? tasks : tasks.filter(t => t.status === filter)), [tasks, filter]);
  const todayIso = useMemo(nepalTodayIso, []);
  const isOverdue = (t: Task) =>
    (t.status === 'pending' || t.status === 'in_progress') && !!t.due_date && t.due_date < todayIso;

  // Every title ever assigned at this company, newest first, deduplicated —
  // "bookmarking" a title happens automatically just by having used it once,
  // and since `tasks` is already RLS-scoped to the caller's own company,
  // every admin/HR user here sees the same shared list without a separate
  // table to store it in.
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
  const titleSuggestions = useMemo(() => {
    const term = form.title.trim().toLowerCase();
    const list = term ? knownTitles.filter(title => title.toLowerCase().includes(term)) : knownTitles;
    return list.slice(0, 8);
  }, [knownTitles, form.title]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.due_date) {
      setFormError('A deadline is required — pick a date this task must be finished by.');
      return;
    }
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase.from('tasks').insert({
      assigned_to: form.employee_id,
      assigned_by: data.user?.id,
      title: form.title,
      description: form.description || null,
      points: form.points,
      due_date: form.due_date,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function review(task: Task, status: 'approved' | 'rejected') {
    setBusyId(task.id);
    setReviewError(null);
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('tasks')
      .update({
        status,
        points: status === 'approved' ? pointsDraft[task.id] ?? task.points : task.points,
        review_note: noteDraft[task.id] || null,
        reviewed_by: data.user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', task.id);
    setBusyId(null);
    if (error) {
      setReviewError(error.message);
      return;
    }
    setReviewingTask(null);
    reload();
  }

  const filteredRedemptions = useMemo(
    () => (redemptionFilter === 'All' ? redemptions : redemptions.filter(r => r.status === redemptionFilter)),
    [redemptions, redemptionFilter]
  );

  async function reviewRedemption(id: string, status: 'approved' | 'rejected') {
    setBusyRedemptionId(id);
    setRedemptionError(null);
    let error;
    if (status === 'approved') {
      // Re-checks the employee's current points balance atomically at
      // approval time — a plain update here could drive the balance
      // negative if e.g. two pending requests together exceed it.
      ({ error } = await supabase.rpc('approve_point_redemption', { p_redemption_id: id }));
    } else {
      const { data } = await supabase.auth.getUser();
      ({ error } = await supabase
        .from('point_redemptions')
        .update({ status, reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
        .eq('id', id));
    }
    setBusyRedemptionId(null);
    if (error) {
      setRedemptionError(error.message);
      return;
    }
    reload();
  }

  return (
    <AppShell title="Tasks & Rewards">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['pending', 'in_progress', 'submitted', 'approved', 'rejected', 'All'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
                filter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
        >
          + Assign Task
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100 md:hidden">
            {filtered.map(t => (
              <div key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">{employeeName(t.assigned_to)}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="font-medium text-ink">{t.title}</span>
                      {t.source === 'self' && <Badge tone="info">Self-assigned</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                    {isOverdue(t) && <Badge tone="critical">Overdue</Badge>}
                  </div>
                </div>
                {t.description && <div className="mt-1 text-xs text-slate-400">{t.description}</div>}
                {t.work_notes && (
                  <div className="mt-1 text-xs text-slate-500">
                    <span className="font-medium">Employee note:</span> {t.work_notes}
                  </div>
                )}
                {t.review_note && (
                  <div className="mt-1 text-xs text-slate-500">
                    <span className="font-medium">Review note:</span> {t.review_note}
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-500">
                  {t.points} pts · Due {formatAdDate(t.due_date, system)}
                </div>
                {t.status === 'submitted' ? (
                  <button
                    onClick={() => {
                      setReviewingTask(t);
                      setReviewError(null);
                    }}
                    className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
                  >
                    Review
                  </button>
                ) : (
                  t.status !== 'pending' &&
                  t.status !== 'in_progress' && <div className="mt-2 text-xs text-slate-400">Reviewed</div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="p-8 text-center text-sm text-slate-400">No {filter !== 'All' ? filter.replace('_', ' ') : ''} tasks.</p>
            )}
          </div>

          <HorizontalScrollButtons targetRef={tableScrollRef} />
          <div ref={tableScrollRef} className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="w-40 px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="w-20 px-5 py-3 font-medium">Points</th>
                <th className="w-28 px-5 py-3 font-medium">Due</th>
                <th className="w-28 px-5 py-3 font-medium">Status</th>
                <th className="w-24 px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="px-5 py-3 font-medium text-ink">{employeeName(t.assigned_to)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{t.title}</span>
                      {t.source === 'self' && <Badge tone="info">Self-assigned</Badge>}
                    </div>
                    {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
                    {t.work_notes && (
                      <div className="mt-1 text-xs text-slate-500">
                        <span className="font-medium">Employee note:</span> {t.work_notes}
                      </div>
                    )}
                    {t.review_note && (
                      <div className="mt-1 text-xs text-slate-500">
                        <span className="font-medium">Review note:</span> {t.review_note}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{t.points}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {formatAdDate(t.due_date, system)}
                    {isOverdue(t) && <div className="mt-0.5 text-[10px] font-semibold text-critical-text">Overdue</div>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    {t.status === 'submitted' ? (
                      <button
                        onClick={() => {
                      setReviewingTask(t);
                      setReviewError(null);
                    }}
                        className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent/90"
                      >
                        Review
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {t.status === 'pending' || t.status === 'in_progress' ? 'Awaiting employee' : 'Reviewed'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    No {filter !== 'All' ? filter.replace('_', ' ') : ''} tasks.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <Leaderboard />
      </div>

      <div className="mt-6">
        <div className="mb-3 max-w-xs">
          <label className="mb-1 block text-xs font-medium text-slate-600">Hours worked by</label>
          <select
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

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <TaskHoursChart logs={hoursLogs} tasks={employeeTasks} />

          <div className="rounded-xl border border-slate-200 bg-white p-4">
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
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Point Redemptions</h2>
        {redemptionError && <p className="mb-3 text-sm text-critical">{redemptionError}</p>}
        <div className="mb-4 flex flex-wrap gap-2">
          {(['pending', 'approved', 'rejected', 'All'] as const).map(f => (
            <button
              key={f}
              onClick={() => setRedemptionFilter(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize ${
                redemptionFilter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {filteredRedemptions.length === 0 ? (
          <p className="text-sm text-slate-400">No {redemptionFilter !== 'All' ? redemptionFilter : ''} redemption requests.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRedemptions.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">
                    {employeeName(r.employee_id)} · {r.points_requested} pts
                  </div>
                  {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex gap-2">
                    <button
                      disabled={busyRedemptionId === r.id}
                      onClick={() => reviewRedemption(r.id, 'approved')}
                      className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busyRedemptionId === r.id}
                      onClick={() => reviewRedemption(r.id, 'rejected')}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <Badge tone={r.status === 'approved' ? 'good' : 'critical'}>{r.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAssign} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Assign Task</h3>

            <label className="mb-1 block text-xs font-medium text-slate-600">Employee</label>
            <select
              required
              value={form.employee_id}
              onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select employee…
              </option>
              {activeEmployees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <div
              ref={titleBoxRef}
              tabIndex={-1}
              onBlur={e => {
                if (!titleBoxRef.current?.contains(e.relatedTarget as Node)) setTitleSuggestionsOpen(false);
              }}
              className="relative mb-3"
            >
              <input
                required
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                onFocus={() => setTitleSuggestionsOpen(true)}
                placeholder="e.g. Website development"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              {titleSuggestionsOpen && titleSuggestions.length > 0 && (
                <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {titleSuggestions.map(title => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, title }));
                        setTitleSuggestionsOpen(false);
                      }}
                      className="block w-full truncate px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                    >
                      {title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="-mt-2 mb-3 text-[11px] text-slate-400">
              Previously used titles show up here — pick one to reuse it instead of retyping.
            </p>

            <label className="mb-1 block text-xs font-medium text-slate-600">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Points</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={form.points}
                  onChange={e => setForm(f => ({ ...f, points: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Deadline</label>
                <DatePicker value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} placeholder="Select deadline" />
              </div>
            </div>

            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Assigning…' : 'Assign task'}
              </button>
            </div>
          </form>
        </div>
      )}

      {reviewingTask && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setReviewingTask(null)}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold text-ink">Review Task</h3>
            <p className="mb-4 text-sm text-slate-500">
              {reviewingTask.title} · {employeeName(reviewingTask.assigned_to)}
            </p>
            {reviewingTask.description && <p className="mb-3 text-xs text-slate-400">{reviewingTask.description}</p>}
            {reviewingTask.work_notes && (
              <p className="mb-3 text-xs text-slate-500">
                <span className="font-medium">Employee note:</span> {reviewingTask.work_notes}
              </p>
            )}
            {reviewError && <p className="mb-3 text-sm text-critical">{reviewError}</p>}

            <label className="mb-1 block text-xs font-medium text-slate-600">Points to award</label>
            <input
              type="number"
              min={0}
              value={pointsDraft[reviewingTask.id] ?? reviewingTask.points}
              onChange={e => setPointsDraft(d => ({ ...d, [reviewingTask.id]: Number(e.target.value) }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Review note (optional)</label>
            <textarea
              value={noteDraft[reviewingTask.id] ?? ''}
              onChange={e => setNoteDraft(d => ({ ...d, [reviewingTask.id]: e.target.value }))}
              rows={2}
              className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReviewingTask(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                disabled={busyId === reviewingTask.id}
                onClick={() => review(reviewingTask, 'rejected')}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                disabled={busyId === reviewingTask.id}
                onClick={() => review(reviewingTask, 'approved')}
                className="rounded-lg bg-good px-4 py-2 text-sm font-semibold text-white hover:bg-good/90 disabled:opacity-50"
              >
                {busyId === reviewingTask.id ? 'Saving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
