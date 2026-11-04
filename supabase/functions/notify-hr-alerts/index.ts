// Tells each company's admin and HR logins when a contract is about to end (a month before, a week before,
// on the day, and once more if it ended without being renewed) — by push notification to their phones and,
// when an email provider is configured, by email. Run every morning at 08:00 Nepal time by pg_cron (see
// supabase/migrations/20261104120000_hr_alert_push.sql). Each alert is announced once, so a contract does
// not nag every day; the website's bell still lists everything.
//
// Deploy with: supabase functions deploy notify-hr-alerts
// See supabase/functions/notify-hr-alerts/README.md for the one-time setup this needs.
//
// Add ?dry=1 to see what would be sent, without sending anything or marking it as announced.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { run } from './run.ts';

Deno.serve(async req => {
  try {
    // Same scheme as sync-nepal-holidays: a dedicated secret (supabase secrets set CRON_SECRET) authenticates
    // the cron caller; the gateway has already checked the Authorization header as a JWT.
    const expected = Deno.env.get('CRON_SECRET');
    if (!expected || req.headers.get('x-cron-secret') !== expected) {
      return new Response('Not authorized', { status: 401 });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const result = await run(supabase, {
      now: new Date(),
      dry: new URL(req.url).searchParams.get('dry') === '1',
      env: {
        appUrl: Deno.env.get('APP_URL') ?? undefined,
        resendKey: Deno.env.get('RESEND_API_KEY') ?? undefined,
        emailFrom: Deno.env.get('ALERT_EMAIL_FROM') ?? undefined,
      },
      fetchFn: fetch,
    });

    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('notify-hr-alerts failed:', err);
    return new Response('Internal error', { status: 500 });
  }
});
