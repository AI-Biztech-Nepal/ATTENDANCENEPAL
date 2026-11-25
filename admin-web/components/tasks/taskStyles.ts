import type { Task, TaskStatus } from '@/lib/types';

/** Status badge tones: grey = not started, blue = in progress, amber = sent in and waiting for review, green = completed,
 * red = sent back. Green means done and nothing else. */
export const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'progress' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'progress',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

/** What each status is called. The stored value of a finished task is still 'approved'; people see "Completed". */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  submitted: 'Submitted',
  approved: 'Completed',
  rejected: 'Rejected',
};

/** The colours of a task's block on the timetable, per status: the box (fill, border, text), the status line,
 * and its dot. The status is always written out as well, so colour is never the only signal. */
export const BLOCK_TONE: Record<TaskStatus, { box: string; label: string; dot: string }> = {
  pending: { box: 'border-slate-300 bg-slate-100 text-slate-800', label: 'text-slate-600', dot: 'bg-slate-500' },
  in_progress: { box: 'border-blue-300 bg-blue-100 text-blue-900', label: 'text-blue-800', dot: 'bg-blue-600' },
  submitted: { box: 'border-amber-300 bg-amber-100 text-amber-900', label: 'text-amber-800', dot: 'bg-amber-500' },
  approved: { box: 'border-emerald-400 bg-emerald-100 text-emerald-900', label: 'text-emerald-800', dot: 'bg-emerald-600' },
  rejected: { box: 'border-rose-300 bg-rose-100 text-rose-900', label: 'text-rose-800', dot: 'bg-rose-500' },
};

/** Not finished and not yet with the manager. */
export function isOpen(status: TaskStatus): boolean {
  return status === 'pending' || status === 'in_progress';
}

/** Whether the timetable fills a block with green as the "Now" line crosses it: a task that is still to be done. One that is
 * submitted, completed or rejected keeps its own colour. */
export function showsElapsed(status: TaskStatus): boolean {
  return isOpen(status);
}

/** Still open after its day has gone by. */
export function isOverdue(task: Pick<Task, 'status' | 'due_date'>, today: string): boolean {
  return isOpen(task.status) && !!task.due_date && task.due_date < today;
}

/** The status line inside a timetable block. It has to fit, so a narrow block gets the short form. `span` is the block's width in hours. */
export function blockStatusText(task: Task, today: string, span: number): string {
  if (isOverdue(task, today)) return span >= 3 ? `${STATUS_LABEL[task.status]} · overdue` : 'Overdue';
  if (task.status === 'submitted') return span >= 3 ? 'Submitted · needs review' : 'Submitted';
  return STATUS_LABEL[task.status];
}
