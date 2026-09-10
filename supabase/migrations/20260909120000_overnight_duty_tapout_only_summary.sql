-- An overnight / 24-hour duty (e.g. "DN 24 Hours Duty", 09:00 -> 08:00 next
-- day) where the employee taps only ONCE, on the way OUT the following
-- morning, produced no payroll_summaries row for the duty date at all:
-- compute_payroll_summaries()'s main loop only visits employees who have a
-- punch whose Kathmandu calendar date equals target_date, and the lone
-- tap-out is dated target_date + 1. So the duty read as Absent on every
-- surface, while the next day -- usually the employee's rostered Week Off --
-- got nothing usable either (the non-overnight branch already, correctly,
-- excludes the prior overnight window's tail punches from it).
--
-- This adds a SECOND pass that re-scans for exactly that shape -- a date
-- rostered to an overnight shift, no punch on that date, but punches inside
-- the overnight window (necessarily on the next calendar day) -- and writes
-- that date's row from the window. It runs for target_date AND
-- target_date - 1, because the tap-out for a duty that began on target_date
-- lands ~24h later, typically after the nightly job has already processed
-- target_date; the run that processes "yesterday" is the first one that can
-- see it.
--
-- Guard: the rescue only fires when the day AFTER the duty date is itself a
-- Week Off for that employee, so a genuine back-to-back working day can
-- never lose its own check-in to the previous day's window. Manually
-- corrected rows are left untouched (same `where manually_corrected = false`
-- as the main upsert). Mirrors the client-side half in
-- admin-web/mobile-app lib/shift.ts applyOvernightShiftCorrection().
--
-- Also: STOP persisting summary rows with a null check_in. The function
-- writes a row for every employee with a raw punch on target_date, so a
-- Week Off / Absent day whose only punch was then claimed by the previous
-- day's overnight window got a row with no check_in and 0 hours. Those rows
-- carry no attendance, and every reader that saw "a row exists" treated the
-- day as worked (the Attendance Report then rendered it "Absent" because
-- Present + no check-in falls through every badge case; the payroll report
-- counted it toward paid days). A stale-row cleanup for the processed dates
-- runs first so existing ones clear on the next nightly run / recalculate.
--
-- Everything else is verbatim from
-- 20260825150000_fix_compute_payroll_utc_date_bucketing.sql.

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
  v_break_minutes integer;
  v_break_start timestamptz;
  v_break_punch record;
  check_in timestamptz;
  check_out timestamptz;
  fields record;
  rows_written integer := 0;
  v_window record;
  v_prev_window record;
  d_scan date;
begin
  -- Clear stale no-check-in rows for the dates this run touches, so the
  -- ones written before this migration disappear on the next nightly run /
  -- "Recalculate month". The loops below no longer create them.
  delete from payroll_summaries
  where work_date in (target_date, target_date - 1)
    and check_in is null
    and not manually_corrected;

  for emp in
    select distinct e.id, e.company_id
    from employees e
    join attendance_logs al on al.employee_id = e.id
    where e.status = 'active' and (al.punch_time at time zone 'Asia/Kathmandu')::date = target_date
  loop
    select * into v_window from shift_window_for_date(emp.id, target_date);
    v_break_minutes := 0;
    v_break_start := null;

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

      for v_break_punch in
        select punch_type, punch_time from attendance_logs
        where employee_id = emp.id and punch_type in ('2', '3')
          and punch_time >= v_window.window_start and punch_time < v_window.window_end
        order by punch_time
      loop
        if v_break_punch.punch_type = '2' then
          v_break_start := v_break_punch.punch_time;
        elsif v_break_punch.punch_type = '3' and v_break_start is not null then
          v_break_minutes := v_break_minutes + round(extract(epoch from (v_break_punch.punch_time - v_break_start)) / 60);
          v_break_start := null;
        end if;
      end loop;
    else
      -- Exclude any punch already claimed by an overnight shift from
      -- YESTERDAY (if yesterday was overnight for this employee) -- a
      -- checkout just after midnight Kathmandu would otherwise also raw-
      -- date-match today and get mislabeled as today's stray check-in.
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

      for v_break_punch in
        select punch_type, punch_time from attendance_logs
        where employee_id = emp.id and punch_type in ('2', '3') and (punch_time at time zone 'Asia/Kathmandu')::date = target_date
          and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end)
        order by punch_time
      loop
        if v_break_punch.punch_type = '2' then
          v_break_start := v_break_punch.punch_time;
        elsif v_break_punch.punch_type = '3' and v_break_start is not null then
          v_break_minutes := v_break_minutes + round(extract(epoch from (v_break_punch.punch_time - v_break_start)) / 60);
          v_break_start := null;
        end if;
      end loop;
    end if;

    check_in := coalesce(v_first_in, v_first_any);
    check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
    if check_out = check_in then
      check_out := null;
    end if;

    -- No usable check-in (every punch this employee had for target_date was
    -- claimed by the previous day's overnight window, or it is a Week Off /
    -- Absent day the scan swept in): nothing to summarize. The top-of-
    -- function delete already removed any prior row.
    if check_in is null then
      continue;
    end if;

    select * into fields from calc_payroll_fields(emp.id, check_in, check_out, target_date);

    insert into payroll_summaries (
      employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
      is_late, late_minutes, is_early_departure, early_departure_minutes,
      overtime_hours, break_minutes, computed_at
    ) values (
      emp.id, emp.company_id, target_date, fields.shift_name, check_in, check_out, fields.total_hours,
      fields.is_late, fields.late_minutes, fields.is_early_departure, fields.early_departure_minutes,
      fields.overtime_hours, v_break_minutes, now()
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
      break_minutes = excluded.break_minutes,
      computed_at = excluded.computed_at
    where payroll_summaries.manually_corrected = false;

    rows_written := rows_written + 1;
  end loop;

  -- SECOND PASS: overnight duty dates whose only punch is the next-morning
  -- tap-out (see the migration header). Scans target_date and the day before.
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

      v_break_minutes := 0;
      v_break_start := null;
      for v_break_punch in
        select punch_type, punch_time from attendance_logs
        where employee_id = emp.id and punch_type in ('2', '3')
          and punch_time >= v_window.window_start and punch_time < v_window.window_end
        order by punch_time
      loop
        if v_break_punch.punch_type = '2' then
          v_break_start := v_break_punch.punch_time;
        elsif v_break_punch.punch_type = '3' and v_break_start is not null then
          v_break_minutes := v_break_minutes + round(extract(epoch from (v_break_punch.punch_time - v_break_start)) / 60);
          v_break_start := null;
        end if;
      end loop;

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
        overtime_hours, break_minutes, computed_at
      ) values (
        emp.id, emp.company_id, d_scan, fields.shift_name, check_in, check_out, fields.total_hours,
        fields.is_late, fields.late_minutes, fields.is_early_departure, fields.early_departure_minutes,
        fields.overtime_hours, v_break_minutes, now()
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
        break_minutes = excluded.break_minutes,
        computed_at = excluded.computed_at
      where payroll_summaries.manually_corrected = false;

      rows_written := rows_written + 1;
    end loop;
  end loop;

  return rows_written;
end;
$$ language plpgsql;
