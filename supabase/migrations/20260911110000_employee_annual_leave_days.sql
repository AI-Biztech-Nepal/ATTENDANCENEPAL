-- Each employee's own yearly paid-leave allowance, set by an admin on the
-- Leave page's "Leave Balance" tab.
--
-- Null means "use the company default" (companies.paid_leave_days_per_year,
-- 20260911100000_company_paid_leave_balance.sql), so only employees who get a
-- different number need one. Read by admin-web/lib/leaveBalance.ts, which
-- works the balance out from attendance — nothing else is stored.
--
-- The existing "employees: admin or hr full access" policy already covers the
-- update.

alter table employees
  add column if not exists annual_leave_days numeric
    check (annual_leave_days is null or (annual_leave_days >= 0 and annual_leave_days <= 366));
