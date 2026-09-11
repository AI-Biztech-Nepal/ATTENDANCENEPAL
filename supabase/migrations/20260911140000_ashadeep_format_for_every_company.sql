-- ASHADEEP FOUNDATION's finalised format, for every company -- existing and
-- new.
--
-- Two company settings were ASHADEEP-only; every other feature (Leave page
-- and balance, corrections, attendance rules, the shared print layouts) is
-- already the same code for all tenants:
--
--   payroll_format = 'staff_salary_sheet'
--     The Payroll Report page renders the Staff Salary Sheet (Basic earned to
--     yesterday per day present, Allowance, SSF by Employer / Employee
--     gross-up, Net) with its landscape print / PDF / Excel layout, instead
--     of the hourly standard report. An employee's own My Payroll page pays
--     per day to match.
--
--   week_off_work_earns_leave = true
--     Week Off work earns leave by the hours (8h = 1 day) instead of
--     overtime, and a Week Off duty is measured to its next-morning check-out
--     (20260911120000). With no Yearly Leave set for anyone, absences stay
--     unpaid exactly as before; the Paid Leave switch in the payroll report's
--     cog turns the leave effect off for that report.
--
-- Each company's own contribution rates (pf_rate / ssf_rate / tds_rate) and
-- overtime settings are left as they are -- they are that company's figures,
-- set on its Salary Structure page.
--
-- New companies are created with only a name (handle_new_user()), so the
-- column defaults below are what gives them this format from the start.
--
-- To put one company back:
--   update companies set payroll_format = 'standard', week_off_work_earns_leave = false
--   where id = '<company id>';

alter table companies alter column payroll_format set default 'staff_salary_sheet';
alter table companies alter column week_off_work_earns_leave set default true;

update companies set payroll_format = 'staff_salary_sheet' where payroll_format <> 'staff_salary_sheet';
update companies set week_off_work_earns_leave = true where not week_off_work_earns_leave;
