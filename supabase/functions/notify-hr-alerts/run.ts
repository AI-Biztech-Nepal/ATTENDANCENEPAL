// One daily pass of notify-hr-alerts: find contracts that have reached a milestone, skip the ones already
// announced, tell each company's admin and HR logins (push to their phones, email if configured), and only
// then remember what was announced. Takes the Supabase client and fetch as arguments so it can be run and
// tested without Deno.

import { buildMessage, contractAlerts, notYetSent, nepalTodayKey, sentKey, type ContractAlert, type ContractRow } from './alerts.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RESEND_URL = 'https://api.resend.com/emails';

const PAGE = 1000;
// Expo accepts up to 100 messages per request; `in (…)` lists stay short enough for a URL.
const PUSH_CHUNK = 100;
const IN_CHUNK = 50;

export type Env = {
  /** The website's address, added to the email as a link. */
  appUrl?: string;
  /** Email goes out only when both of these are set (Resend). */
  resendKey?: string;
  emailFrom?: string;
};

export type CompanyResult = {
  companyId: string;
  /** Alerts reached a milestone that has not been announced yet. */
  due: number;
  /** Admin / HR logins in the company. */
  recipients: number;
  /** Phones that accepted the push. */
  pushed: number;
  /** Emails the provider accepted. */
  emailed: number;
  /** Alerts remembered as announced (0 when nothing could be delivered, so they are tried again tomorrow). */
  logged: number;
  /** With dry=1: the message that would have been sent. */
  preview?: { title: string; body: string };
  error?: string;
};

type Row = ContractRow & { company_id: string };

// The Supabase client's type comes from an https import in Deno, so it is left loose here.
// deno-lint-ignore no-explicit-any
type Supabase = any;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchContractRows(supabase: Supabase): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, company_id, name, designation, contract_end')
      .eq('status', 'active')
      .eq('employment_type', 'contract')
      .not('contract_end', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function loadSent(supabase: Supabase, alerts: ContractAlert[]): Promise<Set<string>> {
  const sent = new Set<string>();
  for (const ids of chunks([...new Set(alerts.map(a => a.employeeId))], IN_CHUNK)) {
    const { data, error } = await supabase
      .from('hr_alert_log')
      .select('employee_id, ref_date, milestone')
      .eq('kind', 'contract_end')
      .in('employee_id', ids);
    if (error) throw error;
    for (const l of data ?? []) sent.add(sentKey(l.employee_id, l.ref_date, l.milestone));
  }
  return sent;
}

async function sendPush(
  supabase: Supabase,
  fetchFn: typeof fetch,
  tokens: { id: string; expo_push_token: string }[],
  message: { title: string; body: string }
): Promise<number> {
  let pushed = 0;
  const dead: string[] = [];
  for (const group of chunks(tokens, PUSH_CHUNK)) {
    // A failed request must not undo the batches that already went out: those people have been told, and
    // the run has to go on to record that.
    try {
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(group.map(t => ({ to: t.expo_push_token, title: message.title, body: message.body, sound: 'default', data: { type: 'contract_alerts' } }))),
      });
      const json = await res.json().catch(() => null);
      const tickets: { status?: string; details?: { error?: string } }[] = Array.isArray(json?.data) ? json.data : [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'ok') pushed++;
        // The phone uninstalled the app or turned notifications off for good — stop trying it.
        else if (ticket?.details?.error === 'DeviceNotRegistered' && group[i]) dead.push(group[i].id);
        else console.error('Expo rejected a push:', JSON.stringify(ticket));
      });
    } catch (e) {
      console.error('Expo push request failed:', e);
    }
  }
  if (dead.length > 0) await supabase.from('push_tokens').delete().in('id', dead);
  return pushed;
}

/** One email through Resend, returning what Resend said, so a setup problem (an unverified sending domain, a
 * wrong key) can be read instead of guessed at. */
