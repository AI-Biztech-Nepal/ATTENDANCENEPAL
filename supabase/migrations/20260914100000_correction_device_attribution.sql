-- The Attendance Report's correction dialog only ever edited times. A day an
-- admin adds or corrects by hand has no real punch to read a device off of,
-- so its Device column falls back to "—"/"N/A" forever. Let the admin also
-- pick which device the entry should be attributed to, from the devices that
-- have actually logged a punch (not every paired device — one that's never
-- synced a log shouldn't clutter the picker).

alter table payroll_summaries add column if not exists device_id uuid references devices(id) on delete set null;
alter table attendance_correction_requests add column if not exists device_id uuid references devices(id) on delete set null;

-- Invoker-rights (no security definer): runs under the calling admin's own
-- RLS, same as a plain `select * from devices` would, so it only ever
-- returns devices the caller's company policies already let them see.
create or replace function devices_with_punches()
returns setof devices
language sql
stable
as $$
  select d.*
  from devices d
  where exists (select 1 from attendance_logs l where l.device_id = d.id)
  order by d.name;
$$;

-- Same as before, plus carrying the request's device_id (if any) onto the
-- payroll_summaries row it upserts.
create or replace function approve_attendance_correction(p_request_id uuid)
returns void as $$
declare
  req record;
  fields record;
  reviewer uuid := auth.uid();
begin
  select * into req from attendance_correction_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'Correction request not found or already reviewed';
  end if;

  select * into fields from calc_payroll_fields(req.employee_id, req.requested_check_in, req.requested_check_out, req.work_date);

  insert into payroll_summaries (
    employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
    is_late, late_minutes, is_early_departure, early_departure_minutes,
    overtime_hours, manually_corrected, device_id, computed_at
  ) values (
    req.employee_id, req.company_id, req.work_date, fields.shift_name, req.requested_check_in, req.requested_check_out,
    fields.total_hours, fields.is_late, fields.late_minutes, fields.is_early_departure,
    fields.early_departure_minutes, fields.overtime_hours, true, req.device_id, now()
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
    manually_corrected = true,
    device_id = excluded.device_id,
    computed_at = excluded.computed_at;

  update attendance_correction_requests
  set status = 'approved', reviewed_by = reviewer, reviewed_at = now()
  where id = p_request_id;
end;
$$ language plpgsql;
