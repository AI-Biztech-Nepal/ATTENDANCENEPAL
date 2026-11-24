'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatAdDate, formatTime, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes } from '@/lib/shift';
import { formatDuration, formatSlot, slotLength, taskSlot, weekdayName } from '@/lib/taskSchedule';
import type { Employee, Task, TaskTimeLog } from '@/lib/types';
import { STATUS_LABEL, STATUS_TONE, completeQuestion, isOpen, isOverdue } from './taskStyles';

type Props = {
  task: Task;
  employee: Employee | undefined;
  today: string;
  onClose: () => void;
  /** Send a submitted task back. Resolves to an error message, or null when it worked. */
  onReview: (task: Task, status: 'approved' | 'rejected', note: string) => Promise<string | null>;
  /** Mark the task completed (it turns green). Resolves to an error message, or null when it worked. */
  onComplete: (task: Task, note: string) => Promise<string | null>;
  /** "Pick a time" for a task that has no slot yet. */
  onPickTime: (task: Task) => void;
  /** Cancel (delete) the task. Resolves to an error message, or null when it worked. */
  onCancel: (task: Task) => Promise<string | null>;
};

const LABEL = 'mb-1.5 block text-xs font-bold text-slate-700';
const FIELD = 'w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm text-ink';
const COMPLETE_BUTTON =
  'flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-emerald-700 px-6 text-sm font-extrabold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50';

/** Everything about one task, in a panel that slides in from the right when its block (or row) is clicked: when,
 * who, the description, the time actually tracked, the employee's note — and, for a submitted task, the
 * review. A task that is not finished has a green "Mark as completed" button (after asking, for one the employee has not
 * sent in; a running timer is stopped); a submitted one has it in the review, next to Reject. A task that has not been
 * reviewed yet can be cancelled from the bottom of the panel: it is deleted, after asking. Completed and rejected
 * tasks are the record of work that was done, so they have no Cancel. */
