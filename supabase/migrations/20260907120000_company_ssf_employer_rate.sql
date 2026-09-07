-- Employer SSF contribution rate (% of Basic) as company config.
--
-- companies.ssf_rate already holds the EMPLOYEE SSF rate (default 11, edited
-- on the Salary Structure page). The Staff Salary Sheet customer also grosses
-- up by the EMPLOYER contribution (statutory 20% of Basic), and wants that
-- percentage editable too — so it moves from a hard-coded 0.20 in
-- components/StaffSalarySheet.tsx to here.
--
-- Only the Staff Salary Sheet reads this column; every other company ignores
-- it. Follows companies' existing RLS unchanged.

alter table companies
  add column if not exists ssf_employer_rate numeric not null default 20;
