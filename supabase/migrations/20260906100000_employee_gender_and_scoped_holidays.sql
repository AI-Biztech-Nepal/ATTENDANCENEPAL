-- Gender on the employee record + gender-scoped company holidays.
--
-- Nepal has holidays that apply to one gender only — Haritalika Teej, Rishi
-- Panchami and Jitiya are women-only paid days at most workplaces, while the
-- men work a normal day. The company-wide company_holidays row could not
-- express that: every holiday applied to everyone.
--
--   * employees.gender            -> 'male' | 'female' (nullable — an unset
--     gender gets company-wide holidays only, never a gender-scoped one).
--   * company_holidays.applies_to -> 'all' (default, = today's behaviour) |
--     'male' | 'female'. weekOffDatesInRange() in lib/weekOff.ts (mirrored
--     in mobile-app/src/lib/weekOff.ts) filters holidays by the employee's
--     gender before a punchless day is credited as a paid day off.
--
-- Both columns follow their tables' existing RLS unchanged (employees:
-- 20260805... ; company_holidays admin-write / company-read:
-- 20260812090000_company_week_off.sql).

alter table employees
  add column if not exists gender text;
alter table employees
  drop constraint if exists employees_gender_check;
alter table employees
  add constraint employees_gender_check check (gender in ('male', 'female'));

alter table company_holidays
  add column if not exists applies_to text not null default 'all'
    check (applies_to in ('all', 'male', 'female'));
