-- Cleanup for 20260901120000_company_contribution_rates.sql: PF / SSF / TDS
-- rates are company-wide now (companies.pf_rate/ssf_rate/tds_rate, set on the
-- Salary Structure page). The per-employee columns added in
-- 20260813120000_employee_salary_structure.sql are no longer read by any code
-- (admin-web + mobile both switched to the company rate), so drop them.
--
-- `allowance` on employees stays — it's still genuinely per-employee.
-- No views, functions or RLS policies reference these columns.

alter table employees drop column if exists pf_rate;
alter table employees drop column if exists ssf_rate;
alter table employees drop column if exists tds_rate;
