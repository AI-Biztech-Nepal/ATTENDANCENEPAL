-- A duty worked on a Week Off that runs past midnight (a 24-hour or night
-- duty) is measured to its next-morning check-out.
--
-- A Week Off has no shift, so compute_payroll_summaries() had nothing telling
-- it the work crosses midnight and bucketed punches by calendar date: the
-- Week Off got its check-in and 0 hours, and the next morning's check-out was
-- read as the NEXT day's check-in. ASHADEEP staff doing a 24h duty on their
-- Week Off (e.g. Fri 08:54 -> Sat 09:04) therefore showed 0h, earned no
-- leave, and the check-out made the next day look worked.
--
-- New rule: a Week Off whose only punch is a check-in takes as its check-out
-- the employee's first punch on the NEXT calendar day, if that punch lands
-- within 26 hours of the check-in (a 24h duty plus the same 2-hour allowance
-- overnight shifts get). That punch then belongs to the Week Off and is left
-- out of the next day, whose row is rebuilt from its remaining punches -- or
-- dropped when none remain. Not when the next day is a working day with more
-- than one punch: its first punch is then its own check-in.
--
-- Only for companies with companies.week_off_work_earns_leave on
-- (20260911100000): they are the ones paying for Week Off work by the hour.
-- For everyone else a lone Week Off punch followed by a next-morning punch is
-- far more likely a forgotten check-out plus a normal next-day check-in, so
-- their attendance is unchanged.
--
-- Also: each run now processes target_date - 1 as well as target_date. The
-- nightly job runs at 07:45 Nepal time, before a duty that started yesterday
-- has ended, so yesterday's Week Off only gets its check-out on the following
-- night's run.
--
-- Manually corrected rows are never modified or removed.

-- The next-morning check-out for a Week Off duty that started on p_date, or
-- null when p_date isn't one. Recursive on p_date - 1: when the day before
-- was itself a Week Off duty that took this day's first punch as ITS
-- check-out, that punch isn't available to start a duty today.
create or replace function week_off_duty_checkout(p_employee_id uuid, p_date date, p_depth integer default 0)
returns timestamptz as $$
declare
  v_prev_window record;
  v_prev_tail timestamptz;
  v_count integer;
  v_in timestamptz;
  v_out timestamptz;
begin
  -- A run of lone punches on consecutive Week Offs is rare; a week is plenty.
  if p_depth > 7 then
    return null;
  end if;

  if not exists (
    select 1 from employees e
    join companies c on c.id = e.company_id
    where e.id = p_employee_id and c.week_off_work_earns_leave
  ) then
    return null;
  end if;

  if not coalesce((select is_week_off from find_employee_shift_for_date(p_employee_id, p_date)), false) then
    return null;
  end if;

  select * into v_prev_window from shift_window_for_date(p_employee_id, p_date - 1);
  v_prev_tail := week_off_duty_checkout(p_employee_id, p_date - 1, p_depth + 1);

  -- This Week Off's own punches: its calendar date, minus anything the day
  -- before already claimed (an overnight shift's window, or a Week Off duty's
  -- check-out). Exactly one = a check-in with no check-out.
  select count(*), min(punch_time) into v_count, v_in
  from attendance_logs
  where employee_id = p_employee_id
    and punch_type not in ('2', '3')
    and (punch_time at time zone 'Asia/Kathmandu')::date = p_date
    and (not coalesce(v_prev_window.is_overnight, false) or punch_time >= v_prev_window.window_end)
    and punch_time is distinct from v_prev_tail;

  if v_count <> 1 then
    return null;
  end if;

  select min(punch_time) into v_out
  from attendance_logs
  where employee_id = p_employee_id
    and punch_type not in ('2', '3')
    and (punch_time at time zone 'Asia/Kathmandu')::date = p_date + 1
    and punch_time > v_in
    and punch_time <= v_in + interval '26 hours';

  if v_out is null then
    return null;
  end if;

  -- A next day that is a working day with punches of its own (e.g. an 8h day
  -- shift, check-in and check-out) keeps its first punch: that is its own
  -- check-in, not this Week Off's check-out.
  if not coalesce((select is_week_off from find_employee_shift_for_date(p_employee_id, p_date + 1)), false)
     and (
       select count(*) from attendance_logs
       where employee_id = p_employee_id
         and punch_type not in ('2', '3')
         and (punch_time at time zone 'Asia/Kathmandu')::date = p_date + 1
     ) > 1 then
    return null;
  end if;

  return v_out;
