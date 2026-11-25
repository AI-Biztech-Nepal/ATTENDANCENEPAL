// Ported from admin-web/lib/ownKpi.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
// Your own KPIs (KPIs > Settings > "Add your own KPI"): a name and a number that staff type in for each person, each month
// ("Quality checks passed"). Nothing is worked out from the number: what is typed in is what is shown, next to last
// month's. Plain code with no network, so it can be tested on its own; useOwnKpis() and the useOwn* hooks read and share
// the saved rows.

import { NAME_MAX } from './kpiSettings';

/** A company can have this many KPIs of its own: a table wider than that stops being readable. */
export const OWN_MAX = 10;
export const OWN_NAME_MAX = NAME_MAX;
/** The biggest number a box takes (the database holds 11 digits, 2 of them decimals). */
export const OWN_VALUE_MAX = 999999999.99;

/** A KPI the company added. */
export type OwnKpi = { id: string; name: string; on: boolean };

/** The column id a KPI of your own has in the KPI table, so it can never be mistaken for one of the ten. */
export const ownColumnId = (id: string) => `own:${id}`;
export const isOwnColumn = (columnId: string) => columnId.startsWith('own:');
export const ownIdOf = (columnId: string) => columnId.slice('own:'.length);

/** Reads a saved row. A row without a usable id or name is left out rather than shown as a blank column. */
export function ownKpiFromRow(row: Record<string, unknown>): OwnKpi | null {
  const name = typeof row.name === 'string' ? cleanName(row.name) : '';
  if (typeof row.id !== 'string' || name === '') return null;
  return { id: row.id, name, on: row.is_on !== false };
}

/** The KPIs in the order they were added (the database gives them oldest first). */
export const ownKpisFromRows = (rows: Record<string, unknown>[] | null | undefined): OwnKpi[] => (rows ?? []).map(ownKpiFromRow).filter((k): k is OwnKpi => k !== null);

/** The ones in use. */
export const onlyOn = (kpis: OwnKpi[]) => kpis.filter(k => k.on);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A name as the page keeps it: trimmed, with single spaces. */
export const cleanName = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The same name whatever the capitals and spaces, which is how the database compares them too. */
export const nameKey = (text: string) => cleanName(text).toLowerCase();

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/** A number the way the pages show it: thousands separated, up to two decimals, none that are only zeros ("1,250.5"). */
export const numberText = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

/** A number the way a box shows it for editing: plain, no separators ("1250.5"). */
export const boxText = (n: number) => String(Math.round(n * 100) / 100);

export type ParsedValue = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'error'; error: string };

