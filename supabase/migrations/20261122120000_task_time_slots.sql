-- Task timetable: a task can be given a time slot on a day.
--
-- due_date stays the day (and the deadline); start_time / end_time are the hours worked inside it.
-- A task with no slot (every task created before this, and tasks employees add for themselves) is
-- simply "not scheduled" and keeps working exactly as before. Run once, after
-- 20260728140000_task_time_tracking.sql.

alter table tasks add column if not exists start_time time;
alter table tasks add column if not exists end_time time;

-- Both or neither; the slot ends after it starts (so it stays inside one day) and needs a day.
alter table tasks drop constraint if exists tasks_time_slot_check;
alter table tasks add constraint tasks_time_slot_check check (
  (start_time is null and end_time is null)
  or (start_time is not null and end_time is not null and end_time > start_time and due_date is not null)
);

create index if not exists idx_tasks_assignee_day on tasks (assigned_to, due_date) where start_time is not null;

-- Guards the slot itself, so it holds for every client (web, phone, scripts), not just the timetable:
--   * only a manager (admin / HR) can put a task on the timetable;
--   * two tasks of the same employee on the same day cannot overlap;
--   * nobody can be given a slot on a day they are on approved leave.
-- It only fires when the assignee, day or hours change, so an employee starting/submitting a task, or a
-- manager approving one, is never blocked by it. SECURITY DEFINER so the overlap and leave look-ups see
-- every row the rule is about, whoever is asking (the caller's own permission is checked explicitly).
create or replace function tasks_check_time_slot()
returns trigger as $$
declare
  clash record;
begin
  if new.start_time is null then
    return new;
  end if;

  if not is_admin_or_hr() then
    raise exception 'Only a manager can schedule a task';
  end if;

  select t.title, t.start_time, t.end_time into clash
  from tasks t
  where t.assigned_to = new.assigned_to
    and t.due_date = new.due_date
    and t.start_time is not null
    and t.id <> new.id
    and t.start_time < new.end_time
    and t.end_time > new.start_time
  limit 1;
  if found then
    raise exception 'Overlaps "%" (% - %)', clash.title, left(clash.start_time::text, 5), left(clash.end_time::text, 5);
  end if;

  if exists (
    select 1 from leave_requests l
    where l.employee_id = new.assigned_to
      and l.status = 'approved'
      and new.due_date between l.start_date and l.end_date
  ) then
    raise exception 'This employee is on approved leave on that day';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_tasks_check_time_slot on tasks;
create trigger trg_tasks_check_time_slot
  before insert or update of assigned_to, due_date, start_time, end_time on tasks
  for each row execute function tasks_check_time_slot();
