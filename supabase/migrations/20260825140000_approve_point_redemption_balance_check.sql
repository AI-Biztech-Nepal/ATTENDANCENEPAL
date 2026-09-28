-- reviewRedemption() (admin-web/app/tasks/page.tsx) approved point
-- redemptions with a plain UPDATE, no check that the employee's current
-- balance (sum of approved task points minus already-approved redemptions —
-- the same formula get_leaderboard() uses) actually covers the amount being
-- redeemed. Two pending requests together exceeding a balance, or a balance
-- dropping between request and review, could both be approved anyway,
-- driving the balance negative with nothing in the UI ever surfacing it.
-- This RPC re-checks the balance atomically at approval time; rejecting
-- still needs no such check, since it never spends points.

create or replace function approve_point_redemption(p_redemption_id uuid)
returns void as $$
declare
  req record;
  reviewer uuid := auth.uid();
  v_balance bigint;
begin
  if not is_admin_or_hr() then
    raise exception 'Not authorized';
  end if;

  select * into req from point_redemptions
  where id = p_redemption_id and status = 'pending' and company_id = my_company_id();
  if not found then
    raise exception 'Redemption request not found or already reviewed';
  end if;

  select
    coalesce(sum(t.points) filter (where t.status = 'approved'), 0)
      - coalesce((select sum(pr.points_requested) from point_redemptions pr
                  where pr.employee_id = req.employee_id and pr.status = 'approved'), 0)
  into v_balance
  from tasks t
  where t.assigned_to = req.employee_id;

  if req.points_requested > v_balance then
    raise exception 'Cannot approve — this employee''s current balance (% points) is less than the % points requested.', v_balance, req.points_requested;
  end if;

  update point_redemptions
  set status = 'approved', reviewed_by = reviewer, reviewed_at = now()
  where id = p_redemption_id;
end;
$$ language plpgsql security definer set search_path = public;
