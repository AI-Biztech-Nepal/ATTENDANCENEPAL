'use client';

import Avatar from '@/components/Avatar';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatDuration, formatSlot, isOnLeave, taskSlot, weekdayName } from '@/lib/taskSchedule';
import { MAX_CHIPS, weekLoad, weekTasksFor, type DayNote } from '@/lib/taskWeek';
import type { Employee, LeaveRequest, Task, TaskStatus } from '@/lib/types';
import StatusMark from './StatusMark';
import { BLOCK_TONE, STATUS_LABEL, isOverdue } from './taskStyles';

const LEAVE_HATCH = 'repeating-linear-gradient(135deg,#e2e8f0 0,#e2e8f0 6px,#f1f5f9 6px,#f1f5f9 12px)';
const NAME_PX = 232;
const DAY_PX = 150;

type Row = {
  emp: Employee;
  /** Every scheduled task of the week, by day, and the ones the status filter lets through. */
  byDay: Map<string, Task[]>;
  visible: Map<string, Task[]>;
  visibleCount: number;
  count: number;
  hours: number;
  /** The days of the week the person is on approved leave. */
  away: Set<string>;
};

type Props = {
  /** The seven days shown, YYYY-MM-DD, Sunday to Saturday. */
  dates: string[];
  today: string;
  employees: Employee[];
  tasks: Task[];
  leaves: LeaveRequest[];
  /** The weekly off day and holidays among the days. */
  notes: Map<string, DayNote>;
  /** Statuses picked in the filter. Empty = everything shows. */
  statuses: TaskStatus[];
  /** The "On leave" filter is on. */
  showLeave: boolean;
  /** Tasks whose timer is running right now. */
  runningTaskIds: Set<string>;
  onOpenTask: (task: Task) => void;
  /** Open the Assign dialog for this employee on this day ('' = nobody picked yet). */
  onAssign: (employeeId: string, date: string) => void;
  /** Go to that day on the day timetable. */
  onOpenDay: (date: string) => void;
  onClearFilters: () => void;
};

/**
 * The Tasks page's week view: employees down the side, the seven days of the week across, and in each day a small chip for every task
 * (its time and title, tinted by its status). A day holds three chips and then says "+N more", which opens that day on the timetable, as
 * does the day's heading. A click on the free part of a cell assigns a task to that person on that day. Below `md` the week reads as one
 * list a day instead.
 */
