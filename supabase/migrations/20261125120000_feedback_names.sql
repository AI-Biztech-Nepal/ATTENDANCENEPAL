-- Feedback is no longer anonymous: the name of who it came from is shown.
--
--   * Customer feedback: the guest's NAME is shown with each form, to the admin / HR and to the employee the form is about, so
--     they can keep track of their customers. The guest's phone and email stay admin / HR only (customer_feedback_guests has
--     no employee policy, and this function hands over the name alone).
--   * Colleague feedback: the NAME of the colleague who gave it is shown, to the person it is about and to admin / HR. This
--     applies to feedback already given too (the giver was always stored, see 20261123140000_colleague_feedback.sql).
--
-- Both are read-only functions that return just the name for the rows asked for, and only for rows the caller may see: an
-- admin / HR of the same company, or the employee the form / feedback is about. Nothing else changes.
--
-- Run once, in the Supabase SQL editor, after 20261123140000_colleague_feedback.sql and
-- 20261124120000_customer_feedback_guest_details.sql. Re-runnable.

-- The guest's name on each of some customer forms. A form with no guest on file is left out.
create or replace function customer_feedback_guest_names(p_ids uuid[])
returns table (feedback_id uuid, guest_name text)
language sql
stable
security definer
set search_path = public
as $$
  select g.feedback_id, g.guest_name
  from customer_feedback_guests g
  join customer_feedback f on f.id = g.feedback_id
  where g.feedback_id = any(p_ids)
    and (
      f.employee_id = (select employee_id from profiles where id = auth.uid())
      or (is_admin_or_hr() and f.company_id = my_company_id())
    );
$$;

-- Who gave each of some pieces of colleague feedback: their employee name, or for an admin / HR account that is not linked to
-- an employee, the account's name. Null when the giver's account or record has since been removed.
create or replace function colleague_feedback_givers(p_ids uuid[])
returns table (id uuid, giver_name text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, coalesce(e.name, nullif(btrim(p.full_name), ''))
  from colleague_feedback f
  left join employees e on e.id = f.reviewer_employee
  left join profiles p on p.id = f.reviewer_user
  where f.id = any(p_ids)
    and (
      f.subject_id = (select employee_id from profiles where id = auth.uid())
      or (is_admin_or_hr() and f.company_id = my_company_id())
    );
$$;

revoke all on function customer_feedback_guest_names(uuid[]) from public, anon;
revoke all on function colleague_feedback_givers(uuid[]) from public, anon;
grant execute on function customer_feedback_guest_names(uuid[]) to authenticated;
grant execute on function colleague_feedback_givers(uuid[]) to authenticated;
