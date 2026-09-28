-- A simple Overtime line for the Salary Structure page, added on top of Net
-- Payable, using the exact same "% of Basic" pattern as PF/SSF/TDS —
-- company-wide, editable the same way. This is a distinct, simpler figure
-- from the real attendance-based overtime pay the Payroll report and this
-- employee's own Salary Structure detail page already compute from
-- ot_hours_per_day/ot_multiplier (20260825160000) — the two numbers are
-- intentionally unrelated, this one is a flat allowance, not hours worked.
alter table companies add column if not exists overtime_rate numeric not null default 0;
