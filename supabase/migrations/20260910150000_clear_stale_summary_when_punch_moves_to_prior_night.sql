-- A day whose only punch moves to the previous night's overnight duty now
-- loses its saved payroll_summaries row, instead of keeping it.
--
-- Found on Raju Bajgain (Ashadeep), rostered to a 24h "DN 24 Hours Duty"
-- (09:00 -> 08:00) on Sundays and Thursdays. His Sunday duty ends with a
-- tap-out around 09:01 on Monday. His summaries were computed while his
-- roster still had that duty on Monday, so Monday got a row with the 09:01
-- tap-out as its check-in. Once the roster was corrected to Sunday, a
-- recompute correctly pulls that 09:01 punch into Sunday's overnight window
-- (which runs to 10:00 the next morning) -- but then found nothing left for
-- Monday and skipped writing it, leaving the old Monday row behind. The
-- report showed the punch twice: as Sunday's tap-out and as "Present 09:01"
-- on a Week Off Monday.
--
-- The function's own comment claimed the top-of-function delete had already
-- removed any prior row. It had not: that delete is limited to rows with no
-- check_in (20260909120000), and this row has one.
--
-- It is not specific to Raju -- it affects any employee whose roster moves
-- an overnight duty after that day was summarised. Nothing changes for a
-- day that still has its own check-in, and manually_corrected rows are
-- untouched as before.
--
-- Identical to 20260909120000's compute_payroll_summaries apart from the
-- "if check_in is null" branch.
--
-- Existing stale rows are only cleared when their date is recomputed.
-- Apply 20260910160000 too before recomputing, and do NOT run a bare recompute from the SQL
-- editor: it runs as a superuser, bypasses RLS, and recomputes every tenant
-- -- restating other companies' past days too. Recompute one company by
-- running as one of its admins, inside a transaction:
--
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claim.sub', '<admin user id>', true);
--     select set_config('request.jwt.claims',
--       '{"sub":"<admin user id>","role":"authenticated"}', true);
--     select d::date, compute_payroll_summaries(d::date)
--     from generate_series(date '<from>', date '<to>', interval '1 day') d;
--   commit;

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
    -- Absent day the scan swept in): nothing to summarize -- and any row
    -- already saved for this date is now stale, so it goes.
    --
    -- The top-of-function delete does NOT cover this. It only removes rows
    -- whose check_in is null, and a stale row here has one: the punch it
    -- was built from, which now belongs to last night's duty instead.
    -- Skipping the write left that row in place, so the same punch counted
    -- twice -- as the overnight duty's tap-out AND as this day's
    -- check-in. Hand-corrected rows are never removed.
    if check_in is null then
      delete from payroll_summaries
      where employee_id = emp.id
        and work_date = target_date
        and not manually_corrected;
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
