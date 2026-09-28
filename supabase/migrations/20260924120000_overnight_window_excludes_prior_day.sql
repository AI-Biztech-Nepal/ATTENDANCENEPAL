-- The overnight branch of compute_payroll_summaries() never excluded a punch
-- the PREVIOUS day's own overnight window had already claimed as its
-- check-out — the non-overnight branch already guards exactly this
-- (`not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end`),
-- but the overnight branch had no equivalent.
--
-- shift_window_for_date() deliberately anchors an overnight window's START
-- to Nepal midnight, not the scheduled start time (20260806120000, so an
-- early check-in isn't excluded). For a shift worked on consecutive days
-- (a "16 Hours Duty" roster, evening to next morning, every day), that
-- widened start means day N's window [N 00:00, N+1 start+duration+2h) fully
-- contains day N's own morning hours -- exactly where day N-1's overnight
-- check-out punch lands. With nothing excluding it, that single punch got
-- used TWICE: correctly as day N-1's check-out, and again as day N's
-- check-in (the earliest '0' punch in its window) -- min() picks the leftover
-- morning punch over day N's real evening one, which is simply later. Day N's
-- check-out then became day N+1's morning punch instead of day N's own,
-- chaining every day into a ~24h stretch (~8h "overtime") and burying the
-- real evening check-in entirely.
--
-- Confirmed against Angpasang Sherpa's real data (2f0e574..., N 16 Hours
-- Duty, 17:00-09:00): 4 Aug's saved check-in (09:43) was 3 Aug's own
-- check-out punch; 4 Aug's real 16:46 check-in was never used anywhere.
--
-- Fix: compute v_prev_window in the overnight branch too (already declared,
-- only ever populated in the non-overnight branch) and apply the same guard.
-- Otherwise identical to 20260911130000_correction_span_owns_its_punches.sql.

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
      -- The previous day's own window, overnight or not -- needed either way
      -- now, so it's computed once here instead of only in the else branch.
      select * into v_prev_window from shift_window_for_date(emp.id, d_main - 1);
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
          -- A punch yesterday's own overnight window already ends with is
          -- that day's check-out, not a fresh check-in for today -- without
          -- this, two consecutive overnight-duty days both claim it.
          and (not coalesce(v_prev_window.is_overnight, false) or punch_time >= v_prev_window.window_end)
          and punch_time is distinct from v_prev_tail
          and not punch_claimed_by_correction(emp.id, punch_time, d_main);
      else
        -- Exclude any punch already claimed by an overnight shift from
        -- YESTERDAY (a checkout just after midnight Kathmandu would otherwise
        -- also raw-date-match today and get mislabeled as today's stray
        -- check-in).
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
          and punch_time is distinct from v_prev_tail
          and not punch_claimed_by_correction(emp.id, punch_time, d_main);
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
  -- tap-out. Scans target_date and the day before. Not affected by the fix
  -- above: this only ever runs for a date with ZERO raw-dated punches of its
  -- own, so a punch it finds can only be dated the day after, never a
  -- leftover from the day before.
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
        and punch_time >= v_window.window_start and punch_time < v_window.window_end
        and not punch_claimed_by_correction(emp.id, punch_time, d_scan);

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
