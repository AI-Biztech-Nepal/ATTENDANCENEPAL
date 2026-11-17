-- Lets an employee EDIT the parts of their own HR file that are information
-- about themselves, from the employee portal's My Profile. The records that are
-- HR's judgement stay HR-only: appraisals, awards, conduct records, transfer /
-- promotion / pay history, the exit checklist and every settlement amount.
--
--   * personal details, contact & address, family      -> update_my_hr_profile()
--   * training & certification                          -> own rows, direct
--   * documents                                         -> upload; remove only what
--                                                          they uploaded themselves
--   * resignation                                       -> submit_my_resignation() /
--                                                          withdraw_my_resignation()
--
-- What an employee adds is marked, so HR can tell it from what HR filed:
-- employee_documents.uploaded_by_employee and employee_separations.requested_by_employee.
--
-- Run once, in the Supabase SQL editor, after 20261103120000_employee_self_view_hris.sql.
-- Safe to run again.

alter table employee_documents add column if not exists uploaded_by_employee boolean not null default false;
alter table employee_separations add column if not exists requested_by_employee boolean not null default false;

-- ---------------------------------------------------------------------------
-- Documents: add your own, and take back only what you added.
-- ---------------------------------------------------------------------------

drop policy if exists "employee_documents: employee add own" on employee_documents;
create policy "employee_documents: employee add own" on employee_documents
  for insert
  with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and uploaded_by_employee
  );

drop policy if exists "employee_documents: employee remove own upload" on employee_documents;
create policy "employee_documents: employee remove own upload" on employee_documents
  for delete
  using (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and uploaded_by_employee
  );

drop policy if exists "employee-documents: employee upload own" on storage.objects;
create policy "employee-documents: employee upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = my_company_id()::text
    and (storage.foldername(name))[2] = (select employee_id::text from profiles where id = auth.uid())
  );

