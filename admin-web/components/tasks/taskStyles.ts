import type { Task, TaskStatus } from '@/lib/types';

/** Status badge tones — the same ones the page used before the timetable. */
export const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** The colours of a task's block on the timetable, per status: the box (fill, border, text), the status line,
 * and its dot. The status is always written out as well, so colour is never the only signal. */
export const BLOCK_TONE: Record<TaskStatus, { box: string; label: string; dot: string }> = {
  pending: { box: 'border-slate-300 bg-slate-100 text-slate-800', label: 'text-slate-600', dot: 'bg-slate-500' },
  in_progress: { box: 'border-sky-300 bg-sky-100 text-sky-900', label: 'text-sky-800', dot: 'bg-sky-600' },
  submitted: { box: 'border-amber-300 bg-amber-100 text-amber-900', label: 'text-amber-800', dot: 'bg-amber-500' },
  approved: { box: 'border-emerald-300 bg-emerald-100 text-emerald-900', label: 'text-emerald-800', dot: 'bg-emerald-500' },
  rejected: { box: 'border-rose-300 bg-rose-100 text-rose-900', label: 'text-rose-800', dot: 'bg-rose-500' },
};

/** Not finished and not yet with the manager. */
export function isOpen(status: TaskStatus): boolean {
  return status === 'pending' || status === 'in_progress';
}

/** Still open after its day has gone by. */
export function isOverdue(task: Pick<Task, 'status' | 'due_date'>, today: string): boolean {
  return isOpen(task.status) && !!task.due_date && task.due_date < today;
}

/** The status line inside a timetable block. It has to fit, so a narrow block gets the short form. */
export function blockStatusText(task: Task, today: string, span: number): string {
  if (isOverdue(task, today)) return span >= 3 ? `${STATUS_LABEL[task.status]} · overdue` : 'Overdue';
  if (task.status === 'submitted') return span >= 3 ? 'Submitted · needs review' : 'Submitted';
  return STATUS_LABEL[task.status];
}
