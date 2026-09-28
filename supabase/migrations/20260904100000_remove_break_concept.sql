-- Remove the "break punch" concept entirely — it was unused and impractical.
-- Undoes 20260820100000_break_punches.sql + 20260820110000_break_minutes_payroll.sql.
--
--   * companies.break_enabled        -> dropped (no more Start/End Break buttons)
--   * payroll_summaries.break_minutes -> dropped
--   * compute_payroll_summaries()     -> recreated without any break pairing
--
-- The attendance_logs / attendance_gps_requests punch_type CHECK constraints
-- are LEFT permissive ('0'..'3') so any historical '2'/'3' rows stay as inert
-- audit history — every calc path already ignores them. To purge them:
--   delete from attendance_logs where punch_type in ('2', '3');

alter table companies drop column if exists break_enabled;
alter table payroll_summaries drop column if exists break_minutes;

-- Same as 20260825150000_fix_compute_payroll_utc_date_bucketing.sql minus the
-- break-minute variables, both break-pairing loops, and break_minutes in the
-- upsert. The `punch_type not in ('2','3')` filters on the aggregates stay —
-- they keep a stray legacy break punch from being mistaken for a check-in.
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
begin
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

  return rows_written;
end;
$$ language plpgsql;
