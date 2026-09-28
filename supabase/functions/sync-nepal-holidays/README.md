# sync-nepal-holidays

Scrapes hamropatro.com's public holiday calendar and replaces the `nepal_public_holidays` table
with whatever it currently says. Called automatically once a day by `pg_cron` at 23:15 UTC (05:00
Asia/Kathmandu) — see `supabase/migrations/20260823200000_nepal_public_holidays.sql`. Powers the
Name-field suggestions on the New Holiday form (`admin-web/app/week-off/page.tsx`).

Nepali festival dates are lunar/panchang-based and shift every BS year — there's no formula for
them, only a real published calendar, which is why this scrapes a live source daily instead of a
hardcoded list that would eventually go stale or get stuck on one year.

## One-time setup

The code and the cron schedule are both already in place, but — same as `notify-week-off` — the
function itself still needs deploying by someone with real Supabase CLI credentials; a coding
assistant has no browser/stored logins to do this step:

```
cd supabase
npx supabase login    # your own Supabase account
npx supabase link --project-ref <your-project-ref>   # find this in the Supabase dashboard URL
npx supabase functions deploy sync-nepal-holidays
```

No extra secrets to configure — it only uses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, which
every Edge Function gets automatically.

## Until it's deployed

The `nepal_public_holidays` table already has a one-time seed of BS 2083's holidays (inserted by
the migration itself), so the New Holiday form's suggestions work from day one — they just won't
self-update until this function is deployed and the daily cron job actually has something to call.
The cron job fires on schedule regardless; before deploy it just gets a harmless 404 each time.

## Verifying it worked

After deploying, trigger it once by hand to confirm:

```
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/sync-nepal-holidays" \
  -H "Authorization: Bearer <your-service-role-key>"
```

A healthy response looks like `{"upserted":33,"bsYears":[2083]}`. `{"upserted":0,...}` means
hamropatro's page structure changed and the scraper's regex (in `index.ts`, `ROW_RE`) needs
updating to match — it deliberately leaves the existing table alone rather than wiping it in that
case, so nothing breaks silently, but the data will also stop refreshing until that regex is fixed.
