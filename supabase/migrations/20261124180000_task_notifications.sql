-- Task notifications: employees do not accept or start tasks. The admin enters the work and the employee only sees it, so the
-- employee is told in the bell on their own portal and phone when an admin / HR login
--
--   * puts a task on their timetable (task_assigned), or hands them a task that was someone else's, or
--   * moves a task they already have to another day or time (task_changed).
--
-- It uses the same table and bell as the exit notices (20261104180000_employee_notifications.sql), with two more kinds. What is stored is
-- the task's title, day and time; the apps word it and show the day in the calendar (AD / BS) each person has switched on.
--
-- Who is NOT told: someone giving themselves a task, a task an employee adds for themselves, a change of status (the clock completes tasks,
-- see the Tasks page), a new title or description, and anything done by a script with no login (the SQL editor, seed files).
--
-- Re-runnable. Run once in the Supabase SQL editor, after 20261104180000_employee_notifications.sql and 20261122120000_task_time_slots.sql.

alter table employee_notifications drop constraint if exists employee_notifications_kind_check;
alter table employee_notifications add constraint employee_notifications_kind_check
  check (kind in ('exit_started', 'exit_updated', 'task_assigned', 'task_changed'));

create or replace function notify_employee_of_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_employee uuid;
  what text;
begin
  -- Only an admin or HR login counts: an employee's own task, and a script with no login, are not "the admin entering work".
  if not is_admin_or_hr() then
    return new;
  end if;
  if new.assigned_to is null then
    return new;
  end if;
  -- Giving yourself a task is not news to you.
  select employee_id into actor_employee from profiles where id = auth.uid();
  if actor_employee is not distinct from new.assigned_to then
    return new;
  end if;

  if tg_op = 'INSERT' then
    what := 'task_assigned';
  elsif new.assigned_to is distinct from old.assigned_to then
    what := 'task_assigned';
  elsif new.due_date is distinct from old.due_date
     or new.start_time is distinct from old.start_time
     or new.end_time is distinct from old.end_time then
    what := 'task_changed';
  else
    return new;
  end if;

  insert into employee_notifications (employee_id, kind, payload)
  values (
    new.assigned_to,
    what,
    jsonb_build_object('title', new.title, 'due_date', new.due_date, 'start_time', new.start_time, 'end_time', new.end_time)
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_employee_task on tasks;
create trigger trg_notify_employee_task
  after insert or update of assigned_to, due_date, start_time, end_time on tasks
  for each row execute function notify_employee_of_task();
