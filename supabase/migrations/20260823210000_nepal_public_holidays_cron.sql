-- Schedules sync-nepal-holidays (supabase/functions/sync-nepal-holidays) to
-- run daily at 23:15 UTC = 05:00 Asia/Kathmandu (Nepal is a fixed UTC+5:45
-- offset, no DST), via Supabase's standard pg_cron + pg_net pattern for
-- calling an Edge Function on a schedule. Split into its own migration file
-- (not part of 20260823200000_nepal_public_holidays.sql, which creates the
-- table/seed this reads into) specifically so a failure here — pg_cron or
-- pg_net not being enabled on this project, or the app.settings.* GUCs
-- those docs assume not actually being populated here — can't roll back
-- that other file's table creation along with it. Everything below is
-- wrapped in its own exception handler for the same reason: this should
-- degrade to "the daily scrape isn't scheduled yet, seed data keeps
-- serving" on failure, never to "the whole migration silently didn't run."
--
-- This only starts actually doing anything once sync-nepal-holidays itself
-- is deployed (a one-time manual step needing real Supabase CLI credentials
-- — see supabase/functions/sync-nepal-holidays/README.md); until then this
-- job fires on schedule and gets a harmless 404 each time.
do $$
begin
  create extension if not exists pg_cron with schema extensions;
  create extension if not exists pg_net with schema extensions;

  perform cron.unschedule(jobid) from cron.job where jobname = 'sync-nepal-holidays-daily';

  perform cron.schedule(
    'sync-nepal-holidays-daily',
    '15 23 * * *',
    $cron$
    select net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-nepal-holidays',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
exception
  when others then
    raise notice 'nepal_public_holidays cron schedule setup failed (% — %); the sync-nepal-holidays scrape is not scheduled yet. This needs enabling pg_cron and pg_net for this project (Database -> Extensions in the Supabase dashboard) and re-running this migration''s DO block by hand in the SQL editor.', sqlstate, sqlerrm;
end $$;
