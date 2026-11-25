// Ported from admin-web/lib/kpiSettings.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
// KPI settings (KPIs > Settings): the word a company uses for the people it serves, which KPIs it uses and what it
// calls them, and the numbers the KPIs are worked out with. Plain code with no network, so it can be tested on
// its own; useKpiSettings() reads and shares the saved row.

export const PEOPLE_WORDS = ['customer', 'client', 'guest', 'patient', 'member', 'student'] as const;
export type PeopleWord = (typeof PEOPLE_WORDS)[number];

/** The ten KPIs from the owner's sheet. The ids are the column ids used by KPI_GROUPS and the keys stored in the database. */
export const KPI_IDS = ['attendance', 'services', 'rebooking', 'utilisation', 'feedback', 'nps', 'peers', 'manager', 'clevel', 'training'] as const;
export type KpiId = (typeof KPI_IDS)[number];

export const NAME_MAX = 60;

export type KpiSettings = {
  word: PeopleWord;
  /** Hours in a working day, for hour utilisation. */
  hoursPerDay: number;
  /** Responses a month needs before customer feedback and NPS are shown. */
  minResponses: number;
  /** A customer who returns within this many days counts as "booked again". */
  repeatDays: number;
  /** KPIs this company does not use. */
  off: KpiId[];
  /** The names this company gave KPIs. A KPI that is not here keeps its own name. */
  names: Partial<Record<KpiId, string>>;
};

export const DEFAULT_KPI_SETTINGS: KpiSettings = { word: 'customer', hoursPerDay: 9, minResponses: 5, repeatDays: 45, off: [], names: {} };

/** What each KPI is called until the company renames it, where its numbers come from, and how they are shown. */
export const KPI_INFO: Record<KpiId, { label: string; source: string; shownAs: string }> = {
  attendance: { label: 'Attendance and punctuality', source: 'Automatic, from check-ins', shownAs: '% present and % on time' },
  services: { label: 'Services performed', source: 'Imported file', shownAs: 'A number' },
  rebooking: { label: 'Rebooking rate', source: 'Imported file', shownAs: '%' },
  utilisation: { label: 'Hour utilisation per day', source: 'Imported file', shownAs: '% of the working day' },
  feedback: { label: 'Customer feedback', source: 'Paper forms, typed in', shownAs: 'Average, 1 to 5' },
  nps: { label: 'NPS', source: 'Paper forms, typed in', shownAs: '−100 to +100' },
  peers: { label: 'Peers', source: 'Colleague reviews', shownAs: 'Average, 1 to 5' },
  manager: { label: 'Manager', source: 'Colleague reviews', shownAs: 'Average, 1 to 5' },
  clevel: { label: 'C-level', source: 'Colleague reviews', shownAs: 'Average, 1 to 5' },
  training: { label: 'Training and compliance', source: 'Colleague reviews', shownAs: 'Average, 1 to 5' },
};

// ---------------------------------------------------------------------------
// The word for the people served
// ---------------------------------------------------------------------------

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Words = {
  one: string;
  many: string;
  One: string;
  Many: string;
  /** Writes a sentence written with "customer" using this company's word. Only whole words change, so
   * "customer_feedback" and the like are left alone. */
  t: (text: string) => string;
};

export function wordsFor(word: PeopleWord): Words {
  const one = word;
  const many = `${word}s`;
  const One = capital(one);
  const Many = capital(many);
  return {
    one,
    many,
    One,
    Many,
    t: text => (word === 'customer' ? text : text.replace(/\bcustomers\b/g, many).replace(/\bcustomer\b/g, one).replace(/\bCustomers\b/g, Many).replace(/\bCustomer\b/g, One)),
  };
}

// ---------------------------------------------------------------------------
// Names and which KPIs are on
// ---------------------------------------------------------------------------

export const isKpiOn = (id: KpiId, s: KpiSettings) => !s.off.includes(id);

/** What a KPI is called on the pages: the company's own name for it, else its usual name with the company's
 * word in it. `fallback` is the usual name when a page words it differently ("Number of services performed"). */
export function kpiLabel(id: KpiId, s: KpiSettings, fallback?: string): string {
  return s.names[id] ?? wordsFor(s.word).t(fallback ?? KPI_INFO[id].label);
}

export const defaultKpiLabel = (id: KpiId, word: PeopleWord) => wordsFor(word).t(KPI_INFO[id].label);

// ---------------------------------------------------------------------------
// Reading and writing the saved row
// ---------------------------------------------------------------------------

