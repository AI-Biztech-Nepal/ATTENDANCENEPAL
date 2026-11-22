// Service import: reads the CSV a booking system exports and works out which rows are services an employee performed.
// Everything here is plain code with no network, so it can be tested on its own; the page (KPIs > Import) does the
// uploading. Customers are never kept by name, phone number or ID: only a scrambled code (see customerKey()).

export type ColumnRole = 'employee' | 'date' | 'service' | 'minutes' | 'customer' | 'status' | 'ignore';

export const ROLE_LABEL: Record<ColumnRole, string> = {
  employee: 'Employee',
  date: 'Service date',
  service: 'Service name',
  minutes: 'Time with the customer',
  customer: 'Customer code',
  status: 'Status',
  ignore: 'Do not import',
};

/** A file is not usable until it has these. */
export const REQUIRED_ROLES: ColumnRole[] = ['employee', 'date'];

export const MAX_ROWS = 20000;
export const CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === '\n' || c === '\r')) break;
    else if (!inQuotes && c in counts) counts[c] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** CSV text into rows of cells. Handles quoted cells (with commas, doubled quotes and line breaks inside),
 * CRLF or LF line ends, a leading byte-order mark, and a comma, semicolon, tab or pipe between cells. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type Table = { headers: string[]; rows: string[][]; blankRows: number };

/** The first row is the column names; empty rows are dropped. Throws a sentence the person can act on when the file
 * cannot be used. */
export function readTable(text: string): Table {
  const all = parseCsv(text);
  const nonBlank = all.filter(r => r.some(c => c.trim() !== ''));
  if (nonBlank.length === 0) throw new Error('The file is empty.');
  const head = nonBlank[0].map(h => h.trim());
  if (head.length < 2) throw new Error('This does not look like a table. The first row should be the column names, separated by commas.');
  const seen = new Map<string, number>();
  const headers = head.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const body = nonBlank.slice(1);
  if (body.length === 0) throw new Error('The file has column names but no rows.');
  if (body.length > MAX_ROWS) throw new Error(`The file has ${body.length} rows. Import at most ${MAX_ROWS} at a time: split it by month.`);
  const rows = body.map(r => headers.map((_, i) => (r[i] ?? '').trim()));
  return { headers, rows, blankRows: all.length - nonBlank.length };
}

// ---------------------------------------------------------------------------
// Guessing what each column is
// ---------------------------------------------------------------------------

/** A guess at each column's use from its name, so most files need no changes. Each use is given to one column only. */
export function guessRoles(headers: string[]): ColumnRole[] {
  const taken = new Set<ColumnRole>();
  return headers.map(raw => {
    const h = raw.toLowerCase();
    let role: ColumnRole = 'ignore';
    if (/\bdate\b|\bday\b|appointment|booked on|\bwhen\b/.test(h) && !/duration|time with/.test(h)) role = 'date';
    else if (/duration|minutes|\bmins?\b|\bhours?\b|\bhrs?\b|length|time spent|time with/.test(h)) role = 'minutes';
    else if (/status|outcome|\bstate\b/.test(h)) role = 'status';
    else if (/(customer|client|guest|patient|member)\b.*(id|code|no|number|ref|#)/.test(h) || /^(customer|client|guest|patient|member)\s*(id|code|no|number|ref)$/.test(h)) role = 'customer';
    else if (/(customer|client|guest|patient|member|phone|mobile|email|e-mail|address)/.test(h)) role = 'ignore';
    else if (/staff|employee|therapist|provider|stylist|practitioner|technician|doctor|consultant|served by|assigned|performed by|worker|operator/.test(h)) role = 'employee';
    else if (/service|treatment|procedure|item|product|\btype\b/.test(h)) role = 'service';
    if (role !== 'ignore' && taken.has(role)) role = 'ignore';
    if (role !== 'ignore') taken.add(role);
    return role;
  });
}

/** Whether a time column is in hours rather than minutes, from its name. */
export function guessUnit(header: string): 'minutes' | 'hours' {
  return /\bhours?\b|\bhrs?\b/i.test(header) ? 'hours' : 'minutes';
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

export type DateOrder = 'dmy' | 'mdy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

const fullYear = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

/** A date as YYYY-MM-DD, or null when it is not understood. Takes 2026-11-18, 18/11/2026, 18-11-26, 18.11.2026, 18 Nov
 * 2026 and Nov 18, 2026. For a day/month/year with numbers on both sides, `order` says which comes first. */
export function parseDate(text: string, order: DateOrder = 'dmy'): string | null {
  const s = text.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ,].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4}|\d{2})(?:[T ,].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return order === 'dmy' ? iso(fullYear(m[3]), b, a) : iso(fullYear(m[3]), a, b);
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return mo > 0 ? iso(fullYear(m[3]), mo, Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return mo > 0 ? iso(Number(m[3]), mo, Number(m[2])) : null;
  }
  return null;
}

/** Which order a file's numeric dates are written in, from the dates themselves: one with a first number above 12 is
 * day first, one with a second number above 12 is month first. `ambiguous` is true when no date settles it (the
 * person is asked to confirm; day first is the default). */
export function detectDateOrder(values: string[]): { order: DateOrder; ambiguous: boolean } {
  let dmy = false;
  let mdy = false;
  let numeric = false;
  for (const v of values) {
    const m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4}|\d{2})/.exec(v.trim());
    if (!m) continue;
    numeric = true;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (mdy && !dmy) return { order: 'mdy', ambiguous: false };
  if (dmy && !mdy) return { order: 'dmy', ambiguous: false };
  return { order: 'dmy', ambiguous: numeric && !dmy && !mdy };
}

