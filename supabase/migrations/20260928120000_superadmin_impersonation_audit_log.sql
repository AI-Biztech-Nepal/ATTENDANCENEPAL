-- Audit trail for superadmin "View their account" (real login-as
-- impersonation, POST /api/superadmin/companies/[id]/impersonate): a real
-- session as one of that company's own admin/hr logins, with full read-write
-- power over their data — exactly like /api/superadmin/companies/[id]'s
-- suspend/delete actions, this needs its own record independent of
-- whatever the tenant's own activity logging shows, since the session that
-- results is indistinguishable, from the tenant's data's point of view, from
-- that admin signing in themselves.
--
-- Written by the API route BEFORE calling generateLink() — a crash or
-- failure between the two still leaves a record that authority was granted,
-- rather than only logging successes.
--
-- company_id is ON DELETE SET NULL (not restrict): superadmin_delete_company()
-- (20260827100000) must stay able to hard-delete a company with prior
-- impersonation history — company_name is stored alongside as a snapshot so
-- the row stays meaningful once the company itself is gone. target_user_id
-- has no FK for the same reason (that profiles/auth.users row may also be
-- gone by then); target_email/target_role are the durable record of who was
-- viewed as.
--
-- RLS enabled with zero policies: this denies every anon/authenticated
-- request outright. Only the service-role client can read or write it,
-- which is a deliberate second gate on top of requireSuperadmin()'s
-- SUPERADMIN_EMAILS allowlist check on every /api/superadmin/* route — never
-- a tenant, never a plain authenticated user, not even a superadmin over a
-- direct (non-service-role) client, can read who's been impersonated.

create table if not exists superadmin_impersonation_log (
  id uuid primary key default gen_random_uuid(),
  superadmin_email text not null,
  company_id uuid references companies(id) on delete set null,
  company_name text not null,
  target_user_id uuid,
  target_email text not null,
  target_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_superadmin_impersonation_log_company
  on superadmin_impersonation_log(company_id, created_at desc);

alter table superadmin_impersonation_log enable row level security;