const isKpiId = (v: unknown): v is KpiId => typeof v === 'string' && (KPI_IDS as readonly string[]).includes(v);
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** The settings in a saved row. A missing row, or a column the database does not have yet, gives the default for
 * it, so the KPI pages keep working before anything has been set up. */
export function fromRow(row: Record<string, unknown> | null | undefined): KpiSettings {
  const d = DEFAULT_KPI_SETTINGS;
  if (!row) return { ...d, off: [], names: {} };
  const hours = typeof row.hours_per_day === 'string' ? Number(row.hours_per_day) : row.hours_per_day;
  const names: KpiSettings['names'] = {};
  if (row.kpi_names && typeof row.kpi_names === 'object' && !Array.isArray(row.kpi_names)) {
    for (const [k, v] of Object.entries(row.kpi_names as Record<string, unknown>)) {
      if (isKpiId(k) && typeof v === 'string' && v.trim() !== '' && v.trim().length <= NAME_MAX) names[k] = v.trim();
    }
  }
  return {
    word: (PEOPLE_WORDS as readonly string[]).includes(row.people_word as string) ? (row.people_word as PeopleWord) : d.word,
    hoursPerDay: inRange(hours, 1, 24) ? hours : d.hoursPerDay,
    minResponses: inRange(row.min_responses, 1, 100) ? Math.round(row.min_responses) : d.minResponses,
    repeatDays: inRange(row.repeat_window_days, 1, 365) ? Math.round(row.repeat_window_days) : d.repeatDays,
    off: Array.isArray(row.kpi_off) ? KPI_IDS.filter(id => (row.kpi_off as unknown[]).includes(id)) : [],
    names,
  };
}

/** The row to save. */
export function toRow(s: KpiSettings, companyId: string) {
  return {
    company_id: companyId,
    people_word: s.word,
    hours_per_day: s.hoursPerDay,
    min_responses: s.minResponses,
    repeat_window_days: s.repeatDays,
    kpi_off: KPI_IDS.filter(id => s.off.includes(id)),
    kpi_names: Object.fromEntries(KPI_IDS.filter(id => s.names[id]).map(id => [id, s.names[id]])),
  };
}

// ---------------------------------------------------------------------------
// The boxes on the settings page hold text; these turn it into numbers
// ---------------------------------------------------------------------------

/** A whole number from min to max, or null. */
export function parseWhole(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Hours in a day from 1 to 24, in whole or half hours ("8", "7.5", "7,5"), or null. */
export function parseHours(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d)?$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 24 && Number.isInteger(n * 2) ? n : null;
}

export type SettingsDraft = {
  word: PeopleWord;
  hours: string;
  minResponses: string;
  repeatDays: string;
  off: KpiId[];
  /** The text in each KPI's name box. A box that is empty, or that holds the usual name, means "keep the usual name". */
  names: Partial<Record<KpiId, string>>;
};

export function draftFromSettings(s: KpiSettings): SettingsDraft {
  return { word: s.word, hours: String(s.hoursPerDay), minResponses: String(s.minResponses), repeatDays: String(s.repeatDays), off: [...s.off], names: { ...s.names } };
}

/** The settings a draft means, or the sentence that says what to fix. */
export function settingsFromDraft(d: SettingsDraft): { settings: KpiSettings } | { error: string } {
  const hoursPerDay = parseHours(d.hours);
  if (hoursPerDay == null) return { error: 'Hours in a working day must be from 1 to 24, in whole or half hours.' };
  const minResponses = parseWhole(d.minResponses, 1, 100);
  if (minResponses == null) return { error: 'Responses needed must be a whole number from 1 to 100.' };
  const repeatDays = parseWhole(d.repeatDays, 1, 365);
  if (repeatDays == null) return { error: 'Days to come back must be a whole number from 1 to 365.' };
  if (KPI_IDS.every(id => d.off.includes(id))) return { error: 'Keep at least one KPI on.' };
  const names: KpiSettings['names'] = {};
  for (const id of KPI_IDS) {
    const text = (d.names[id] ?? '').trim().replace(/\s+/g, ' ');
    if (text.length > NAME_MAX) return { error: `A name can be up to ${NAME_MAX} characters. "${text.slice(0, 20)}…" is too long.` };
    if (text !== '' && text !== defaultKpiLabel(id, d.word)) names[id] = text;
  }
  return { settings: { word: d.word, hoursPerDay, minResponses, repeatDays, off: KPI_IDS.filter(id => d.off.includes(id)), names } };
}

export const sameSettings = (a: KpiSettings, b: KpiSettings) => JSON.stringify(toRow(a, '')) === JSON.stringify(toRow(b, ''));