end;
$$ language plpgsql stable;

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
  v_prev_tail timestamptz;
  v_tail timestamptz;
  d_scan date;
  d_main date;
begin
  -- Clear stale no-check-in rows for the dates this run touches. Columns are
  -- qualified because check_in is also a local variable here.
  delete from payroll_summaries
  where payroll_summaries.work_date in (target_date, target_date - 1)
    and payroll_summaries.check_in is null
    and not payroll_summaries.manually_corrected;

  -- Yesterday first, then today: see the header on why yesterday is redone.
  foreach d_main in array array[target_date - 1, target_date]
  loop
    for emp in
      select distinct e.id, e.company_id
      from employees e
      join attendance_logs al on al.employee_id = e.id
      where e.status = 'active' and (al.punch_time at time zone 'Asia/Kathmandu')::date = d_main
    loop
      select * into v_window from shift_window_for_date(emp.id, d_main);
      -- The previous day's Week Off duty check-out, if it took one of today's
      -- punches. Left out of both branches below.
      v_prev_tail := week_off_duty_checkout(emp.id, d_main - 1);

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
          and punch_time >= v_window.window_start and punch_time < v_window.window_end
          and punch_time is distinct from v_prev_tail;
      else
        -- Exclude any punch already claimed by an overnight shift from
        -- YESTERDAY (a checkout just after midnight Kathmandu would otherwise
        -- also raw-date-match today and get mislabeled as today's stray
        -- check-in).
        select * into v_prev_window from shift_window_for_date(emp.id, d_main - 1);
        select
          min(punch_time) filter (where punch_type = '0'),
          max(punch_time) filter (where punch_type = '1'),
          min(punch_time) filter (where punch_type not in ('2', '3')),
          max(punch_time) filter (where punch_type not in ('2', '3')),
          count(*) filter (where punch_type not in ('2', '3'))
        into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
        from attendance_logs
        where employee_id = emp.id and (punch_time at time zone 'Asia/Kathmandu')::date = d_main
          and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end)
          and punch_time is distinct from v_prev_tail;
      end if;

      check_in := coalesce(v_first_in, v_first_any);
      check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
      if check_out = check_in then
        check_out := null;
      end if;

      -- A Week Off duty that ran into the next morning: its check-out is the
      -- next day's first punch (week_off_duty_checkout() re-checks that this
      -- is a Week Off with a lone check-in).
      if check_in is not null and check_out is null then
        v_tail := week_off_duty_checkout(emp.id, d_main);
        if v_tail is not null then
          check_out := v_tail;
        end if;
      end if;

      -- No usable check-in: every punch this employee had for d_main was
      -- claimed by the previous day (an overnight window or a Week Off
      -- duty). Nothing to summarize, and any row already saved for this date
      -- is stale, so it goes.
      if check_in is null then
        delete from payroll_summaries
        where payroll_summaries.employee_id = emp.id
          and payroll_summaries.work_date = d_main
          and not payroll_summaries.manually_corrected;
        continue;
      end if;

      select * into fields from calc_payroll_fields(emp.id, check_in, check_out, d_main);

      insert into payroll_summaries (
        employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
        is_late, late_minutes, is_early_departure, early_departure_minutes,
        overtime_hours, computed_at
      ) values (
        emp.id, emp.company_id, d_main, fields.shift_name, check_in, check_out, fields.total_hours,
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

  -- SECOND PASS: overnight duty dates whose only punch is the next-morning
  -- tap-out. Scans target_date and the day before. Unchanged.
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
