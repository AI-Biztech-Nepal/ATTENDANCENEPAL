-- Attendance Report / Payroll / Salary Structure all run the same shape of
-- query: company_id = my_company_id() (from RLS) AND a date column BETWEEN
-- two bounds, with no employee_id filter (an "All Employees" report covers
-- everyone). Neither table had an index usable for that:
--
--   attendance_logs   only had (employee_id, punch_time)   -- idx_logs_employee_time
--   payroll_summaries only had the unique (employee_id, work_date) constraint
--
-- Both lead with employee_id, which this query never filters on, so Postgres
-- can't narrow with them and falls back to scanning the whole table (well,
-- the whole index, which is no better) filtered row-by-row. Both tables grow
-- forever and are shared across every company in the system — every punch
-- ever logged, every payroll day ever computed for every tenant — so this
-- got slower every day, for everyone, regardless of how small any single
-- company's own report range was.
--
-- Adding company_id as the leading column lets Postgres jump straight to
-- one company's slice before it even has to look at work_date/punch_time.
--
-- Plain CREATE INDEX (not CONCURRENTLY) to match every other index in this
-- codebase — briefly blocks writes to these two tables while it builds
-- (punches arriving from device bridges, nightly payroll compute), same
-- tradeoff already accepted for idx_logs_employee_time.
create index if not exists idx_attendance_logs_company_time
  on attendance_logs(company_id, punch_time);

create index if not exists idx_payroll_summaries_company_date
  on payroll_summaries(company_id, work_date);