export default function TaskDetailPanel({ task, employee, today, onClose, onReview, onComplete, onPickTime, onCancel }: Props) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [logs, setLogs] = useState<TaskTimeLog[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'completed' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // True while the "are you sure" question is open, so Escape answers that and does not also close this panel.
  const asking = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    supabase
      .from('task_time_logs')
      .select('*')
      .eq('task_id', task.id)
      .order('started_at', { ascending: true })
      .then(({ data }) => setLogs((data as TaskTimeLog[] | null) ?? []));
  }, [task.id]);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !asking.current) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const slot = taskSlot(task);
  const overdue = isOverdue(task, today);
  const running = logs.some(l => !l.ended_at);
  const trackedMinutes = Math.round(
    logs.reduce((sum, l) => {
      const end = l.ended_at ? new Date(l.ended_at).getTime() : (now ?? new Date(l.started_at).getTime());
      return sum + Math.max(0, end - new Date(l.started_at).getTime());
    }, 0) / 60000
  );
  const scheduledMinutes = slot ? Math.round(slotLength(slot) * 60) : 0;
  const trackedPct = scheduledMinutes > 0 ? Math.min(100, Math.round((trackedMinutes / scheduledMinutes) * 100)) : 0;

  const canCancel = task.status === 'pending' || task.status === 'in_progress' || task.status === 'submitted';

  async function cancelTask() {
    if (cancelling) return;
    setCancelError(null);
    const who = employee?.name ?? 'the employee';
    const extra = [
      trackedMinutes > 0 ? ` The ${formatHoursMinutes(trackedMinutes)} tracked on it is deleted too.` : '',
      running ? ' Its running timer stops.' : '',
    ].join('');
    asking.current = true;
    const sure = await confirm(`Cancel "${task.title}"? It is removed from ${who}'s timetable and task list for good.${extra} This cannot be undone.`, {
      title: 'Cancel this task?',
      confirmLabel: 'Cancel task',
      cancelLabel: 'Keep task',
      tone: 'danger',
    });
    asking.current = false;
    if (!sure) return;
    setCancelling(true);
    const message = await onCancel(task);
    setCancelling(false);
    if (message) setCancelError(message);
    else onClose();
  }

  async function reject() {
    setBusy('rejected');
    setError(null);
    const message = await onReview(task, 'rejected', note);
    setBusy(null);
    if (message) setError(message);
    else onClose();
  }

  async function finish() {
    setBusy('completed');
    setError(null);
    const message = await onComplete(task, note);
    setBusy(null);
    if (message) setError(message);
    else onClose();
  }

  // A task the employee has not sent in: the manager closes it for them, after being asked.
  async function completeOpenTask() {
    if (busy) return;
    asking.current = true;
    const sure = await confirm(completeQuestion(task.title, employee?.name ?? 'the employee', running), {
      title: 'Mark as completed?',
      confirmLabel: 'Mark as completed',
      cancelLabel: 'Not yet',
    });
    asking.current = false;
    if (sure) await finish();
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={e => e.stopPropagation()}
        className="h-full w-full max-w-[560px] overflow-y-auto bg-white px-6 pb-8 pt-6 shadow-2xl sm:px-8"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-bold text-slate-600">Task detail</div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="h-[18px] w-[18px]" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <h2 id="task-detail-title" className="mb-2.5 mt-2 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
          {task.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[task.status]}>{task.status === 'submitted' ? 'Submitted · needs review' : STATUS_LABEL[task.status]}</Badge>
          {overdue && <Badge tone="critical">Overdue</Badge>}
          {task.source === 'self' && <Badge tone="info">Self-assigned</Badge>}
        </div>

        {isOpen(task.status) && (
          <div className="mt-4">
            {error && (
              <p role="alert" className="mb-2 text-sm font-semibold text-critical-text">
                {error}
              </p>
            )}
            <button type="button" disabled={busy !== null} onClick={completeOpenTask} className={`${COMPLETE_BUTTON} w-full sm:w-auto`}>
              <CheckIcon />
              {busy === 'completed' ? 'Saving…' : 'Mark as completed'}
            </button>
          </div>
        )}

        <dl className="mt-6 grid grid-cols-[110px_minmax(0,1fr)] border-t border-slate-200 text-sm sm:grid-cols-[130px_minmax(0,1fr)]">
          <dt className="border-b border-slate-100 py-3.5 text-[13px] font-bold text-slate-600">When</dt>
          <dd className="border-b border-slate-100 py-3.5 font-bold text-ink">
            {task.due_date ? (
              <>
                {weekdayName(task.due_date)} {formatAdDate(task.due_date, system)}
                <div className="mt-0.5 text-[13px] font-medium text-slate-700">
                  {slot ? `${formatSlot(slot)} · ${formatDuration(slotLength(slot))}` : 'No time slot yet'}
                </div>
              </>
            ) : (
              <span className="font-medium text-slate-700">No date set</span>
            )}
            {!slot && (task.status === 'pending' || task.status === 'in_progress') && (
              <button
                type="button"
                onClick={() => onPickTime(task)}
                className="mt-2 block min-h-[40px] rounded-lg border border-teal-700 px-4 text-[13px] font-extrabold text-teal-700 hover:bg-teal-50"
              >
                Pick a time
              </button>
            )}
          </dd>

          <dt className="border-b border-slate-100 py-3.5 text-[13px] font-bold text-slate-600">Employee</dt>
          <dd className="flex items-center gap-3 border-b border-slate-100 py-3.5">
            <Avatar name={employee?.name ?? 'Unknown'} photoUrl={employee?.profile_photo_url} className="h-9 w-9 text-[13px]" />
            <div className="min-w-0">
              <div className="truncate font-bold text-ink">{employee?.name ?? 'Unknown'}</div>
              <div className="truncate text-[12.5px] text-slate-600">{employee?.department ?? 'No department'}</div>
            </div>
          </dd>

          <dt className="border-b border-slate-100 py-3.5 text-[13px] font-bold text-slate-600">Created</dt>
          <dd className="border-b border-slate-100 py-3.5 font-semibold text-ink">{formatAdDate(localDateKey(task.created_at), system)}</dd>

          {task.status === 'approved' && task.reviewed_at && (
            <>
              <dt className="border-b border-slate-100 py-3.5 text-[13px] font-bold text-slate-600">Completed</dt>
              <dd className="border-b border-slate-100 py-3.5 font-bold text-emerald-800">{formatAdDate(localDateKey(task.reviewed_at), system)}</dd>
            </>
          )}
        </dl>

        {task.description && (
          <section aria-labelledby="task-detail-desc" className="mt-5">
            <h3 id="task-detail-desc" className="mb-1.5 text-sm font-extrabold text-ink">Description</h3>
            <p className="text-sm leading-relaxed text-slate-700">{task.description}</p>
          </section>
        )}

        <section aria-labelledby="task-detail-time" className="mt-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="task-detail-time" className="text-sm font-extrabold text-ink">Time tracked</h3>
            <div className="text-[13px] text-slate-600">
              <b className="text-[15px] text-ink">{formatHoursMinutes(trackedMinutes)}</b>
              {slot ? ` of ${formatDuration(slotLength(slot))} scheduled` : ''}
            </div>
          </div>
          {slot && (
            <div
              role="img"
              aria-label={`${formatHoursMinutes(trackedMinutes)} tracked of ${formatDuration(slotLength(slot))} scheduled`}
              className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-200"
            >
              <div className="h-full rounded-full bg-teal-700" style={{ width: `${trackedPct}%` }} />
            </div>
          )}
          {logs.length === 0 ? (
            <p className="mt-2 text-[13px] text-slate-600">No time logged yet.</p>
          ) : (
            <ul className="mt-3">
              {logs.map(l => {
                const end = l.ended_at ? new Date(l.ended_at).getTime() : (now ?? new Date(l.started_at).getTime());
                const minutes = Math.max(0, Math.round((end - new Date(l.started_at).getTime()) / 60000));
                return (
                  <li key={l.id} className="flex justify-between gap-3 border-t border-slate-100 py-2.5 text-[13px]">
                    <span className="text-slate-700">
                      {formatTime(l.started_at)} – {l.ended_at ? formatTime(l.ended_at) : 'now'}
                      {!l.ended_at && <span className="ml-2 font-bold text-emerald-700">timer running</span>}
                    </span>
                    <span className="font-bold tabular-nums text-ink">{formatHoursMinutes(minutes)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {running && logs.length > 0 && <p className="mt-1 text-xs text-slate-600">Time updates when the page is reopened.</p>}
        </section>

        {task.work_notes && (
          <section aria-labelledby="task-detail-note" className="mt-5">
            <h3 id="task-detail-note" className="mb-1.5 text-sm font-extrabold text-ink">Employee note</h3>
            <p className="text-sm leading-relaxed text-slate-700">{task.work_notes}</p>
          </section>
        )}

        {task.review_note && (
          <section aria-labelledby="task-detail-review-note" className="mt-5">
            <h3 id="task-detail-review-note" className="mb-1.5 text-sm font-extrabold text-ink">Review note</h3>
            <p className="text-sm leading-relaxed text-slate-700">{task.review_note}</p>
          </section>
        )}

        {task.status === 'submitted' && (
          <section aria-labelledby="task-detail-review" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
            <h3 id="task-detail-review" className="mb-3.5 text-[15px] font-extrabold text-ink">Review</h3>
            {error && <p role="alert" className="mb-3 text-sm text-critical-text">{error}</p>}
            <div className="mb-4">
              <label htmlFor="task-detail-note-input" className={LABEL}>
                Review note <span className="font-medium text-slate-600">(optional)</span>
              </label>
              <textarea
                id="task-detail-note-input"
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                className={`${FIELD} py-2.5`}
              />
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={reject}
                className="min-h-[44px] rounded-[10px] border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === 'rejected' ? 'Saving…' : 'Reject'}
              </button>
              <button type="button" disabled={busy !== null} onClick={finish} className={COMPLETE_BUTTON}>
                <CheckIcon />
                {busy === 'completed' ? 'Saving…' : 'Mark as completed'}
              </button>
            </div>
          </section>
        )}

        {canCancel && (
          <section aria-labelledby="task-detail-cancel" className="mt-8 border-t border-slate-200 pt-5">
            <h3 id="task-detail-cancel" className="mb-1 text-sm font-extrabold text-ink">Cancel this task</h3>
            <p className="mb-3 text-[13px] leading-relaxed text-slate-600">
              Removes it from the timetable and from {employee?.name ?? 'the employee'}&apos;s task list. Use it for a task that was assigned by mistake or is no longer needed.
            </p>
            {cancelError && (
              <p role="alert" className="mb-3 text-sm font-semibold text-critical-text">
                {cancelError}
              </p>
            )}
            <button
              type="button"
              disabled={cancelling}
              onClick={cancelTask}
              className="min-h-[44px] rounded-[10px] border border-critical/40 bg-white px-5 text-sm font-extrabold text-critical-text hover:bg-critical-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-critical disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Cancel task'}
            </button>
          </section>
        )}
      </aside>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
