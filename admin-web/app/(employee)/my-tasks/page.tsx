'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { PageBody } from '@/components/employee/parts';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalDateKey } from '@/lib/shift';
import { formatDuration, formatSlot, relativeDayLabel, slotEndMs, slotLength, slotStartMs, taskSlot, weekdayName, withTimeStatus } from '@/lib/taskSchedule';
import type { Task } from '@/lib/types';

/** How many finished tasks are listed before "Show all". */
const DONE_SHOWN = 8;

/** Oldest first by day and start time; a task with no day goes last, and one with a day but no time goes after that day's timed tasks. */
const when = (t: Task) => `${t.due_date ?? '9999-12-31'}T${t.start_time ?? '99:99'}`;

/** "25 min left", "1 h 5 min left". */
function timeLeft(minutes: number): string {
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`;
}

/** The employee's own tasks, to look at. The manager enters the work and the clock does the rest (a task starts when its time begins and is
 * done when its time ends), so there is nothing to accept, start or finish here: what they are working on now, what is coming up, and what
 * is done. A new task is announced in the bell. */
export default function MyTasksPage() {
  usePageTitle('My Tasks');
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  // The tasks as stored. `tasks` (below) is what is shown by the clock.
  const [rawTasks, setRawTasks] = useState<Task[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showAllDone, setShowAllDone] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      if (!active) return;
      setEmployeeId((profile?.employee_id as string | null) ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // The list is read again when the page comes back into view and every 5 minutes, so a task the manager has just entered shows up.
  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    const load = () => {
      Promise.resolve(supabase.from('tasks').select('*').eq('assigned_to', employeeId).order('due_date', { ascending: true })).then(({ data, error }) => {
        if (!active) return;
        if (error) setLoadError(`Could not load your tasks: ${error.message}`);
        else {
          setLoadError('');
          setRawTasks((data as Task[] | null) ?? []);
        }
      });
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [employeeId]);

  // The clock moves once a minute: a task that begins moves to "working on now", one whose time ends moves to "done".
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const today = nepalDateKey(new Date(clock).toISOString());
  const tasks = useMemo(() => rawTasks.map(t => withTimeStatus(t, clock)), [rawTasks, clock]);
  const working = useMemo(() => tasks.filter(t => t.status === 'in_progress').sort((a, b) => when(a).localeCompare(when(b))), [tasks]);
  const upcoming = useMemo(() => tasks.filter(t => t.status === 'pending').sort((a, b) => when(a).localeCompare(when(b))), [tasks]);
  const done = useMemo(() => tasks.filter(t => t.status === 'approved' || t.status === 'submitted' || t.status === 'rejected').sort((a, b) => when(b).localeCompare(when(a))), [tasks]);
  const doneShown = showAllDone ? done : done.slice(0, DONE_SHOWN);

  /** "Today", "Tomorrow" or "Fri 27 Nov 2026", then "· 2:00–3:00 PM · 1 h" when it has a time. */
  function whenText(t: Task): string {
    let day = 'No day set yet';
    if (t.due_date) {
      const rel = relativeDayLabel(t.due_date, today);
      day = rel === 'today' ? 'Today' : rel === 'tomorrow' ? 'Tomorrow' : `${weekdayName(t.due_date)} ${formatAdDate(t.due_date, system)}`;
    }
    const slot = taskSlot(t);
    return slot ? `${day} · ${formatSlot(slot)} · ${formatDuration(slotLength(slot))}` : `${day} · no time set yet`;
  }

  function card(t: Task, kind: 'working' | 'upcoming' | 'done') {
    const start = slotStartMs(t);
    const end = slotEndMs(t);
    const pct = kind === 'working' && start !== null && end !== null ? Math.min(100, Math.max(0, Math.round(((clock - start) / (end - start)) * 100))) : null;
    const left = kind === 'working' && end !== null ? Math.max(0, Math.ceil((end - clock) / 60000)) : null;
    return (
      <li key={t.id} className={`rounded-xl border bg-white p-4 shadow-sm ${kind === 'working' ? 'border-accent' : 'border-slate-200'}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h3 className="min-w-0 text-[15px] font-semibold text-ink">{t.title}</h3>
          {kind === 'done' && t.status === 'approved' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              Done
            </span>
          )}
          {kind === 'done' && t.status === 'submitted' && <span className="text-xs font-bold text-amber-700">Under review</span>}
          {kind === 'done' && t.status === 'rejected' && <span className="text-xs font-bold text-rose-700">Sent back</span>}
        </div>
        <p className="mt-0.5 text-[13px] tabular-nums text-slate-600">{whenText(t)}</p>
        {t.description && <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{t.description}</p>}
        {pct !== null && left !== null && (
          <div className="mt-3">
            <div role="progressbar" aria-label={`${t.title}: ${pct}% of its time has passed`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-600">{timeLeft(left)}</p>
          </div>
        )}
      </li>
    );
  }

  function section(id: string, title: string, list: Task[], kind: 'working' | 'upcoming' | 'done', empty: string, shown: Task[] = list) {
    return (
      <section aria-labelledby={id} className="mb-8">
        <h2 id={id} className="mb-3 flex items-center gap-2 text-base font-extrabold text-ink">
          {title}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">{list.length}</span>
        </h2>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{empty}</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">{shown.map(t => card(t, kind))}</ul>
        )}
        {kind === 'done' && list.length > DONE_SHOWN && (
          <button type="button" onClick={() => setShowAllDone(s => !s)} className="mt-3 min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
            {showAllDone ? 'Show fewer' : `Show all ${list.length}`}
          </button>
        )}
      </section>
    );
  }

  if (loading) {
    return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!employeeId) {
    return <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>;
  }

  return (
    <PageBody>
      <div className="mx-auto max-w-[860px]">
        {loadError && (
          <p role="alert" className="mb-4 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-text">
            {loadError}
          </p>
        )}
        {section('tasks-now', 'Working on now', working, 'working', 'Nothing in progress right now.')}
        {section('tasks-upcoming', 'Upcoming', upcoming, 'upcoming', 'No tasks coming up. When your manager gives you one, you will be told here.')}
        {section('tasks-done', 'Done', done, 'done', 'No finished tasks yet.', doneShown)}
      </div>
    </PageBody>
  );
}
