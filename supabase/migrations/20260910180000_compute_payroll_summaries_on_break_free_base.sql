-- compute_payroll_summaries(), rebuilt on the correct base.
--
-- Running the recompute failed with:
--
--   ERROR 42703: column "break_minutes" of relation "payroll_summaries"
--   does not exist
--
-- 20260904100000 removed the break-punch concept and dropped
-- payroll_summaries.break_minutes. 20260909120000 was then written against
-- the OLDER 20260825150000 version of this function, which still counted
-- breaks and wrote break_minutes -- so applying it put break code back into a
-- function whose table no longer has that column. 20260910150000 and
-- 20260910170000 were built on 20260909120000 and inherited the same fault.
-- The live function has been unable to write a single row since, including
-- the nightly run.
--
-- This is 20260904100000's break-free function -- the one that ran nightly
-- without error -- with exactly the changes that were meant to land on it:
--
--   From 20260909120000 (overnight duty whose only punch is the next-morning
--   tap-out):
--     - clear no-check-in rows for the dates this run touches;
--     - skip a day with no usable check-in instead of writing an empty row;
--     - the SECOND PASS that rescues a tap-out-only overnight duty.
--   Its break-punch bookkeeping is left out: breaks no longer exist.
--
--   From 20260910170000: the top delete's columns are table-qualified. The
--   function has a local variable named check_in, and an unqualified
--   "check_in is null" against payroll_summaries is ambiguous (42702).
--
--   From 20260910150000: a day whose every punch was claimed by the previous
--   night's overnight window loses its saved row, instead of keeping a stale
--   one that counts the tap-out a second time as that day's check-in.
--
-- Manually corrected rows are never modified or removed.

create or replace function compute_payroll_summaries(p_work_date date default null)
returns integer as $$
declare
  target_date date := coalesce(p_work_date, (now() at time zone 'Asia/Kathmandu')::date - 1);
  emp record;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_first_any timestamptz;
  v_last_any timestamptz;
  v_punch_count integer;
  check_in timestamptz;
  check_out timestamptz;
  fields record;
  rows_written integer := 0;
  v_window record;
  v_prev_window record;
  d_scan date;
