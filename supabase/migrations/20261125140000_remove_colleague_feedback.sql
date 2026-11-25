-- Removing a piece of colleague feedback.
--
-- Since 20261125120000_feedback_names.sql a piece of feedback shows who gave it, so one rude or mistaken comment can cause
-- trouble. Two people may now remove one:
--   * the colleague who GAVE it, to take it back (their own feedback only);
--   * an admin / HR of the same company, to remove anyone's, EXCEPT feedback about themselves (so nobody can clear away what
--     was said about them).
-- The person the feedback is about cannot remove it. Removing deletes it for good: it leaves the report and the KPIs at once,
-- and the giver may give that colleague feedback again the same month.
--
-- colleague_feedback still has no write policy: nobody deletes from the table directly, only through this function, which
-- checks who is asking.
--
-- Run once, in the Supabase SQL editor, after 20261123140000_colleague_feedback.sql. Re-runnable.

create or replace function remove_colleague_feedback(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me uuid;
  co uuid;
  f record;
begin
  if uid is null then
    raise exception 'Sign in to remove feedback';
  end if;
  select employee_id, company_id into me, co from profiles where id = uid;
  select id, company_id, subject_id, reviewer_user into f from colleague_feedback where id = p_id;
  if not found or co is null or f.company_id is distinct from co then
    raise exception 'That feedback was not found';
  end if;

  -- The giver takes their own back.
  if f.reviewer_user = uid then
    delete from colleague_feedback where id = p_id;
    return;
  end if;

  if not is_admin_or_hr() then
    raise exception 'Only the person who gave it, or an admin or HR, can remove this feedback';
  end if;
  if me is not null and f.subject_id = me then
    raise exception 'You cannot remove feedback about yourself';
  end if;
  delete from colleague_feedback where id = p_id;
end;
$$;

revoke all on function remove_colleague_feedback(uuid) from public, anon;
grant execute on function remove_colleague_feedback(uuid) to authenticated;
