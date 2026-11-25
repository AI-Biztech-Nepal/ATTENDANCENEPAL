import type { TaskStatus } from '@/lib/types';
import { BLOCK_TONE } from './taskStyles';

/** The little mark before a status: a tick for a completed task (so it does not rely on green alone), otherwise a dot in the
 * status colour that pulses while the employee's timer is running. */
export default function StatusMark({ status, running }: { status: TaskStatus; running: boolean }) {
  if (status === 'approved') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    );
  }
  return <i className={`shrink-0 rounded-full ${BLOCK_TONE[status].dot} ${running ? 'h-2 w-2 motion-safe:animate-pulse' : 'h-1.5 w-1.5'}`} />;
}
