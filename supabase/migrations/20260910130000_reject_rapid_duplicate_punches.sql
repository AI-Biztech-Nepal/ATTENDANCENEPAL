-- Two attendance punches seconds apart — the fingerprint scanner double-
-- firing, or a stray opposite-type tap right after someone arrives — get
-- read as a check-in and an instant check-out: the day collapses to 0 hours
-- worked and a huge "early departure", and the month's salary is docked for
-- a day the person actually worked (e.g. Ranjit, check-in 10:20 / check-out
-- 10:20).
--
-- Rule: after a punch is recorded for an employee, any further punch within
-- 15 minutes of it is a mis-tap and is discarded. Two parts:
--
--  1. A BEFORE INSERT trigger drops such a punch as it arrives (RETURN NULL
--     skips just that row, so the batch the device pushes still lands).
--  2. A one-time cleanup applies the same rule to punches already on record,
--     keeping the first of each cluster (the window resets to each punch
--     that survives, exactly like the trigger). ~900 follower rows go.
--
-- payroll_summaries already computed from the old rows are NOT recomputed
-- here — run "Recalculate month" on the Payroll page for the affected
-- months afterward. Mirrors dedupePunches() in admin-web / mobile-app
-- lib/shift.ts (the live/report side).

-- ── 1. Trigger: reject rapid duplicates on the way in ──────────────────────
create or replace function reject_rapid_duplicate_punch()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from attendance_logs al
    where al.employee_id = new.employee_id
      and al.punch_time <> new.punch_time
      and abs(extract(epoch from (new.punch_time - al.punch_time))) < 15 * 60
  ) then
    return null;  -- discard the mis-tap, without failing the insert batch
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_rapid_duplicate_punch on attendance_logs;
create trigger trg_reject_rapid_duplicate_punch
  before insert on attendance_logs
  for each row execute function reject_rapid_duplicate_punch();

-- ── 2. One-time cleanup of existing near-duplicate punches ─────────────────
-- Walk each employee's punches in time order; keep a punch only when it is
-- >= 15 minutes after the last KEPT one (anchor advances only on a keep).
with recursive ordered as (
  select id, employee_id, punch_time,
         row_number() over (partition by employee_id order by punch_time, id) as rn
  from attendance_logs
),
walk as (
  select id, employee_id, punch_time, rn, punch_time as anchor, true as keep
  from ordered
  where rn = 1
  union all
  select o.id, o.employee_id, o.punch_time, o.rn,
         case when o.punch_time - w.anchor >= interval '15 minutes' then o.punch_time else w.anchor end,
         (o.punch_time - w.anchor >= interval '15 minutes')
  from ordered o
  join walk w on w.employee_id = o.employee_id and o.rn = w.rn + 1
)
delete from attendance_logs
where id in (select id from walk where keep = false);
