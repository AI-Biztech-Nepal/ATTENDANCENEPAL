// The decisions behind notify-hr-alerts, kept free of Deno / Supabase so they can be run and tested
// anywhere. Dates are plain YYYY-MM-DD keys; "today" is passed in (as the Nepal calendar day).

/** Where a contract stands. Each one is announced once per contract end date. */
export type Milestone = 'month' | 'week' | 'today' | 'ended';

export type ContractRow = {
  id: string;
  name: string;
  designation: string | null;
  contract_end: string;
};

export type ContractAlert = {
  employeeId: string;
  name: string;
  designation: string | null;
  endKey: string;
  /** Days from today to the end date; negative once it has ended. */
  daysLeft: number;
  milestone: Milestone;
};

/** Nepal is UTC+05:45 all year (no daylight saving). */
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60000;
const DAY_MS = 86400000;

/** Today's date in Nepal, so a job that runs at 08:00 Nepal time sees the right day. */
export function nepalTodayKey(now: Date): string {
  return new Date(now.getTime() + NEPAL_OFFSET_MS).toISOString().slice(0, 10);
}

function parseKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function daysLeft(todayKey: string, endKey: string): number | null {
  const a = parseKey(todayKey);
  const b = parseKey(endKey);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** Same day of the month `n` months on, or the month's last day if it has none — the website's bell
 * uses the same rule, so "within a month" means the same thing in both places. */
function addMonthsKey(key: string, n: number): string | null {
  const ms = parseKey(key);
  if (ms === null) return null;
  const d = new Date(ms);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

/** The newest milestone this contract has reached, or null while it is more than a month away. */
export function milestoneFor(todayKey: string, endKey: string): Milestone | null {
  const left = daysLeft(todayKey, endKey);
  if (left === null) return null;
  if (left < 0) return 'ended';
  if (left === 0) return 'today';
  if (left <= 7) return 'week';
  const horizon = addMonthsKey(todayKey, 1);
  return horizon !== null && endKey.slice(0, 10) <= horizon ? 'month' : null;
}

/** Every contract that has reached a milestone, most overdue first. */
export function contractAlerts(rows: ContractRow[], todayKey: string): ContractAlert[] {
  const out: ContractAlert[] = [];
  for (const r of rows) {
    const endKey = r.contract_end?.slice(0, 10);
    if (!endKey) continue;
    const left = daysLeft(todayKey, endKey);
    const milestone = milestoneFor(todayKey, endKey);
    if (left === null || milestone === null) continue;
    out.push({ employeeId: r.id, name: r.name, designation: r.designation, endKey, daysLeft: left, milestone });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

/** What the log stores to say "this one has been announced". Renewing a contract changes the end date,
 * so a renewed contract starts a fresh run of milestones. */
export function sentKey(employeeId: string, endKey: string, milestone: string): string {
  return `${employeeId}|${endKey.slice(0, 10)}|${milestone}`;
}

export function notYetSent(alerts: ContractAlert[], sent: Set<string>): ContractAlert[] {
  return alerts.filter(a => !sent.has(sentKey(a.employeeId, a.endKey, a.milestone)));
}

/** "Contract ends in 12 days" — the same wording as the bell. */
export function describe(a: Pick<ContractAlert, 'daysLeft'>): string {
  const d = a.daysLeft;
  if (d < 0) return `Contract ended ${-d} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Contract ends today';
  if (d === 1) return 'Contract ends tomorrow';
  return `Contract ends in ${d} days`;
}

const PUSH_LINES = 3;

/** One message per person, however many contracts are due, so a busy day is one buzz. `appUrl` (optional)
 * adds a link to the employee list to the email. */
export function buildMessage(alerts: ContractAlert[], appUrl?: string) {
  const line = (a: ContractAlert) => `${a.name}${a.designation ? ` (${a.designation})` : ''} — ${describe(a)}`;
  const title = alerts.length === 1 ? 'Contract reminder' : `${alerts.length} contract reminders`;
  const shown = alerts.slice(0, PUSH_LINES).map(line);
  const more = alerts.length - shown.length;
  const body = [...shown, ...(more > 0 ? [`and ${more} more`] : [])].join('\n');
  const emailText = [
    ...alerts.map(line),
    '',
    'Renew the contract on the employee’s profile, or start their exit if they are leaving.',
    ...(appUrl ? [`${appUrl.replace(/\/+$/, '')}/employees`] : []),
  ].join('\n');
  return { title, body, emailText };
}