/** What a box holds: nothing, a number from 0 to 999,999,999.99 with up to two decimals, or what is wrong with it. */
export function parseValue(text: string): ParsedValue {
  const s = text.trim();
  if (s === '') return { kind: 'empty' };
  if (/^-/.test(s) && /^-\d+(\.\d+)?$/.test(s)) return { kind: 'error', error: 'A number cannot be below 0.' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { kind: 'error', error: 'Type a number, like 12 or 12.5 (digits and a decimal point only).' };
  const [whole, decimals = ''] = s.split('.');
  // "4.250" is 4.25: zeros at the end are not a third decimal.
  if (decimals.replace(/0+$/, '').length > 2) return { kind: 'error', error: 'Use up to 2 decimals.' };
  if (whole.replace(/^0+(?=\d)/, '').length > 9) return { kind: 'error', error: 'That number is too big.' };
  return { kind: 'ok', value: Number(s) };
}

/** A value from the database (PostgREST can send a numeric as a number or as text), or null. */
export function valueFromRow(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Settings: the rows of "Your KPIs" that are the company's own
// ---------------------------------------------------------------------------

/** One row in the settings list while it is being edited. `id` is null until the row has been saved. */
export type OwnDraftRow = { key: string; id: string | null; name: string; on: boolean };

export const draftFromOwn = (kpis: OwnKpi[]): OwnDraftRow[] => kpis.map(k => ({ key: k.id, id: k.id, name: k.name, on: k.on }));

/** What a draft means for comparing: names as they will be saved. */
const shape = (rows: OwnDraftRow[]) => rows.map(r => ({ id: r.id, name: cleanName(r.name), on: r.on }));

/** True when the draft differs from what is saved (a new row, a rename, a switch). */
export const ownDirty = (saved: OwnKpi[], draft: OwnDraftRow[]) => JSON.stringify(shape(draft)) !== JSON.stringify(shape(draftFromOwn(saved)));

export type OwnSavePlan = { inserts: { key: string; name: string; on: boolean }[]; updates: { id: string; name: string; on: boolean }[] };

/**
 * What saving the settings has to do for the KPIs of your own, or the sentence that says what to fix. `taken` holds the
 * names of the ten usual KPIs as they are called now, so a KPI of your own cannot be called the same as one of them.
 * Removing a KPI is not here: it deletes numbers, so it asks first and happens on its own.
 */
export function planOwnSave(saved: OwnKpi[], draft: OwnDraftRow[], taken: string[] = []): { plan: OwnSavePlan } | { error: string } {
  if (draft.length > OWN_MAX) return { error: `You can add up to ${OWN_MAX} KPIs of your own.` };
  const seen = new Map<string, string>();
  const takenKeys = new Set(taken.map(nameKey));
  for (const row of draft) {
    const name = cleanName(row.name);
    if (name === '') return { error: 'Give each KPI of your own a name.' };
    if (name.length > OWN_NAME_MAX) return { error: `A name can be up to ${OWN_NAME_MAX} characters. "${name.slice(0, 20)}…" is too long.` };
    const key = nameKey(name);
    if (takenKeys.has(key)) return { error: `"${name}" is already the name of another KPI. Choose a different name.` };
    if (seen.has(key)) return { error: `Two of your KPIs are called "${name}". Each needs its own name.` };
    seen.set(key, name);
  }
  const before = new Map(saved.map(k => [k.id, k]));
  const inserts: OwnSavePlan['inserts'] = [];
  const updates: OwnSavePlan['updates'] = [];
  for (const row of draft) {
    const name = cleanName(row.name);
    const was = row.id ? before.get(row.id) : undefined;
    if (!row.id || !was) inserts.push({ key: row.key, name, on: row.on });
    else if (was.name !== name || was.on !== row.on) updates.push({ id: row.id, name, on: row.on });
  }
  return { plan: { inserts, updates } };
}

/** What a failed save says. The unique index on the name is the usual cause, and a missing table means the migration has not run. */
export function ownSaveProblem(e: { code?: string; message?: string } | null, name = ''): string {
  if (!e) return '';
  const text = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/23505|custom_kpis_name_unique|duplicate key/i.test(text)) return `There is already a KPI called "${name}". Choose a different name.`;
  if (/up to 10 KPIs/i.test(text)) return `You can add up to ${OWN_MAX} KPIs of your own.`;
  if (/PGRST205|42P01|schema cache|does not exist|could not find the table/i.test(text)) return 'Your own KPIs are not set up in the database yet: run the migration 20261123120000_own_kpis.sql.';
  return `Could not save: ${e.message || 'the database did not say why'}`;
}

// ---------------------------------------------------------------------------
// The typing page: one box per person for one KPI and one month
// ---------------------------------------------------------------------------

/** A number that is already saved for a person: its row (so it can be removed) and its value. */
export type SavedValue = { id: string; value: number };

/** What the box for a person holds: what was typed, or else the saved number. */
export const effectiveText = (typed: Record<string, string>, saved: Map<string, SavedValue>, employeeId: string): string =>
  employeeId in typed ? typed[employeeId] : saved.has(employeeId) ? boxText(saved.get(employeeId)!.value) : '';

export type EntryPlan = {
  /** Boxes that hold something that is not a number, with what is wrong. */
  errors: Map<string, string>;
  /** Numbers to save: new ones and changed ones. */
  upserts: { employeeId: string; value: number }[];
  /** Saved numbers whose box was emptied: their rows go. */
  deletes: { id: string; employeeId: string }[];
};

/** What saving the typing page has to do. A box left as it was does nothing. */
export function planEntry(employeeIds: string[], typed: Record<string, string>, saved: Map<string, SavedValue>): EntryPlan {
  const plan: EntryPlan = { errors: new Map(), upserts: [], deletes: [] };
  for (const id of employeeIds) {
    if (!(id in typed)) continue;
    const parsed = parseValue(typed[id]);
    const was = saved.get(id);
    if (parsed.kind === 'error') plan.errors.set(id, parsed.error);
    else if (parsed.kind === 'empty') {
      if (was) plan.deletes.push({ id: was.id, employeeId: id });
    } else if (!was || was.value !== parsed.value) plan.upserts.push({ employeeId: id, value: parsed.value });
  }
  return plan;
}

/** How many boxes differ from what is saved (an invalid one counts: it is a change that cannot be saved yet). */
export function changedCount(employeeIds: string[], typed: Record<string, string>, saved: Map<string, SavedValue>): number {
  let n = 0;
  for (const id of employeeIds) {
    if (!(id in typed)) continue;
    const parsed = parseValue(typed[id]);
    const was = saved.get(id);
    if (parsed.kind === 'error') n++;
    else if (parsed.kind === 'empty') n += was ? 1 : 0;
    else n += !was || was.value !== parsed.value ? 1 : 0;
  }
  return n;
}
