/** One field's before and after, as the history trigger records it
 * (20261101160000_employee_history.sql). Branch and manager are names as they
 * were at the time; salary and allowance are numbers. */
export type HistoryChange = { from: string | number | null; to: string | number | null };

export type HistoryField = 'branch' | 'designation' | 'department' | 'reports_to' | 'salary' | 'allowance';

export type HistoryChanges = Partial<Record<HistoryField, HistoryChange>>;

export type EmployeeHistoryEntry = {
  id: string;
  employee_id: string;
  /** AD date key (YYYY-MM-DD) the change takes effect. */
  effective_date: string;
  changes: HistoryChanges;
  reason: string | null;
  remark: string | null;
  /** 'auto' = recorded by the database when the edit was made; 'manual' = typed in by HR. */
  source: 'auto' | 'manual';
  created_at: string;
};

/** Shown in this order, which is the order the spec lists them in. */
export const HISTORY_FIELDS: { key: HistoryField; label: string; money?: boolean }[] = [
  { key: 'branch', label: 'Branch' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'reports_to', label: 'Now reporting to' },
  { key: 'salary', label: 'Basic salary', money: true },
  { key: 'allowance', label: 'Allowance', money: true },
];

export type EntryTag = { label: string; tone: 'info' | 'good' | 'warning' | 'neutral' };

const asNumber = (v: string | number | null | undefined): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;

/** What kind of event an entry is, read off what changed: a new branch is a
 * Transfer; a new designation a Promotion; a new department or manager on its
 * own a Role change; a higher salary or allowance an Increment (a lower one is
 * just a Pay change). One edit can be several at once — "a transfer with a
 * promotion and an increment". */
export function entryTags(changes: HistoryChanges): EntryTag[] {
  const tags: EntryTag[] = [];
  if (changes.branch) tags.push({ label: 'Transfer', tone: 'info' });
  if (changes.designation) tags.push({ label: 'Promotion', tone: 'good' });
  else if (changes.department || changes.reports_to) tags.push({ label: 'Role change', tone: 'neutral' });

  const pay = [changes.salary, changes.allowance].filter((c): c is HistoryChange => !!c);
  if (pay.length > 0) {
    const deltas = pay.map(c => (asNumber(c.to) ?? 0) - (asNumber(c.from) ?? 0));
    const increase = deltas.some(d => d > 0) && !deltas.some(d => d < 0);
    tags.push(increase ? { label: 'Increment', tone: 'good' } : { label: 'Pay change', tone: 'warning' });
  }
  return tags;
}

export function formatMoney(value: string | number | null | undefined): string {
  const n = asNumber(value);
  return n === null ? '—' : n.toLocaleString();
}

/** "+12%" / "−5%" for a salary or allowance change, when both ends are known. */
export function percentChange(change: HistoryChange): string | null {
  const from = asNumber(change.from);
  const to = asNumber(change.to);
  if (from === null || to === null || from <= 0) return null;
  const pct = Math.round(((to - from) / from) * 1000) / 10;
  if (pct === 0) return null;
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/** The pairs HR typed into the "add a past record" form, turned into
 * `changes`. A pair is kept when either side is filled in. */
export function buildManualChanges(pairs: Partial<Record<HistoryField, { from: string; to: string }>>): HistoryChanges {
  const out: HistoryChanges = {};
  for (const field of HISTORY_FIELDS) {
    const pair = pairs[field.key];
    if (!pair) continue;
    const from = pair.from.trim();
    const to = pair.to.trim();
    if (!from && !to) continue;
    if (field.money) {
      out[field.key] = { from: from ? Number(from) : null, to: to ? Number(to) : null };
    } else {
      out[field.key] = { from: from || null, to: to || null };
    }
  }
  return out;
}
