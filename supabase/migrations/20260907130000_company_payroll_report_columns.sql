-- Which optional columns the monthly Payroll report shows.
--
-- Used to be a per-view toggle (the cog menu in the Payroll report header),
-- so it reset on every reload and every admin saw their own thing. It now
-- lives on the Salary Structure page next to the PF/SSF/Overtime rates —
-- one company-wide choice, persisted here, that the Payroll report simply
-- reads. Toggling a switch there shows/hides that column (and, for
-- Overtime, its pay) from the report and its printed / PDF copy for
-- everyone.
--
-- Keys mirror the report's `visibleCols`: workedDays, totalHours, overtime,
-- lateEarly, deductions. A missing key falls back to true (shown), so older
-- rows and any future column default to visible.
--
-- Follows companies' existing RLS unchanged (read own / admin update own,
-- 20260814180000_companies_rls_policies.sql), same as every other payroll
-- setting on that page.

alter table companies
  add column if not exists payroll_report_columns jsonb not null
  default '{"workedDays": true, "totalHours": true, "overtime": true, "lateEarly": true, "deductions": true}'::jsonb;
