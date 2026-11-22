'use client';

import type { MouseEvent } from 'react';
import Avatar from '@/components/Avatar';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_HOURS,
  bookedHours,
  formatDuration,
  formatSlot,
  isOnLeave,
  placementsFor,
  slotLength,
  type Placement,
} from '@/lib/taskSchedule';
import type { Employee, LeaveRequest, Task } from '@/lib/types';
import DayStrip from './DayStrip';
import { BLOCK_TONE, STATUS_LABEL, blockStatusText, isOverdue } from './taskStyles';

const GRID_LINES = 'repeating-linear-gradient(to right,#e2e8f0 0,#e2e8f0 1px,transparent 1px,transparent 11.1111%)';
const LEAVE_HATCH = 'repeating-linear-gradient(135deg,#e2e8f0 0,#e2e8f0 6px,#f1f5f9 6px,#f1f5f9 12px)';
const DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;

/** "9–10", "12–1": the hour a column stands for. */
function hourHeading(h: number) {
  return `${h % 12 || 12}–${(h + 1) % 12 || 12}`;
}

/** Which hour column a click landed in, from where it fell across the track. */
function hourFromClick(e: MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
  const idx = Math.min(DAY_HOURS - 1, Math.max(0, Math.floor(frac * DAY_HOURS)));
  return DAY_START_HOUR + idx;
}

type Row = { emp: Employee; placements: Placement[]; booked: number; onLeave: boolean };

type Props = {
  employees: Employee[];
  tasks: Task[];
  leaves: LeaveRequest[];
  /** The day shown, YYYY-MM-DD. */
  date: string;
  today: string;
  /** Where "now" falls across the 9-6 columns (0-100), or null when it is not today / outside working hours. */
  nowPct: number | null;
  nowLabel: string;
  /** Tasks whose timer is running right now. */
  runningTaskIds: Set<string>;
  onOpenTask: (task: Task) => void;
  /** Open the Assign dialog for this employee, at this start hour (null = pick the first free hour). */
  onAssign: (employeeId: string, startHour: number | null) => void;
};

/** The Tasks page's main view: employees down the side, the working hours 9 AM to 6 PM across, and a block for
 * every task that fills the hours it was assigned for. Below `md` the same day reads as one card per employee. */
