# sync-nepal-holidays

Scrapes hamropatro.com's public holiday calendar into the `nepal_public_holidays` table. Called
automatically once a day by `pg_cron` at 23:15 UTC (05:00 Asia/Kathmandu) — see
`supabase/migrations/20261030120000_nepal_holidays_cron_vault.sql`. Powers the Name-field
suggestions on the New Holiday form (`admin-web/app/(admin)/week-off/page.tsx`).

Nepali festival dates are lunar/panchang-based and shift every BS year — there's no formula for
them, only a real published calendar, which is why this scrapes a live source daily instead of a
hardcoded list that would eventually go stale or get stuck on one year.

Each run upserts on `(bs_year, start_date)` and then removes rows of the scraped BS years that the
run didn't see, so re-running is harmless and a failed write never empties the table. Rows whose
BS year isn't within a year of today's, or whose AD date doesn't match their BS year, are dropped
before writing, so a hamropatro layout change can't insert junk.

## One-time setup

Both steps need someone with access to the Supabase project — they can't be done from the repo.

1. **Deploy the function** (needs the Supabase CLI and your own login):

   ```
   cd supabase
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy sync-nepal-holidays
   ```

2. **Store the two values the cron job reads in Vault** (Dashboard → SQL Editor). The service
   role key is under Project Settings → API. Never commit it — this repo is public.

   ```sql
   select vault.create_secret('https://<your-project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<your-service-role-key>', 'service_role_key');
   ```

   If the migration above hasn't been applied yet (it applies on push to `main` when the GitHub
   integration is connected), run its `do $$ ... $$` block in the SQL editor as well.

## Verifying it worked

Run the job's command once by hand in the SQL editor instead of waiting for the night:

```sql
select command from cron.job where jobname = 'sync-nepal-holidays-daily';  -- copy, then run it
select status_code, content from net._http_response order by created desc limit 1;
```

A healthy response is `200` with `{"upserted":35,"bsYears":[2083]}` (the count changes as
hamropatro updates). `{"upserted":0,...}` means hamropatro's page structure changed and `ROW_RE`
in `index.ts` needs updating — the table is left untouched in that case. The next morning:

```sql
select status, return_message from cron.job_run_details order by start_time desc limit 3;
select max(scraped_at) from nepal_public_holidays;
```

## After the portal migration

The single portal Supabase project does not recreate this job. Once Attendance moves there, repeat
both setup steps against the portal project — the function writes to
`attendance.nepal_public_holidays`, so update the table name in `index.ts` — and create the cron
job there with the portal's URL and key in its Vault.
