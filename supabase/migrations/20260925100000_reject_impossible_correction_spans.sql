-- approve_attendance_correction() stored whatever check_in/check_out span it
-- was given, with no sanity check at all -- so a bad "Next day" checkbox
-- state (or any other bad input, from this dialog or the separate
-- Corrections page's employee-submitted requests, which land here too) could
-- silently save a physically impossible >24h single day, then LOCK it in via
-- manually_corrected = true, immune to every future compute_payroll_summaries()
-- recompute. Confirmed on real data: an employee's "kitchen 12:00-22:00"
-- (non-overnight) shift with total_hours of 33-34 on several different days,
-- all manually_corrected, surviving 30 Recalculate runs untouched -- because
-- Recalculate's own UPDATE explicitly skips manually_corrected rows by
-- design (a real correction is supposed to be authoritative), so nothing
-- short of this ever re-touched them.
--
-- No single calendar day can hold more than 24h of work -- a hard physical
-- ceiling, true for every shift regardless of its own scheduled hours, so
-- this is safe to enforce unconditionally rather than needing to know
-- anything about the shift itself.
--
-- The client (admin-web's saveCorrection()) now rejects this before ever
-- calling here, but this is the real chokepoint: it's also what the
-- Corrections page's approve flow runs (an employee's own submitted
-- request), which never goes through that dialog's validation at all.

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

  if req.requested_check_out is not null and req.requested_check_in is not null
     and req.requested_check_out - req.requested_check_in > interval '24 hours' then
    raise exception 'Check-out is more than 24 hours after check-in -- not possible for a single day.';
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

-- Data cleanup: no real single-day total_hours can exceed 24, so any row
-- that does is definitely corrupted, whether or not it's manually_corrected
-- -- unlocking just these lets the next Recalculate rebuild them from real
-- punches via the (already correctly day-scoped) compute_payroll_summaries().
-- Scoped to this exact impossibility, nothing broader: a legitimate
-- correction with a sane total is never touched by this.
update payroll_summaries
set manually_corrected = false
where total_hours > 24;
