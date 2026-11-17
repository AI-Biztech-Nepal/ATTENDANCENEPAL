-- Notifications for employees: when HR or an admin changes someone's exit (the last working day, the notice
-- period, a checklist step, the settlement), the employee gets a notice in the bell on their own portal and phone.
--
--   * employee_notifications — one row per HR save, listing what changed. The employee can read their own and
--     mark them read; nothing else is reachable from the app.
--   * A trigger on employee_separations writes them. It only fires for an admin / HR login, and never for the
--     person's own hand-in or withdrawal (those run as the employee, who does not need telling about what they
--     just did), so nobody is notified about their own action.
--
-- What is stored is what changed (the field and its new value), not a sentence: the apps word it and show dates
-- in the calendar (AD / BS) each person has switched on.
--
-- Re-runnable. Run once in the Supabase SQL editor, after 20261103140000_*.

create table if not exists employee_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  -- exit_started: HR opened an exit for them. exit_updated: HR changed something on it.
  kind text not null check (kind in ('exit_started', 'exit_updated')),
  -- { "changes": [ { "k": "last_working_on", "v": "2026-11-20" }, ... ] }
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_employee_notifications_employee on employee_notifications(employee_id, created_at desc);

alter table employee_notifications enable row level security;

drop trigger if exists trg_stamp_company_id on employee_notifications;
create trigger trg_stamp_company_id before insert on employee_notifications
  for each row execute function stamp_company_id_from_employee();

-- Read your own. There is deliberately no insert / update / delete policy: rows are written by the trigger below
-- and marked read through mark_my_notifications_read().
drop policy if exists "employee_notifications: employee read own" on employee_notifications;
create policy "employee_notifications: employee read own" on employee_notifications
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));

create or replace function mark_my_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update employee_notifications
  set read_at = now()
  where read_at is null
    and employee_id = (select employee_id from profiles where id = auth.uid());
$$;

revoke all on function mark_my_notifications_read() from public, anon;
grant execute on function mark_my_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

create or replace function notify_employee_of_exit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_employee uuid;
  changes jsonb := '[]'::jsonb;
begin
  -- Only an admin or HR login counts. The employee's own hand-in and withdrawal run as the employee, and a
  -- script with no login (the SQL editor) is not HR "doing" something to someone.
  if not is_admin_or_hr() then
    return new;
  end if;
  -- An HR person ending their own employment is not news to them either.
  select employee_id into actor_employee from profiles where id = auth.uid();
  if actor_employee is not distinct from new.employee_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into employee_notifications (employee_id, kind) values (new.employee_id, 'exit_started');
    return new;
  end if;

  if new.separation_type is distinct from old.separation_type then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'separation_type', 'v', new.separation_type));
  end if;
  if new.last_working_on is distinct from old.last_working_on and new.last_working_on is not null then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'last_working_on', 'v', new.last_working_on));
  end if;
  if new.notice_required_days is distinct from old.notice_required_days and new.notice_required_days is not null then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'notice_required_days', 'v', new.notice_required_days));
  end if;
  if new.exit_interview_status is distinct from old.exit_interview_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'exit_interview', 'v', new.exit_interview_status));
  end if;
  if new.clearance_status is distinct from old.clearance_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'clearance', 'v', new.clearance_status));
  end if;
  if new.uniform_id_status is distinct from old.uniform_id_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'uniform_id', 'v', new.uniform_id_status));
  end if;
  if new.asset_keys_status is distinct from old.asset_keys_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'asset_keys', 'v', new.asset_keys_status));
  end if;
  if new.asset_equipment_status is distinct from old.asset_equipment_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'asset_equipment', 'v', new.asset_equipment_status));
  end if;
  if new.asset_device_status is distinct from old.asset_device_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'asset_device', 'v', new.asset_device_status));
  end if;
  if new.asset_other_status is distinct from old.asset_other_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'asset_other', 'v', new.asset_other_status));
  end if;
  if new.experience_letter_status is distinct from old.experience_letter_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'experience_letter', 'v', new.experience_letter_status));
  end if;
  if new.settlement_status is distinct from old.settlement_status then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'settlement', 'v', new.settlement_status));
  end if;
  -- The figures are on their Exit tab; the notice only says they moved, not by how much.
  if new.final_salary is distinct from old.final_salary
     or new.leave_encashment is distinct from old.leave_encashment
     or new.incentive_settlement is distinct from old.incentive_settlement
     or new.other_payments is distinct from old.other_payments
     or new.outstanding_advances is distinct from old.outstanding_advances
     or new.other_deductions is distinct from old.other_deductions then
    changes := changes || jsonb_build_array(jsonb_build_object('k', 'amounts'));
  end if;

  -- Notes and other internal edits change nothing the employee needs to hear about.
  if jsonb_array_length(changes) > 0 then
    insert into employee_notifications (employee_id, kind, payload)
    values (new.employee_id, 'exit_updated', jsonb_build_object('changes', changes));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_employee_exit on employee_separations;
create trigger trg_notify_employee_exit
  after insert or update on employee_separations
  for each row execute function notify_employee_of_exit_change();
