-- Cancelling a task removes its tracked time in the same step: all or nothing.
--
-- task_time_logs.task_id referred to tasks(id) with no cascade (20260728140000_task_time_tracking.sql), so the database refused to delete a
-- task that had any time logged. The Tasks page therefore deleted the task's time logs first and the task second, as two separate
-- requests: if the second failed (a security rule, a lost connection), the task was left behind with its tracked time already gone.
--
-- With ON DELETE CASCADE a single delete of the task takes its time logs with it, in one statement, so either both go or neither does. The
-- page now sends that one delete. (The scripts that remove an employee or a whole company still delete the logs first; that still works.)
--
-- Nothing else changes: who may delete a task is still decided by tasks' own security rules, and the time logs of a task that stays are
-- untouched. The foreign key is replaced under whatever name it has, so this works however it was first created. Run once, in the Supabase
-- SQL editor, after 20260728140000_task_time_tracking.sql. Re-runnable.

do $$
declare
  fk record;
begin
  for fk in
    select conname
    from pg_constraint
    where conrelid = 'public.task_time_logs'::regclass
      and confrelid = 'public.tasks'::regclass
      and contype = 'f'
  loop
    execute format('alter table public.task_time_logs drop constraint %I', fk.conname);
  end loop;

  alter table public.task_time_logs
    add constraint task_time_logs_task_id_fkey foreign key (task_id) references public.tasks(id) on delete cascade;
end $$;
