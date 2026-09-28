-- The Payroll page's overtime-hours-per-day/multiplier inputs
-- (otHoursPerDay/otMultiplier, admin-web/app/payroll/page.tsx) were pure
-- ephemeral useState — never written anywhere, resetting to 8/1.5 on every
-- page load. my-payroll/page.tsx hardcoded the same 8/1.5 with a comment
-- claiming it matches "what an admin has changed those to", which could
-- never actually be true since the admin's value never persisted. Store it
-- per company instead, so an admin's chosen OT policy actually sticks and
-- an employee's own payroll page can read the real value.

alter table companies add column if not exists ot_hours_per_day numeric not null default 8;
alter table companies add column if not exists ot_multiplier numeric not null default 1.5;
