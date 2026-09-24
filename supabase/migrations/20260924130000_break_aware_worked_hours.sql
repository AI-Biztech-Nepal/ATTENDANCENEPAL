-- Worked hours excluding a break, for staff who punch out and back in for it
-- (e.g. Chiyapur's restaurant staff: check in ~7am, check out for a break,
-- check back in, check out at shift end -- 4 ordinary punches, not the
-- removed break-punch feature's dedicated Start/End Break types, undone in
-- 20260904100000_remove_break_concept.sql).
--
-- compute_payroll_summaries()/calc_payroll_fields() have always measured
-- total_hours as the plain span from the day's first check-in to its last
-- check-out (calc_payroll_fields' `total_minutes := round(extract(epoch from
-- (p_check_out - p_check_in)) / 60)`), which counts a mid-day break as worked
-- time -- and, since overtime is only what's left after subtracting the
-- shift's scheduled duration, either overpays the break as regular hours or,
-- if the shift's own span already includes the break, hides real overtime by
-- inflating total_hours enough that it never shows the shortfall.
--
-- Fix: sum every check-in/check-out PAIR in the day's punches instead of just
-- spanning first-to-last (sum_paired_minutes(), mirrored client-side by
-- pairedWorkedMinutes() in lib/shift.ts) -- so the gap between an ordinary
-- checkout and the next check-in is excluded, whatever caused it. For a day
-- with exactly one pair (the overwhelming common case) this is identical to
-- the old span, so no other company's numbers change.
--
-- Prefers pairing by real punch type (a '0' opens, a '1' closes it) whenever
-- the device reports at least one genuine '1'. Some terminals never do --
-- Chiyapur's logs every punch as '0', so there's no type signal at all -- in
-- which case sum_paired_minutes() falls back to pairing by chronological
-- POSITION instead: an EVEN punch count alternates IN/OUT/IN/OUT (one break
-- shows up as exactly two such pairs); an ODD count has an unmatched middle
-- punch with no way to tell whether it's a mis-tap or a break with no
-- recorded return, so that falls back further to the plain first-to-last
-- span, same as before this migration.
--
-- Also not trusted when a Week Off duty's checkout was rescued from the NEXT
-- calendar day (week_off_duty_checkout(), 20260911120000): that punch lies
-- outside this window's own punch list, so pairing can't account for it --
-- the plain span (check_out - check_in) is still correct there.
--
-- calc_payroll_fields gains a new p_total_minutes parameter (default null,
-- meaning "fall back to the plain span") rather than being able to derive
-- this itself -- it only ever sees the day's reduced check_in/check_out, not
-- the raw punch list. Postgres treats adding a parameter as a new overload,
-- not a replacement, so the old 4-argument version is dropped first;
-- approve_attendance_correction's unchanged 4-argument call (a manual
-- correction is inherently a single pair) then resolves to the new function
-- via that default, unaffected.

create or replace function sum_paired_minutes(p_times timestamptz[], p_types text[])
returns integer as $$
declare
  i integer;
  n integer;
  open_in timestamptz;
  total numeric := 0;
begin
  if p_times is null then
    return 0;
  end if;
  n := array_length(p_times, 1);

  if '1' = any(p_types) then
    -- A '0' with no open pair starts one; a '1' closes whatever's open and
    -- is otherwise ignored -- an unmatched extra check-in (forgot to punch
    -- out, then punched in again) simply never closes, rather than being
    -- paired with whatever comes next regardless of its type.
    for i in 1 .. n loop
      if p_types[i] = '0' then
        if open_in is null then
          open_in := p_times[i];
        end if;
      elsif p_types[i] = '1' and open_in is not null then
        total := total + extract(epoch from (p_times[i] - open_in)) / 60;
        open_in := null;
      end if;
    end loop;
    return round(total)::integer;
  end if;

  -- No usable type signal at all -- chronological position is all that's
  -- left. See this migration's header for the even/odd reasoning.
  if n % 2 <> 0 then
    return round(extract(epoch from (p_times[n] - p_times[1])) / 60)::integer;
  end if;
  for i in 1 .. n by 2 loop
    total := total + extract(epoch from (p_times[i + 1] - p_times[i])) / 60;
  end loop;
  return round(total)::integer;
end;
$$ language plpgsql stable;

drop function if exists calc_payroll_fields(uuid, timestamptz, timestamptz, date);

create or replace function calc_payroll_fields(
  emp_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_work_date date,
  p_total_minutes integer default null
)
returns table(
  shift_name text,
  total_hours numeric,
  is_late boolean,
  late_minutes integer,
  is_early_departure boolean,
  early_departure_minutes integer,
  overtime_hours numeric
) as $$
declare
  shift record;
  emp_exempt boolean;
  shift_start_min integer;
  shift_end_min integer;
  shift_duration_min integer;
  in_min_of_day integer;
  out_min_of_day integer;
  total_minutes integer := 0;
  late_minutes_v integer := 0;
  early_minutes_v integer := 0;
  overtime_minutes integer := 0;
  is_late_v boolean := false;
  is_early_v boolean := false;
begin
  select coalesce(attendance_exempt, false) into emp_exempt from employees where id = emp_id;
  select * into shift from find_employee_shift_for_date(emp_id, p_work_date);

  if shift.is_week_off then
    -- Nothing scheduled: never late/early. Any worked time is entirely
    -- overtime (0 scheduled hours to exceed).
    shift_duration_min := 0;
  else
    shift_start_min := extract(hour from shift.start_time)::integer * 60 + extract(minute from shift.start_time)::integer;
    shift_end_min := extract(hour from shift.end_time)::integer * 60 + extract(minute from shift.end_time)::integer;
    shift_duration_min := case when shift_end_min > shift_start_min
      then shift_end_min - shift_start_min
      else (24 * 60 - shift_start_min + shift_end_min)
    end;

    if p_check_in is not null and not emp_exempt then
      in_min_of_day := extract(hour from (p_check_in at time zone 'Asia/Kathmandu'))::integer * 60
        + extract(minute from (p_check_in at time zone 'Asia/Kathmandu'))::integer;
      is_late_v := in_min_of_day > (shift_start_min + shift.grace_minutes);
      late_minutes_v := case when is_late_v then in_min_of_day - shift_start_min else 0 end;
    end if;
  end if;

  if p_check_in is not null and p_check_out is not null then
    -- p_total_minutes (compute_payroll_summaries' pair-summed total, when it
    -- could compute one) wins over the plain span whenever it's given -- a
    -- break between two punch pairs is excluded there. NULL (a manual
    -- correction's single in/out, or a day pairing couldn't make sense of)
    -- falls back to the plain span, exactly as before.
    total_minutes := coalesce(p_total_minutes, round(extract(epoch from (p_check_out - p_check_in)) / 60));
    if not shift.is_week_off and not emp_exempt then
      out_min_of_day := extract(hour from (p_check_out at time zone 'Asia/Kathmandu'))::integer * 60
        + extract(minute from (p_check_out at time zone 'Asia/Kathmandu'))::integer;
      if out_min_of_day < shift_end_min then
        is_early_v := true;
        early_minutes_v := shift_end_min - out_min_of_day;
      end if;
    end if;
    if total_minutes > shift_duration_min then
      overtime_minutes := total_minutes - shift_duration_min;
    end if;
  end if;

  return query select
    shift.shift_name,
    round((total_minutes / 60.0)::numeric, 2),
    is_late_v,
    late_minutes_v,
    is_early_v,
    early_minutes_v,
    round((overtime_minutes / 60.0)::numeric, 2);
end;
$$ language plpgsql stable;

-- Identical to 20260924120000_overnight_window_excludes_prior_day.sql except:
--   - v_times/v_types/v_total_minutes declared;
--   - right after each branch's existing (unchanged) aggregate query, a
--     second query fetches the same window's punches as ordered arrays, using
--     the exact same WHERE predicate, for sum_paired_minutes() to pair up;
--   - v_total_minutes computed right after check_in/check_out, before the
--     Week Off duty tail-rescue -- and cleared back to null if that rescue
--     fires, since the rescued punch lies outside v_times;
--   - calc_payroll_fields() calls pass v_total_minutes as a 5th argument.
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
  v_times timestamptz[];
  v_types text[];
  v_total_minutes integer;
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
      -- Reset each iteration -- only ever set below when this day's own
      -- Week Off duty tail-rescue actually fires.
      v_tail := null;

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

        select array_agg(punch_time order by punch_time), array_agg(punch_type order by punch_time)
        into v_times, v_types
        from attendance_logs
        where employee_id = emp.id
          and punch_time >= v_window.window_start and punch_time < v_window.window_end
          and (not coalesce(v_prev_window.is_overnight, false) or punch_time >= v_prev_window.window_end)
          and punch_time is distinct from v_prev_tail
          and not punch_claimed_by_correction(emp.id, punch_time, d_main)
          and punch_type not in ('2', '3');
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

        select array_agg(punch_time order by punch_time), array_agg(punch_type order by punch_time)
        into v_times, v_types
        from attendance_logs
        where employee_id = emp.id and (punch_time at time zone 'Asia/Kathmandu')::date = d_main
          and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end)
          and punch_time is distinct from v_prev_tail
          and not punch_claimed_by_correction(emp.id, punch_time, d_main)
          and punch_type not in ('2', '3');
      end if;

      check_in := coalesce(v_first_in, v_first_any);
      check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
      if check_out = check_in then
        check_out := null;
      end if;

      -- Worked minutes actually earned between this window's own punches,
      -- paired up instead of spanned -- see sum_paired_minutes() (it falls
      -- back to positional pairing, then to the plain span, on its own when
      -- the punches don't carry a usable type).
      v_total_minutes := sum_paired_minutes(v_times, v_types);

      -- A Week Off duty that ran into the next morning: its check-out is the
      -- next day's first punch (week_off_duty_checkout() re-checks that this
      -- is a Week Off with a lone check-in).
      if check_in is not null and check_out is null then
        v_tail := week_off_duty_checkout(emp.id, d_main);
        if v_tail is not null then
          check_out := v_tail;
          -- That rescued punch lies outside v_times (it's from the next
          -- calendar day), so pairing can't account for it -- fall back to
          -- the plain span (check_out - check_in), exactly as before this
          -- migration.
          v_total_minutes := null;
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

      select * into fields from calc_payroll_fields(emp.id, check_in, check_out, d_main, v_total_minutes);

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
  -- tap-out. Scans target_date and the day before. Not affected by the
  -- earlier fix in this loop: this only ever runs for a date with ZERO
  -- raw-dated punches of its own, so a punch it finds can only be dated the
  -- day after, never a leftover from the day before. No Week Off duty tail
  -- concept here either (this IS the rescue for that scenario's own date).
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

      select array_agg(punch_time order by punch_time), array_agg(punch_type order by punch_time)
      into v_times, v_types
      from attendance_logs
      where employee_id = emp.id
        and punch_time >= v_window.window_start and punch_time < v_window.window_end
        and not punch_claimed_by_correction(emp.id, punch_time, d_scan)
        and punch_type not in ('2', '3');

      check_in := coalesce(v_first_in, v_first_any);
      check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
      if check_out = check_in then
        check_out := null;
      end if;
      if check_in is null then
        continue;
      end if;

      v_total_minutes := sum_paired_minutes(v_times, v_types);

      select * into fields from calc_payroll_fields(emp.id, check_in, check_out, d_scan, v_total_minutes);

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