export type Minutes = { minutes: number | null; bad: boolean };

/** Time with the customer, in whole minutes. Empty is fine (it means unknown). Understood: 90, "90 min", "1.5 h",
 * a bare 1.5 when the column is in hours, and "1:30" or "01:30:00" (hours and minutes). Anything else, such as
 * "1h 30m", or a time under a minute or over a day, is bad. */
export function parseMinutes(text: string, unit: 'minutes' | 'hours'): Minutes {
  const s = text.trim();
  if (!s) return { minutes: null, bad: false };
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return fit(Number(m[1]) * 60 + Number(m[2]));
  m = /^(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)?$/i.exec(s);
  if (!m) return { minutes: null, bad: true };
  const n = Number(m[1].replace(',', '.'));
  const suffix = (m[2] ?? '').toLowerCase();
  const hours = suffix ? suffix.startsWith('h') : unit === 'hours';
  return fit(Math.round(hours ? n * 60 : n));
}

function fit(minutes: number): Minutes {
  return minutes >= 1 && minutes <= 1440 ? { minutes, bad: false } : { minutes: null, bad: true };
}

// ---------------------------------------------------------------------------
// Matching names to employees
// ---------------------------------------------------------------------------

export type EmployeeRef = { id: string; name: string; employee_code?: string | null; status?: string };

const TITLES = /\b(dr|mr|mrs|ms|miss|sir|madam|mx|prof)\b\.?/g;
const normalize = (name: string) => name.toLowerCase().replace(TITLES, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The employee a name in the file means, or null when it is unknown or could mean more than one person. Tries, in
 * order: the employee code, the full name, a first name and last initial ("Pratima K."), and a first name that only
 * one employee has. Titles such as "Dr." are ignored and case does not matter.
 */
export function matchEmployee(raw: string, people: EmployeeRef[]): string | null {
  const text = raw.trim();
  if (!text) return null;
  const byCode = people.filter(p => p.employee_code && p.employee_code.trim().toLowerCase() === text.toLowerCase());
  if (byCode.length === 1) return byCode[0].id;
  const n = normalize(text);
  if (!n) return null;
  const full = people.filter(p => normalize(p.name) === n);
  if (full.length === 1) return full[0].id;
  if (full.length > 1) return null;
  const parts = n.split(' ');
  const first = parts[0];
  const initial = parts.length > 1 && parts[parts.length - 1].length === 1 ? parts[parts.length - 1] : null;
  const sameFirst = people.filter(p => normalize(p.name).split(' ')[0] === first);
  if (initial) {
    const hit = sameFirst.filter(p => {
      const ps = normalize(p.name).split(' ');
      return ps.length > 1 && ps[ps.length - 1].startsWith(initial);
    });
    return hit.length === 1 ? hit[0].id : null;
  }
  if (parts.length === 1) return sameFirst.length === 1 ? sameFirst[0].id : null;
  return null;
}

// ---------------------------------------------------------------------------
// Working out what would be imported
// ---------------------------------------------------------------------------

export type Mapping = {
  roles: ColumnRole[];
  unit: 'minutes' | 'hours';
  dateOrder: DateOrder;
  /** The status values that count as a service performed. Null when no column is used for status. */
  counted: Set<string> | null;
};

export type ImportRow = { employeeId: string; date: string; service: string | null; minutes: number | null; customer: string | null };

export type Analysis = {
  /** The columns that are needed and not chosen. */
  missing: ColumnRole[];
  rows: ImportRow[];
  counts: {
    read: number;
    import: number;
    notCounted: number;
    noName: number;
    skippedByChoice: number;
    unmatched: number;
    badDate: number;
    badTime: number;
    future: number;
  };
  /** Names in the file that are not recognised, with how many rows each has, most first. */
  unmatchedNames: { name: string; rows: number }[];
  firstDate: string | null;
  lastDate: string | null;
};

const indexOfRole = (roles: ColumnRole[], role: ColumnRole) => roles.indexOf(role);

/** Every row of the file, sorted into what will be imported and why the others will not. `nameMap` holds the person
 * picked for a name the file uses ('skip' leaves those rows out). `today` is the Nepal date; a service cannot be
 * dated after it. */
export function analyse(table: Table, mapping: Mapping, people: EmployeeRef[], nameMap: Record<string, string>, today: string): Analysis {
  const { roles } = mapping;
  const missing = REQUIRED_ROLES.filter(r => indexOfRole(roles, r) === -1);
  const c = { read: table.rows.length, import: 0, notCounted: 0, noName: 0, skippedByChoice: 0, unmatched: 0, badDate: 0, badTime: 0, future: 0 };
  const result: Analysis = { missing, rows: [], counts: c, unmatchedNames: [], firstDate: null, lastDate: null };
  if (missing.length > 0) return result;

  const iEmp = indexOfRole(roles, 'employee');
  const iDate = indexOfRole(roles, 'date');
  const iSvc = indexOfRole(roles, 'service');
  const iMin = indexOfRole(roles, 'minutes');
  const iCust = indexOfRole(roles, 'customer');
  const iStat = indexOfRole(roles, 'status');
  const matched = new Map<string, string | null>();
  const unknown = new Map<string, number>();

  for (const row of table.rows) {
    if (iStat !== -1 && mapping.counted && !mapping.counted.has(row[iStat])) {
      c.notCounted += 1;
      continue;
    }
    const name = row[iEmp];
    if (!name) {
      c.noName += 1;
      continue;
    }
    if (nameMap[name] === 'skip') {
      c.skippedByChoice += 1;
      continue;
    }
    let employeeId: string | null = nameMap[name] ?? null;
    if (!employeeId) {
      if (!matched.has(name)) matched.set(name, matchEmployee(name, people));
      employeeId = matched.get(name) ?? null;
    }
    if (!employeeId) {
      c.unmatched += 1;
      unknown.set(name, (unknown.get(name) ?? 0) + 1);
      continue;
    }
    const date = parseDate(row[iDate], mapping.dateOrder);
    if (!date) {
      c.badDate += 1;
      continue;
    }
    if (date > today) {
      c.future += 1;
      continue;
    }
    let minutes: number | null = null;
    if (iMin !== -1) {
      const t = parseMinutes(row[iMin], mapping.unit);
      if (t.bad) {
        c.badTime += 1;
        continue;
      }
      minutes = t.minutes;
    }
    const service = iSvc !== -1 ? row[iSvc].replace(/\s+/g, ' ').trim().slice(0, 120) || null : null;
    const customer = iCust !== -1 ? row[iCust] || null : null;
    result.rows.push({ employeeId, date, service, minutes, customer });
    if (!result.firstDate || date < result.firstDate) result.firstDate = date;
    if (!result.lastDate || date > result.lastDate) result.lastDate = date;
  }
  c.import = result.rows.length;
  result.unmatchedNames = [...unknown.entries()].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
  return result;
}

/** The different values in a status column and how many rows have each, most common first. */
export function distinctValues(table: Table, column: number): { value: string; rows: number }[] {
  const counts = new Map<string, number>();
  for (const r of table.rows) counts.set(r[column], (counts.get(r[column]) ?? 0) + 1);
  return [...counts.entries()].map(([value, rows]) => ({ value, rows })).sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value));
}

