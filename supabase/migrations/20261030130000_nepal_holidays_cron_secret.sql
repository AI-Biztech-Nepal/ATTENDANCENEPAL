-- sync-nepal-holidays now authenticates the cron caller with a CRON_SECRET function secret (sent
-- as x-cron-secret) instead of comparing the Authorization header to the runtime's
-- SUPABASE_SERVICE_ROLE_KEY, which never matched the service role key from the API settings.
-- The Authorization header is still sent: the gateway verifies it as a JWT. The Vault secret
-- 'cron_secret' must equal the CRON_SECRET function secret — see the function's README.
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
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
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
