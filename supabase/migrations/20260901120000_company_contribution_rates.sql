-- PF / SSF / TDS were per-employee rates (employees.pf_rate/ssf_rate/tds_rate,
-- 20260813120000_employee_salary_structure.sql), editable only on the employee
-- detail page. In practice a company runs one PF %, one SSF %, one TDS % for
-- everyone, and there was no single place to see or set the salary structure.
-- Move the three rates to the company level: the new Salary Structure page
-- (admin-web/app/salary-structure) edits them once, and every payroll surface
-- (Payroll report, My Payroll web + mobile) reads them from here.
--
-- Defaults match the previous per-employee column defaults (the common Nepal
-- statutory figures). No RLS changes needed — new columns follow companies'
-- existing policies (companies: read own / admin update own,
-- 20260814180000_companies_rls_policies.sql), same as the OT settings in
-- 20260825160000_company_overtime_settings.sql.
--
-- The old employees.pf_rate/ssf_rate/tds_rate columns are left in place
-- (unread) rather than dropped here — a later cleanup migration can remove them.

alter table companies add column if not exists pf_rate  numeric not null default 10;
alter table companies add column if not exists ssf_rate numeric not null default 11;
alter table companies add column if not exists tds_rate numeric not null default 0;
