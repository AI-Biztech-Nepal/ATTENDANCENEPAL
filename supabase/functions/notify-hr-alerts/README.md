# notify-hr-alerts

Tells each company's **admin and HR logins** when an employee's contract is about to end, so they don't
have to open the app or website to find out. It runs every morning at 08:00 Nepal time.

| When | Message |
|---|---|
| Contract ends within a month | "Sita Rai (Therapist) — Contract ends in 12 days" |
| Within a week | same, with the days left |
| On the end date | "… Contract ends today" |
| After it ended, still not renewed | "… Contract ended 3 days ago" (once) |

- Each of those is sent **once** per contract end date (`hr_alert_log`). Renewing a contract (a new end date)
  starts a fresh run. The bell on the website still lists everything, every day.
- One message per person per morning, however many contracts are due.
- Sent as a **push notification** to the phones the admin / HR logged in on, and as an **email** if you set
  that up below. An alert is only marked as sent once somebody actually received it — so if nothing is set up
  yet, nothing is lost: the first run after you finish setup tells people.
- Birthdays are not included yet (they are shown in the bell only).

## One-time setup

### 1. Run the migration
Paste `supabase/migrations/20261104120000_hr_alert_push.sql` into the Supabase SQL editor (after
`20261103140000_*`). It lets an owner/HR phone register for push even without an employee record, creates the
`hr_alert_log` table, and schedules the daily run. The schedule needs the Vault secrets `project_url`,
`service_role_key` and `cron_secret` that the holiday sync already uses (see `sync-nepal-holidays/README.md`);
if they are missing the migration says so in a notice and everything else still applies.

### 2. Deploy the function
```
cd supabase
npx supabase functions deploy notify-hr-alerts
```
It uses the same `CRON_SECRET` function secret as `sync-nepal-holidays` — nothing new to set for that.

### 3. Pick how people hear about it (either or both)

**Email** — works for people who only use the website. Needs an email provider (Resend):
create an account, verify the domain you send from, then
```
npx supabase secrets set RESEND_API_KEY=re_xxx ALERT_EMAIL_FROM="HR Alerts <alerts@yourdomain.com>" APP_URL=https://your-admin-site
```
(`APP_URL` is optional — it adds a link to the email.) It is sent to each admin / HR login's sign-in email.

**Push to phones** — needs Android push to be set up, which this repo does not have yet: there is no
`google-services.json` and no `android.googleServicesFile` in `mobile-app/app.json`, and without them an
Android build cannot get a push token. (The Week-off push has the same gap.) To fix it: create a Firebase
project, add the Android app `com.attendancenepal.mobile`, put its `google-services.json` in `mobile-app/`,
set `"googleServicesFile": "./google-services.json"` under `expo.android` in `app.json`, upload the Firebase
service-account key to EAS (`npx eas credentials` → Android → FCM V1), and build a new APK. After that, each
admin / HR user opens the new app once and signs in — that registers their phone.

### 4. Try it
A dry run shows what *would* be sent, without sending or marking anything:
```
curl -X POST "https://<project-ref>.supabase.co/functions/v1/notify-hr-alerts?dry=1" \
  -H "Authorization: Bearer <service role key>" -H "x-cron-secret: <CRON_SECRET>"
```
Without `?dry=1` it sends for real. Check the schedule with
`select * from cron.job where jobname = 'notify-hr-alerts-daily';` and past runs with
`select status, return_message from cron.job_run_details order by start_time desc limit 5;`.

## How a phone is tied to a person
A phone belongs to whoever signed in on it last, and signing out removes it, so a phone that changes hands
stops showing the previous person's alerts. One phone per login.