export default function TaskWeek({ dates, today, employees, tasks, leaves, notes, statuses, showLeave, runningTaskIds, onOpenTask, onAssign, onOpenDay, onClearFilters }: Props) {
  const { system } = useCalendarSystem();
  const filtering = statuses.length > 0 || showLeave;
  const dayNumber = (d: string) => formatAdDate(d, system).split(' ')[0];
  const dayText = (d: string) => `${weekdayName(d)} ${formatAdDate(d, system)}`;

  const allRows: Row[] = employees.map(emp => {
    const byDay = weekTasksFor(tasks, emp.id, dates);
    const visible = new Map([...byDay].map(([d, list]) => [d, statuses.length > 0 ? list.filter(t => statuses.includes(t.status)) : list]));
    const load = weekLoad(byDay);
    return {
      emp,
      byDay,
      visible,
      visibleCount: [...visible.values()].reduce((n, l) => n + l.length, 0),
      count: load.count,
      hours: load.hours,
      away: new Set(dates.filter(d => isOnLeave(leaves, emp.id, d))),
    };
  });
  // With a filter on, only the people it is about stay: someone on leave that week (if "On leave" is picked) or someone with a task
  // in a picked status.
  const rows = filtering ? allRows.filter(r => (showLeave && r.away.size > 0) || (statuses.length > 0 && r.visibleCount > 0)) : allRows;
  const dayTotals = new Map(dates.map(d => [d, rows.reduce((n, r) => n + (r.visible.get(d)?.length ?? 0), 0)]));
  const weekLabel = `${formatAdDate(dates[0], system)} to ${formatAdDate(dates[dates.length - 1], system)}`;

  if (employees.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">No employees to show.</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-700">Nothing matches the filter this week.</p>
        <button type="button" onClick={onClearFilters} className="mt-3 min-h-[44px] rounded-lg border border-teal-700 px-5 text-[13px] font-extrabold text-teal-700 hover:bg-teal-50">
          Show all
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Desktop and tablet: the grid. */}
      <section aria-label={`Week timetable, ${weekLabel}`} className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse" style={{ minWidth: NAME_PX + dates.length * DAY_PX }}>
            <colgroup>
              <col style={{ width: NAME_PX }} />
              {dates.map(d => (
                <col key={d} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className="px-5 py-3 text-left text-xs font-extrabold uppercase tracking-[0.06em] text-slate-600">
                  Employee
                </th>
                {dates.map(d => {
                  const note = notes.get(d);
                  const isToday = d === today;
                  return (
                    <th key={d} scope="col" aria-current={isToday ? 'date' : undefined} className={`border-l border-slate-200 p-0 align-top font-normal ${isToday ? 'bg-teal-50' : note ? 'bg-slate-100' : ''}`}>
                      <button
                        type="button"
                        onClick={() => onOpenDay(d)}
                        aria-label={`Open ${dayText(d)} on the day timetable${isToday ? ' (today)' : ''}${note ? `, ${note.label}` : ''}`}
                        title={note ? `${dayText(d)} · ${note.label}` : dayText(d)}
                        className="flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 px-1.5 py-2 hover:bg-slate-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                      >
                        <span className={`text-[11.5px] font-extrabold uppercase tracking-[0.06em] ${isToday ? 'text-teal-800' : 'text-slate-600'}`}>{weekdayName(d)}</span>
                        <span className="flex items-center gap-1.5 text-[17px] font-extrabold leading-none text-ink">
                          {dayNumber(d)}
                          {isToday && <span className="rounded-full bg-teal-700 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">Today</span>}
                        </span>
                        <span className="max-w-full truncate text-[11px] font-semibold text-slate-600">
                          {note ? note.label : `${dayTotals.get(d)} ${dayTotals.get(d) === 1 ? 'task' : 'tasks'}`}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ emp, visible, count, hours, away }) => (
                <tr key={emp.id} className="border-t border-slate-200 align-top">
                  <th scope="row" className="px-5 py-3 text-left align-top font-normal">
                    <div className="flex items-center gap-3">
                      <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-9 w-9 shrink-0 text-[13px]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-ink">{emp.name}</div>
                        <div className="text-xs leading-snug text-slate-600">
                          {emp.department ?? 'No department'} · {count === 0 ? 'nothing this week' : `${count} ${count === 1 ? 'task' : 'tasks'} · ${formatDuration(hours)}`}
                        </div>
                      </div>
                    </div>
                  </th>
                  {dates.map(d => {
                    const list = visible.get(d) ?? [];
                    const shown = list.slice(0, MAX_CHIPS);
                    const more = list.length - shown.length;
                    const onLeave = away.has(d);
                    const note = notes.get(d);
                    const isToday = d === today;
                    return (
                      <td
                        key={d}
                        onClick={() => onAssign(emp.id, d)}
                        style={onLeave ? { backgroundImage: LEAVE_HATCH } : undefined}
                        className={`group relative cursor-cell border-l border-slate-200 p-1.5 align-top ${!onLeave && isToday ? 'bg-teal-50/50' : !onLeave && note ? 'bg-slate-100/70' : ''}`}
                      >
                        <div className="flex min-h-[64px] flex-col gap-1">
                          {onLeave && (
                            <span className="self-start rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700">On leave</span>
                          )}
                          {shown.map(t => (
                            <WeekChip key={t.id} task={t} employee={emp} date={d} today={today} running={runningTaskIds.has(t.id)} text={dayText(d)} onOpen={() => onOpenTask(t)} />
                          ))}
                          {more > 0 && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                onOpenDay(d);
                              }}
                              aria-label={`${more} more ${more === 1 ? 'task' : 'tasks'} for ${emp.name} on ${dayText(d)}. Open the day`}
                              className="min-h-[24px] self-start rounded px-1.5 text-[12px] font-extrabold text-teal-800 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                            >
                              +{more} more
                            </button>
                          )}
                        </div>
                        {/* A way in for the keyboard: the whole cell also takes a click. */}
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onAssign(emp.id, d);
                          }}
                          aria-label={`Assign a task to ${emp.name} on ${dayText(d)}`}
                          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-[15px] font-bold leading-none text-slate-600 opacity-0 hover:bg-teal-50 hover:text-teal-800 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 group-hover:opacity-100"
                        >
                          +
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phone: the week as a list, a day at a time. */}
      <div className="space-y-3 md:hidden" aria-label={`Week, ${weekLabel}`}>
        {dates.map(d => {
          const note = notes.get(d);
          const isToday = d === today;
          const entries = rows
            .flatMap(r => (r.visible.get(d) ?? []).map(t => ({ t, emp: r.emp })))
            .sort((a, b) => (taskSlot(a.t)?.start ?? 0) - (taskSlot(b.t)?.start ?? 0) || a.emp.name.localeCompare(b.emp.name));
          const awayNames = rows.filter(r => r.away.has(d)).map(r => r.emp.name);
          return (
            <article key={d} aria-label={dayText(d)} className={`rounded-xl border p-4 shadow-sm ${isToday ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200 bg-white'}`}>
              <button type="button" onClick={() => onOpenDay(d)} aria-label={`Open ${dayText(d)} on the day timetable`} className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left">
                <span className="text-[15px] font-extrabold text-ink">
                  {dayText(d)}
                  {isToday ? ' · Today' : ''}
                </span>
                <span className="text-[12.5px] font-bold text-slate-600">{note ? note.label : `${entries.length} ${entries.length === 1 ? 'task' : 'tasks'}`}</span>
              </button>
              {awayNames.length > 0 && <p className="m-0 mt-1 text-[12.5px] text-slate-600">On leave: {awayNames.join(', ')}</p>}
              {entries.length > 0 ? (
                <ul className="mt-2">
                  {entries.map(({ t, emp }) => {
                    const slot = taskSlot(t);
                    const tone = BLOCK_TONE[t.status];
                    return (
                      <li key={t.id}>
                        <button type="button" onClick={() => onOpenTask(t)} className="flex min-h-[56px] w-full items-center gap-3 border-t border-slate-100 py-2 text-left">
                          <span className="w-[84px] shrink-0 text-[12.5px] font-extrabold tabular-nums text-slate-700">{slot ? formatSlot(slot) : ''}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink">{t.title}</span>
                            <span className={`mt-0.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] ${isOverdue(t, today) ? 'text-rose-700' : tone.label}`}>
                              <StatusMark status={t.status} running={runningTaskIds.has(t.id)} />
                              <span className="truncate">
                                {emp.name} · {STATUS_LABEL[t.status]}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-0 mt-1 text-[13px] text-slate-600">No tasks.</p>
              )}
              <button type="button" onClick={() => onAssign('', d)} className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 text-[13px] font-bold text-slate-600">
                + Assign a task
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

/** One task in a day's cell: when it is and what it is, tinted by its status. */
function WeekChip({ task, employee, date, today, running, text, onOpen }: { task: Task; employee: Employee; date: string; today: string; running: boolean; text: string; onOpen: () => void }) {
  const slot = taskSlot(task);
  const tone = BLOCK_TONE[task.status];
  const overdue = isOverdue(task, today);
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`${task.title}, ${employee.name}, ${text}${slot ? `, ${formatSlot(slot)}` : ''}, ${STATUS_LABEL[task.status]}${overdue ? ', overdue' : ''}${running ? ', timer on' : ''}. Open details`}
      title={`${task.title} · ${slot ? formatSlot(slot) : ''} · ${STATUS_LABEL[task.status]}`}
      data-date={date}
      className={`flex min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1 text-left hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${tone.box}`}
    >
      <span className={`flex items-center gap-1.5 whitespace-nowrap text-[11px] font-extrabold tabular-nums ${overdue ? 'text-rose-700' : tone.label}`}>
        <StatusMark status={task.status} running={running} />
        {slot ? formatSlot(slot) : ''}
      </span>
      <span className="truncate text-[12.5px] font-extrabold leading-tight">{task.title}</span>
    </button>
  );
}
