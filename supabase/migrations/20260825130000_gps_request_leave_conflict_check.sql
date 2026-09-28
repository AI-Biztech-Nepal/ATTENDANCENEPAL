-- approve_attendance_gps_request() inserted into attendance_logs and then
-- unconditionally marked the request 'approved', even though
-- block_attendance_on_leave() (20260805190000) silently drops that exact
-- insert (RETURN NULL, by design, so zkteco-bridge's sync doesn't fail) when
-- the employee has approved leave covering that date. The admin reviewing
-- corrections/page.tsx saw the request flip to "Approved" with no error,
-- while no attendance record was actually created — the UI's claim and the
-- database's actual state disagreed. Check the actual row count after the
-- insert and raise instead of silently proceeding, so the admin sees why
-- and the request stays 'pending' rather than lying about having succeeded.

create or replace function approve_attendance_gps_request(p_request_id uuid)
returns void as $$
declare
  req record;
  reviewer uuid := auth.uid();
  v_inserted integer;
begin
  if not is_admin_or_hr() then
    raise exception 'Not authorized';
  end if;

  select * into req from attendance_gps_requests
  where id = p_request_id and status = 'pending' and company_id = my_company_id();
  if not found then
    raise exception 'GPS request not found or already reviewed';
  end if;

  insert into attendance_logs (employee_id, punch_time, punch_type, method, lat, lng, accuracy_m)
  values (req.employee_id, req.punch_time, req.punch_type, 'gps', req.lat, req.lng, req.accuracy_m);
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'Could not create the attendance record — this employee has approved leave covering that date.';
  end if;

  update attendance_gps_requests
  set status = 'approved', reviewed_by = reviewer, reviewed_at = now()
  where id = p_request_id;
end;
$$ language plpgsql security definer set search_path = public;
