-- Finished tasks are saved as Completed by the database itself, every minute.
--
-- Tasks run on the clock: nobody accepts, starts or finishes one. A task with a time slot is Completed once its slot's END has passed
-- (the screens already SHOW it so, see withTimeStatus in admin-web/lib/taskSchedule.ts and mobile-app/src/lib/taskClock.ts). The stored
-- status only caught up when an admin happened to open the Tasks page, so anything reading the table (reports, the KPIs, scripts) saw
-- finished tasks as Pending until then. This migration saves the status on its own.
--
-- complete_finished_tasks() applies the rule once, and a pg_cron job calls it every minute:
--   * a task that is still to be done (pending or in progress), has a time slot and a day, and whose slot ended (Nepal time, UTC+5:45)
--     becomes 'approved' (shown as Completed). Nothing says a person reviewed it: reviewed_by / reviewed_at stay empty.
--   * a timer still running on such a task is stopped at the moment the slot ended (never before it started), as the Tasks page did.
--   * everything else is left alone: submitted, completed and rejected tasks, and tasks with no slot (they never finish by the clock).
-- Re-running it changes nothing more, so the page's own sweep and this job can both run. The first run also completes every task whose
-- time has already passed.
--
-- Nobody can call the function from the app (only the database owner, which is who pg_cron runs as): it needs no caller.
--
-- Run once, in the Supabase SQL editor, after 20261122120000_task_time_slots.sql. Re-runnable. It needs the pg_cron extension (Database >
-- Extensions); if it is not on, the function is still created and a notice says what to do. To see that it is running:
--   select jobname, schedule, active from cron.job where jobname = 'complete-finished-tasks';
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;

create or replace function complete_finished_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  completed integer;
begin
  -- Timers first, so none is left running on a task that is about to be completed.
  update task_time_logs l
  set ended_at = greatest(l.started_at, (t.due_date + t.end_time) at time zone 'Asia/Kathmandu')
  from tasks t
  where l.task_id = t.id
    and l.ended_at is null
    and t.status in ('pending', 'in_progress')
    and t.due_date is not null and t.start_time is not null and t.end_time is not null
    and (t.due_date + t.end_time) at time zone 'Asia/Kathmandu' <= now();

  update tasks
  set status = 'approved'
  where status in ('pending', 'in_progress')
    and due_date is not null and start_time is not null and end_time is not null
    and (due_date + end_time) at time zone 'Asia/Kathmandu' <= now();
  get diagnostics completed = row_count;
  return completed;
end;
$$;

revoke all on function complete_finished_tasks() from public, anon, authenticated;

-- Only the tasks still to be done are looked at every minute: keep that look-up cheap however many finished tasks pile up.
create index if not exists idx_tasks_open_by_day on tasks (due_date) where status in ('pending', 'in_progress');

-- Every minute. Wrapped so a project without pg_cron cannot roll back the function above.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'complete-finished-tasks';
  perform cron.schedule('complete-finished-tasks', '* * * * *', 'select public.complete_finished_tasks()');
exception
  when others then
    raise notice 'complete-finished-tasks was not scheduled (% — %); turn on pg_cron (Database > Extensions), then re-run this DO block by hand.', sqlstate, sqlerrm;
end $$;