begin
  -- Clear stale no-check-in rows for the dates this run touches. Columns are
  -- qualified because check_in is also a local variable here.
  delete from payroll_summaries
  where payroll_summaries.work_date in (target_date, target_date - 1)
    and payroll_summaries.check_in is null
    and not payroll_summaries.manually_corrected;

  for emp in
    select distinct e.id, e.company_id
    from employees e
    join attendance_logs al on al.employee_id = e.id
    where e.status = 'active' and (al.punch_time at time zone 'Asia/Kathmandu')::date = target_date
  loop
    select * into v_window from shift_window_for_date(emp.id, target_date);

    if v_window.is_overnight then
      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time) filter (where punch_type not in ('2', '3')),
        max(punch_time) filter (where punch_type not in ('2', '3')),
        count(*) filter (where punch_type not in ('2', '3'))
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id
        and punch_time >= v_window.window_start and punch_time < v_window.window_end;
    else
      -- Exclude any punch already claimed by an overnight shift from YESTERDAY
      -- (a checkout just after midnight Kathmandu would otherwise also raw-date-
      -- match today and get mislabeled as today's stray check-in).
      select * into v_prev_window from shift_window_for_date(emp.id, target_date - 1);
      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time) filter (where punch_type not in ('2', '3')),
        max(punch_time) filter (where punch_type not in ('2', '3')),
        count(*) filter (where punch_type not in ('2', '3'))
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id and (punch_time at time zone 'Asia/Kathmandu')::date = target_date
        and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end);
    end if;

    check_in := coalesce(v_first_in, v_first_any);
    check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
    if check_out = check_in then
      check_out := null;
    end if;

    -- No usable check-in: every punch this employee had for target_date was
    -- claimed by the previous day's overnight window. Nothing to summarize,
    -- and any row already saved for this date is stale -- it was built from a
    -- punch that belongs to last night's duty -- so it goes. The top delete
    -- does not catch it: that only removes rows whose check_in is null.
    if check_in is null then
      delete from payroll_summaries
      where payroll_summaries.employee_id = emp.id
        and payroll_summaries.work_date = target_date
        and not payroll_summaries.manually_corrected;
      continue;
    end if;

    select * into fields from calc_payroll_fields(emp.id, check_in, check_out, target_date);

    insert into payroll_summaries (
      employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
      is_late, late_minutes, is_early_departure, early_departure_minutes,
      overtime_hours, computed_at
    ) values (
      emp.id, emp.company_id, target_date, fields.shift_name, check_in, check_out, fields.total_hours,
      fields.is_late, fields.late_minutes, fields.is_early_departure, fields.early_departure_minutes,
      fields.overtime_hours, now()
    )
    on conflict (employee_id, work_date) do update set
      shift_name = excluded.shift_name,
      check_in = excluded.check_in,
      check_out = excluded.check_out,
      total_hours = excluded.total_hours,
      is_late = excluded.is_late,
      late_minutes = excluded.late_minutes,
      is_early_departure = excluded.is_early_departure,
      early_departure_minutes = excluded.early_departure_minutes,
      overtime_hours = excluded.overtime_hours,
      computed_at = excluded.computed_at
    where payroll_summaries.manually_corrected = false;

    rows_written := rows_written + 1;
  end loop;

  -- SECOND PASS: overnight duty dates whose only punch is the next-morning
  -- tap-out. Scans target_date and the day before.
  foreach d_scan in array array[target_date, target_date - 1]
  loop
    for emp in
      select e.id, e.company_id
      from employees e
      where e.status = 'active'
        and not exists (
          select 1 from attendance_logs al
          where al.employee_id = e.id
            and (al.punch_time at time zone 'Asia/Kathmandu')::date = d_scan
        )
    loop
      select * into v_window from shift_window_for_date(emp.id, d_scan);
      if not coalesce(v_window.is_overnight, false) then
        continue;
      end if;

      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time) filter (where punch_type not in ('2', '3')),
        max(punch_time) filter (where punch_type not in ('2', '3')),
        count(*) filter (where punch_type not in ('2', '3'))
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id
        and punch_time >= v_window.window_start and punch_time < v_window.window_end;

      if coalesce(v_punch_count, 0) = 0 then
        continue;
      end if;

      -- Only rescue when the day after the duty is itself a Week Off, so a
      -- real working day never loses its own check-in to this window.
      if not (select is_week_off from find_employee_shift_for_date(emp.id, d_scan + 1)) then
        continue;
      end if;

      check_in := coalesce(v_first_in, v_first_any);
      check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
      if check_out = check_in then
        check_out := null;
      end if;
      if check_in is null then
        continue;
      end if;

      select * into fields from calc_payroll_fields(emp.id, check_in, check_out, d_scan);

      insert into payroll_summaries (
        employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
        is_late, late_minutes, is_early_departure, early_departure_minutes,
        overtime_hours, computed_at
      ) values (
        emp.id, emp.company_id, d_scan, fields.shift_name, check_in, check_out, fields.total_hours,
        fields.is_late, fields.late_minutes, fields.is_early_departure, fields.early_departure_minutes,
        fields.overtime_hours, now()
      )
      on conflict (employee_id, work_date) do update set
        shift_name = excluded.shift_name,
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        total_hours = excluded.total_hours,
        is_late = excluded.is_late,
        late_minutes = excluded.late_minutes,
        is_early_departure = excluded.is_early_departure,
        early_departure_minutes = excluded.early_departure_minutes,
        overtime_hours = excluded.overtime_hours,
        computed_at = excluded.computed_at
      where payroll_summaries.manually_corrected = false;

      rows_written := rows_written + 1;
    end loop;
  end loop;

  return rows_written;
end;
$$ language plpgsql;
