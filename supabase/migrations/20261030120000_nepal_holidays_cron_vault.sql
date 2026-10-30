-- Re-schedules sync-nepal-holidays-daily to read the project URL and service
-- role key from Supabase Vault. The original job
-- (20260823210000_nepal_public_holidays_cron.sql) read them from the
-- app.settings.supabase_url / app.settings.service_role_key database
-- settings, which were never set on this project, so every nightly run since
-- has failed with `unrecognized configuration parameter
-- "app.settings.supabase_url"` before reaching the function — and
-- nepal_public_holidays stopped refreshing after 2026-08-24.
--
-- Vault keeps the key encrypted and out of this (public) repo. The two
-- secrets are created once by hand in the SQL editor — see
-- supabase/functions/sync-nepal-holidays/README.md:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service role key>', 'service_role_key');
-- Until they exist the job still fails each night, as it does today; nothing
-- else depends on it, and the table keeps serving what it already has.
--
-- Same failure handling as the original: a problem here must not abort the
-- rest of a migration run.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'sync-nepal-holidays-daily';

  perform cron.schedule(
    'sync-nepal-holidays-daily',
    '15 23 * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/sync-nepal-holidays',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    $cron$
  );
exception
  when others then
    raise notice 'sync-nepal-holidays-daily reschedule failed (% — %); re-run this migration''s DO block by hand in the SQL editor.', sqlstate, sqlerrm;
end $$;