/** Which status values count by default: the ones that sound finished ("Completed", "Done", "Attended"). When none do,
 * every value counts, so nothing is dropped by surprise. */
export function defaultCounted(values: string[]): Set<string> {
  const done = values.filter(v => /^(complet|done|finish|attend|served|paid|closed|checked)/i.test(v.trim()));
  return new Set(done.length > 0 ? done : values);
}

/** True when the sample values of a "customer code" column look like names, phone numbers or email addresses, so the
 * person can be warned before anything is sent. */
export function looksLikePersonalData(samples: string[]): boolean {
  const filled = samples.map(s => s.trim()).filter(Boolean).slice(0, 50);
  if (filled.length === 0) return false;
  const personal = filled.filter(s => s.includes('@') || /^\+?\d[\d\s-]{8,}$/.test(s) || /^[A-Za-z][A-Za-z.'-]*( [A-Za-z][A-Za-z.'-]*)+$/.test(s));
  return personal.length / filled.length >= 0.4;
}

// ---------------------------------------------------------------------------
// What is sent
// ---------------------------------------------------------------------------

/** A customer's ID, scrambled: the same customer always gives the same code, within one company, but the ID cannot
 * be read back. Done in the browser, so the ID never leaves it. */
export async function customerKey(code: string, companyId: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('This browser cannot scramble customer codes, so the import was stopped.');
  const bytes = new TextEncoder().encode(`${companyId}|${code.trim().toLowerCase()}`);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export type ServiceRecord = {
  import_id: string;
  employee_id: string;
  performed_on: string;
  service: string | null;
  minutes: number | null;
  customer_key: string | null;
  row_key: string;
};

/** The rows to store. `row_key` says which service a row is, so a second export that repeats it is not counted twice:
 * the employee, the day, the service, the time and the customer, and which of several identical rows it is. */
export async function buildRecords(rows: ImportRow[], companyId: string, importId: string): Promise<ServiceRecord[]> {
  const seen = new Map<string, number>();
  const out: ServiceRecord[] = [];
  for (const r of rows) {
    const key = r.customer ? await customerKey(r.customer, companyId) : null;
    const base = [r.employeeId, r.date, r.service ?? '', r.minutes ?? '', key ?? ''].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ import_id: importId, employee_id: r.employeeId, performed_on: r.date, service: r.service, minutes: r.minutes, customer_key: key, row_key: `${companyId}|${base}|${n}` });
  }
  return out;
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