export default function TaskTimetable({ employees, tasks, leaves, date, today, nowPct, nowLabel, runningTaskIds, onOpenTask, onAssign }: Props) {
  const rows: Row[] = employees.map(emp => {
    const placements = placementsFor(tasks, emp.id, date);
    return { emp, placements, booked: bookedHours(placements), onLeave: isOnLeave(leaves, emp.id, date) };
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
        No employees to show.
      </div>
    );
  }

  return (
    <>
      {/* Desktop and tablet: the grid. */}
      <section aria-label="Day timetable, 9 AM to 6 PM" className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <div className="relative min-w-[1180px]">
            <div className="grid grid-cols-[256px_minmax(0,1fr)] border-b border-slate-200 bg-slate-50">
              <div className="flex items-end px-5 pb-3 text-xs font-extrabold uppercase tracking-[0.06em] text-slate-600">Employee</div>
              <div className="grid grid-cols-9">
                {SLOT_HOURS.map(h => (
                  <div key={h} className="border-l border-slate-200 px-1.5 pb-2.5 pt-[26px] text-center">
                    <div className="text-[13px] font-extrabold text-ink">{hourHeading(h)}</div>
                    <div className="text-[11px] text-slate-600">{h < 12 ? 'AM' : 'PM'}</div>
                  </div>
                ))}
              </div>
            </div>

            {rows.map(({ emp, placements, booked, onLeave }, rowIndex) => (
              <div key={emp.id} className={`grid min-h-[84px] grid-cols-[256px_minmax(0,1fr)] border-slate-200 ${rowIndex === 0 ? '' : 'border-t'}`}>
                <div className="group relative flex items-center gap-3 px-5 py-3">
                  <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-9 w-9 text-[13px]" />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-bold ${onLeave ? 'text-slate-600' : 'text-ink'}`}>{emp.name}</div>
                    <div className="text-xs leading-snug text-slate-600">
                      {emp.department ?? 'No department'} · {onLeave ? 'on leave' : `${formatDuration(booked)} of ${DAY_HOURS} h booked`}
                    </div>
                  </div>
                  {!onLeave && (
                    <button
                      type="button"
                      onClick={() => onAssign(emp.id, null)}
                      aria-label={`Assign a task to ${emp.name}`}
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 opacity-0 hover:bg-slate-100 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {onLeave ? (
                  <div className="flex items-center justify-center border-l border-slate-200 py-2" style={{ backgroundImage: LEAVE_HATCH }}>
                    <span className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[13px] font-bold text-slate-700">
                      On leave · can&apos;t be assigned
                    </span>
                  </div>
                ) : (
                  <div
                    onClick={e => onAssign(emp.id, hourFromClick(e))}
                    className="relative grid cursor-cell grid-cols-9 items-stretch py-2"
                    style={{ backgroundImage: GRID_LINES }}
                  >
                    {placements.length === 0 && (
                      <div className="pointer-events-none absolute inset-x-1.5 inset-y-2 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-slate-400 text-[13px] font-bold text-slate-600">
                        + Free all day · click a slot to assign
                      </div>
                    )}
                    {placements.map(p => (
                      <TimetableBlock
                        key={p.task.id}
                        placement={p}
                        employee={emp}
                        today={today}
                        running={runningTaskIds.has(p.task.id)}
                        onOpen={() => onOpenTask(p.task)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {nowPct !== null && (
              <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-[256px] right-0 top-0">
                <div className="absolute bottom-0 top-[30px] w-0.5 bg-ink" style={{ left: `${nowPct}%` }} />
                <div
                  className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-extrabold text-white"
                  style={{ left: `${nowPct}%` }}
                >
                  Now {nowLabel}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Phone: one card per employee. */}
      <div className="space-y-3 md:hidden">
        {rows.map(({ emp, placements, booked, onLeave }) => (
          <article key={emp.id} className={`rounded-xl border border-slate-200 p-4 shadow-sm ${onLeave ? 'bg-slate-50' : 'bg-white'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-9 w-9 text-[13px]" />
                <div className="min-w-0">
                  <div className={`truncate text-[15px] font-extrabold ${onLeave ? 'text-slate-600' : 'text-ink'}`}>{emp.name}</div>
                  <div className="truncate text-xs text-slate-600">{emp.department ?? 'No department'}</div>
                </div>
              </div>
              {!onLeave && <div className="whitespace-nowrap text-[12.5px] font-bold text-slate-600">{booked} of {DAY_HOURS} h</div>}
            </div>

            {onLeave ? (
              <div className="mt-3.5 rounded-lg p-3 text-center" style={{ backgroundImage: LEAVE_HATCH }}>
                <span className="inline-block rounded-full border border-slate-300 bg-white px-3 py-1 text-[12.5px] font-bold text-slate-700">
                  On leave · can&apos;t be assigned
                </span>
              </div>
            ) : (
              <>
                {placements.length > 0 && (
                  <div className="mt-3.5">
                    <DayStrip placements={placements} label={`${emp.name}'s day, 9 AM to 6 PM: ${booked} of ${DAY_HOURS} hours booked`} />
                  </div>
                )}
                {placements.length > 0 && (
                  <ul className="mt-2.5">
                    {placements.map(p => {
                      const tone = BLOCK_TONE[p.task.status];
                      const label = blockStatusText(p.task, today, 3);
                      return (
                        <li key={p.task.id}>
                          <button
                            type="button"
                            onClick={() => onOpenTask(p.task)}
                            className="flex min-h-[56px] w-full items-center gap-3 border-t border-slate-100 py-2 text-left"
                          >
                            <span className="w-[84px] shrink-0 text-[12.5px] font-extrabold tabular-nums text-slate-700">{formatSlot(p.slot)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-ink">{p.task.title}</span>
                              <span className={`mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] ${isOverdue(p.task, today) ? 'text-rose-700' : tone.label}`}>
                                <i className={`h-1.5 w-1.5 rounded-full ${runningTaskIds.has(p.task.id) ? 'bg-emerald-500' : tone.dot}`} />
                                {label}
                                {runningTaskIds.has(p.task.id) ? ' · timer on' : ''}
                              </span>
                            </span>
                            <ChevronIcon className="h-4 w-4 shrink-0 text-slate-500" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => onAssign(emp.id, null)}
                  className={`mt-3 min-h-[44px] w-full rounded-lg border text-[13px] font-bold text-slate-600 ${
                    placements.length === 0 ? 'border-[1.5px] border-dashed border-slate-400' : 'border-slate-300'
                  }`}
                >
                  {placements.length === 0 ? '+ Free all day · assign a task' : '+ Assign a task'}
                </button>
              </>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function TimetableBlock({
  placement,
  employee,
  today,
  running,
  onOpen,
}: {
  placement: Placement;
  employee: Employee;
  today: string;
  running: boolean;
  onOpen: () => void;
}) {
  const { task, slot, colStart, span } = placement;
  const tone = BLOCK_TONE[task.status];
  const overdue = isOverdue(task, today);
  const statusText = blockStatusText(task, today, span);
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`${task.title}, ${employee.name}, ${formatSlot(slot)}, ${STATUS_LABEL[task.status]}${overdue ? ', overdue' : ''}${running ? ', timer on' : ''}. Open details`}
      title={`${task.title} · ${formatSlot(slot)}`}
      style={{ gridColumn: `${colStart} / span ${span}`, gridRow: 1 }}
      className={`mx-[3px] flex min-w-0 cursor-pointer flex-col justify-center gap-[3px] overflow-hidden rounded-lg border px-3 py-2 text-left hover:brightness-95 ${tone.box} ${span === 1 ? 'px-2.5' : ''}`}
    >
      {span === 1 ? (
        <span className="line-clamp-2 text-[12.5px] font-extrabold leading-tight">{task.title}</span>
      ) : (
        <>
          <span className="truncate text-[13px] font-extrabold">{task.title}</span>
          <span className="whitespace-nowrap text-xs font-semibold">
            {formatSlot(slot)}
            {running ? ' · timer on' : ` · ${formatDuration(slotLength(slot))}`}
          </span>
        </>
      )}
      <span className={`flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] ${overdue ? 'text-rose-700' : tone.label}`}>
        <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'bg-emerald-500' : tone.dot}`} />
        <span className="truncate">{statusText}</span>
      </span>
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
