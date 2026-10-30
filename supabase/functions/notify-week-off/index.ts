// Sends a push notification to every employee in the caller's company when
// the admin adds/changes a Week-off (see admin-web/app/week-off/page.tsx's
// notifyWeekOffChange()). Deploy with:
//   supabase functions deploy notify-week-off
// Requires no extra secrets beyond what every Supabase project already
// provides to Edge Functions (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// See supabase/functions/notify-week-off/README.md for the one-time setup
// this needs (an EAS project — see mobile-app/app.json's projectId).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async req => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Missing Authorization header', { status: 401 });

    // Client scoped to the calling admin's own JWT — respects RLS, so this
    // can only ever see/act on the caller's own company, same as every
    // other admin-web request.
    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      db: { schema: 'attendance' },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) return new Response('Not authenticated', { status: 401 });

    const { data: profile } = await callerClient.from('profiles').select('company_id, role').eq('id', user.id).single();
    if (!profile?.company_id || (profile.role !== 'admin' && profile.role !== 'hr')) {
      return new Response('Not authorized', { status: 403 });
    }

    // Service-role client for the actual fan-out read — push_tokens/
    // employees RLS is per-employee, not per-admin, so this step needs to
    // bypass it (same pattern as admin-web/lib/supabase-admin.ts's
    // server-only API routes).
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      db: { schema: 'attendance' },
    });

    const { data: employees } = await adminClient.from('employees').select('id').eq('company_id', profile.company_id).eq('status', 'active');
    const employeeIds = (employees ?? []).map(e => e.id);
    if (employeeIds.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

    const { data: tokens } = await adminClient.from('push_tokens').select('expo_push_token').in('employee_id', employeeIds);
    const pushTokens = (tokens ?? []).map(t => t.expo_push_token).filter(Boolean);
    if (pushTokens.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

    const messages = pushTokens.map(to => ({
      to,
      title: 'Week-off update',
      body: 'Your company\'s Week-off schedule has been updated — check the calendar for details.',
      sound: 'default',
    }));

    // Expo's push API accepts up to 100 messages per request.
    const chunks: (typeof messages)[] = [];
    for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

    for (const chunk of chunks) {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
    }

    return new Response(JSON.stringify({ sent: pushTokens.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('notify-week-off failed:', err);
    return new Response('Internal error', { status: 500 });
  }
});
