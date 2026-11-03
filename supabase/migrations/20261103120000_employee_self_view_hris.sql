-- Lets an employee READ their own HR file from the employee portal's My Profile:
-- documents, transfers / promotions / increments, appraisals, awards, conduct
-- records and the exit checklist / settlement. Read only — every write stays
-- admin / HR (the "admin or hr full access" policies from the migrations that
-- created these tables are untouched), and an employee never sees anyone else's
-- row. The owner chose this on 2026-11-03; before it these tables had no
-- employee-read policy on purpose.
--
-- Run once, in the Supabase SQL editor, after 20261101200000_employee_performance_conduct.sql.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Rows: the same "your own employee id" test employee_training already uses.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'employee_documents',
    'employee_history',
    'employee_separations',
    'employee_appraisals',
    'employee_awards',
    'employee_conduct_records'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || ': employee read own', t);
    execute format(
      'create policy %I on %I for select using (employee_id = (select employee_id from profiles where id = auth.uid()))',
      t || ': employee read own', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Files: <company id>/<employee id>/<random>.<ext>, so the second folder says
-- whose file it is. Signed links are still how the portal opens them.
-- ---------------------------------------------------------------------------

drop policy if exists "employee-documents: employee read own" on storage.objects;
create policy "employee-documents: employee read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = my_company_id()::text
    and (storage.foldername(name))[2] = (select employee_id::text from profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Who you report to. An employee can read only their own employees row, so the
-- manager's name comes through this, which returns nothing but the name.
-- ---------------------------------------------------------------------------

create or replace function my_reporting_manager()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.name
  from employees e
  join employees m on m.id = e.reporting_to
  where e.id = (select employee_id from profiles where id = auth.uid());
$$;

revoke execute on function my_reporting_manager() from public, anon;
grant execute on function my_reporting_manager() to authenticated;