export async function sendEmail(
  fetchFn: typeof fetch,
  env: Env,
  to: string,
  subject: string,
  text: string
): Promise<{ ok: boolean; status: number; detail: string }> {
  if (!env.resendKey || !env.emailFrom) return { ok: false, status: 0, detail: 'RESEND_API_KEY and ALERT_EMAIL_FROM are not both set' };
  const res = await fetchFn(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
  });
  return { ok: res.ok, status: res.status, detail: res.ok ? '' : await res.text().catch(() => '') };
}

async function sendEmails(
  supabase: Supabase,
  fetchFn: typeof fetch,
  env: Env,
  userIds: string[],
  title: string,
  text: string
): Promise<number> {
  if (!env.resendKey || !env.emailFrom) return 0;
  let emailed = 0;
  for (const id of userIds) {
    // One person's missing address or a failed send must not stop the others (see sendPush).
    try {
      const { data } = await supabase.auth.admin.getUserById(id);
      const to: string | undefined = data?.user?.email;
      if (!to) continue;
      const sent = await sendEmail(fetchFn, env, to, title, text);
      if (sent.ok) emailed++;
      else console.error(`Resend rejected the alert email to ${to}:`, sent.status, sent.detail);
    } catch (e) {
      console.error('Alert email failed:', e);
    }
  }
  return emailed;
}

async function handleCompany(
  supabase: Supabase,
  fetchFn: typeof fetch,
  env: Env,
  dry: boolean,
  todayKey: string,
  companyId: string,
  rows: Row[],
  result: CompanyResult
) {
  const candidates = contractAlerts(rows, todayKey);
  if (candidates.length === 0) return;
  const due = notYetSent(candidates, await loadSent(supabase, candidates));
  result.due = due.length;
  if (due.length === 0) return;

  const message = buildMessage(due, env.appUrl);

  // Everyone who sees the bell on the website: the company's admin and HR logins.
  const { data: admins, error: adminsError } = await supabase.from('profiles').select('id').eq('company_id', companyId).in('role', ['admin', 'hr']);
  if (adminsError) throw adminsError;
  const userIds: string[] = (admins ?? []).map((a: { id: string }) => a.id);
  result.recipients = userIds.length;
  if (userIds.length === 0) return;

  if (dry) {
    result.preview = { title: message.title, body: message.body };
    return;
  }

  const { data: tokens, error: tokensError } = await supabase.from('push_tokens').select('id, expo_push_token').in('user_id', userIds);
  if (tokensError) throw tokensError;

  result.pushed = await sendPush(supabase, fetchFn, tokens ?? [], message);
  result.emailed = await sendEmails(supabase, fetchFn, env, userIds, message.title, message.emailText);

  // Remember them only once somebody actually got the message — otherwise setting up push or email later
  // would find these already "announced" and never tell anyone.
  if (result.pushed + result.emailed > 0) {
    const { error } = await supabase.from('hr_alert_log').upsert(
      due.map(a => ({ company_id: companyId, employee_id: a.employeeId, kind: 'contract_end', ref_date: a.endKey, milestone: a.milestone })),
      { onConflict: 'employee_id,kind,ref_date,milestone', ignoreDuplicates: true }
    );
    if (error) throw error;
    result.logged = due.length;
  }
}

export async function run(supabase: Supabase, opts: { now: Date; dry: boolean; env: Env; fetchFn: typeof fetch }) {
  const todayKey = nepalTodayKey(opts.now);

  const { data: companies, error } = await supabase.from('companies').select('id').eq('status', 'active');
  if (error) throw error;
  const rows = await fetchContractRows(supabase);

  const results: CompanyResult[] = [];
  for (const company of (companies ?? []) as { id: string }[]) {
    const mine = rows.filter(r => r.company_id === company.id);
    if (mine.length === 0) continue;
    const result: CompanyResult = { companyId: company.id, due: 0, recipients: 0, pushed: 0, emailed: 0, logged: 0 };
    try {
      await handleCompany(supabase, opts.fetchFn, opts.env, opts.dry, todayKey, company.id, mine, result);
    } catch (e) {
      // One company's trouble must not stop the others.
      result.error = e instanceof Error ? e.message : JSON.stringify(e);
    }
    if (result.due > 0 || result.error) results.push(result);
  }
  return { today: todayKey, dry: opts.dry, companies: results };
}