-- A file may be deleted only while its own row says the employee uploaded it, so
-- HR's files (a warning letter, an appraisal) can't be removed from storage.
drop policy if exists "employee-documents: employee delete own upload" on storage.objects;
create policy "employee-documents: employee delete own upload" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[2] = (select employee_id::text from profiles where id = auth.uid())
    and exists (
      select 1 from employee_documents d
      where d.file_path = name
        and d.uploaded_by_employee
        and d.employee_id = (select employee_id from profiles where id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Training & certification is self-reported: manage your own rows.
-- ---------------------------------------------------------------------------

drop policy if exists "employee_training: employee manage own" on employee_training;
create policy "employee_training: employee manage own" on employee_training
  for all
  using (employee_id = (select employee_id from profiles where id = auth.uid()))
  with check (employee_id = (select employee_id from profiles where id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Personal details, contact & address, family. A narrow function rather than an
-- UPDATE policy, so an employee can never reach salary, branch, employment terms
-- and so on. Only the keys present in p_values are touched; an empty string clears
-- a field. Anything not on the list below is ignored.
-- ---------------------------------------------------------------------------

create or replace function update_my_hr_profile(p_values jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  emp_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  if emp_id is null then
    raise exception 'No employee linked to this account';
  end if;

  update employees set
    gender                      = case when p_values ? 'gender'                      then nullif(btrim(p_values->>'gender'), '')                      else gender end,
    date_of_birth               = case when p_values ? 'date_of_birth'               then nullif(btrim(p_values->>'date_of_birth'), '')::date         else date_of_birth end,
    nationality                 = case when p_values ? 'nationality'                 then nullif(btrim(p_values->>'nationality'), '')                 else nationality end,
    marital_status              = case when p_values ? 'marital_status'              then nullif(btrim(p_values->>'marital_status'), '')              else marital_status end,
    blood_group                 = case when p_values ? 'blood_group'                 then nullif(btrim(p_values->>'blood_group'), '')                 else blood_group end,
    citizenship_no              = case when p_values ? 'citizenship_no'              then nullif(btrim(p_values->>'citizenship_no'), '')              else citizenship_no end,
    citizenship_issued_district = case when p_values ? 'citizenship_issued_district' then nullif(btrim(p_values->>'citizenship_issued_district'), '') else citizenship_issued_district end,
    citizenship_issue_date      = case when p_values ? 'citizenship_issue_date'      then nullif(btrim(p_values->>'citizenship_issue_date'), '')::date else citizenship_issue_date end,
    personal_email              = case when p_values ? 'personal_email'              then nullif(btrim(p_values->>'personal_email'), '')              else personal_email end,
    permanent_province          = case when p_values ? 'permanent_province'          then nullif(btrim(p_values->>'permanent_province'), '')          else permanent_province end,
    permanent_district          = case when p_values ? 'permanent_district'          then nullif(btrim(p_values->>'permanent_district'), '')          else permanent_district end,
    permanent_municipality      = case when p_values ? 'permanent_municipality'      then nullif(btrim(p_values->>'permanent_municipality'), '')      else permanent_municipality end,
    permanent_ward              = case when p_values ? 'permanent_ward'              then nullif(btrim(p_values->>'permanent_ward'), '')              else permanent_ward end,
    permanent_tole              = case when p_values ? 'permanent_tole'              then nullif(btrim(p_values->>'permanent_tole'), '')              else permanent_tole end,
    temporary_province          = case when p_values ? 'temporary_province'          then nullif(btrim(p_values->>'temporary_province'), '')          else temporary_province end,
    temporary_district          = case when p_values ? 'temporary_district'          then nullif(btrim(p_values->>'temporary_district'), '')          else temporary_district end,
    temporary_municipality      = case when p_values ? 'temporary_municipality'      then nullif(btrim(p_values->>'temporary_municipality'), '')      else temporary_municipality end,
    temporary_ward              = case when p_values ? 'temporary_ward'              then nullif(btrim(p_values->>'temporary_ward'), '')              else temporary_ward end,
    temporary_tole              = case when p_values ? 'temporary_tole'              then nullif(btrim(p_values->>'temporary_tole'), '')              else temporary_tole end,
    emergency_contact_address   = case when p_values ? 'emergency_contact_address'   then nullif(btrim(p_values->>'emergency_contact_address'), '')   else emergency_contact_address end,
    father_name                 = case when p_values ? 'father_name'                 then nullif(btrim(p_values->>'father_name'), '')                 else father_name end,
    mother_name                 = case when p_values ? 'mother_name'                 then nullif(btrim(p_values->>'mother_name'), '')                 else mother_name end,
    grandfather_name            = case when p_values ? 'grandfather_name'            then nullif(btrim(p_values->>'grandfather_name'), '')            else grandfather_name end,
    spouse_name                 = case when p_values ? 'spouse_name'                 then nullif(btrim(p_values->>'spouse_name'), '')                 else spouse_name end
  where id = emp_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resignation. The employee can hand it in, change it and withdraw it — but only
-- until HR starts working on it (a checklist item ticked, a notice period set, a
-- settlement figure entered). After that it is HR's record, and the employee sees
-- it read-only. Everything else on the row (checklist, settlement) is never
-- reachable from here.
-- ---------------------------------------------------------------------------

create or replace function separation_is_untouched(s employee_separations)
returns boolean
language sql
immutable
as $$
  select s.exit_interview_status = 'pending'
     and s.clearance_status = 'pending'
     and s.uniform_id_status = 'pending'
     and s.asset_keys_status = 'pending'
     and s.asset_equipment_status = 'pending'
     and s.asset_device_status = 'pending'
     and s.asset_other_status = 'pending'
     and s.experience_letter_status = 'pending'
     and s.settlement_status = 'pending'
     and s.notice_required_days is null
     and s.final_salary = 0 and s.leave_encashment = 0 and s.incentive_settlement = 0
     and s.other_payments = 0 and s.outstanding_advances = 0 and s.other_deductions = 0;
$$;

create or replace function submit_my_resignation(p_submitted_on date, p_last_working_on date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  emp_id uuid;
  existing employee_separations%rowtype;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  if emp_id is null then
    raise exception 'No employee linked to this account';
  end if;
  if p_submitted_on is null or p_last_working_on is null then
    raise exception 'Give the date you are handing it in and your last working day';
  end if;
  if p_last_working_on < p_submitted_on then
    raise exception 'Your last working day cannot be before the day you hand it in';
  end if;

  select * into existing from employee_separations where employee_id = emp_id;
  if found then
    if not existing.requested_by_employee then
      raise exception 'HR has already started your exit. Contact HR to change it.';
    end if;
    if not separation_is_untouched(existing) then
      raise exception 'HR has started processing your resignation. Contact HR to change it.';
    end if;
    update employee_separations
    set resignation_submitted_on = p_submitted_on,
        resignation_effective_on = p_last_working_on,
        last_working_on = p_last_working_on,
        separation_reason = nullif(btrim(p_reason), '')
    where employee_id = emp_id;
  else
    insert into employee_separations
      (employee_id, separation_type, resignation_submitted_on, resignation_effective_on, last_working_on, separation_reason, requested_by_employee)
    values
      (emp_id, 'resignation', p_submitted_on, p_last_working_on, p_last_working_on, nullif(btrim(p_reason), ''), true);
  end if;
end;
$$;

create or replace function withdraw_my_resignation()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  emp_id uuid;
  removed integer;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  if emp_id is null then
    raise exception 'No employee linked to this account';
  end if;
  delete from employee_separations
  where employee_id = emp_id
    and requested_by_employee
    and separation_is_untouched(employee_separations);
  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'There is nothing to withdraw, or HR has already started processing it. Contact HR.';
  end if;
end;
$$;

revoke execute on function update_my_hr_profile(jsonb) from public, anon;
revoke execute on function submit_my_resignation(date, date, text) from public, anon;
revoke execute on function withdraw_my_resignation() from public, anon;
grant execute on function update_my_hr_profile(jsonb) to authenticated;
grant execute on function submit_my_resignation(date, date, text) to authenticated;
grant execute on function withdraw_my_resignation() to authenticated;
