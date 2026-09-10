'use client';

/** Which optional columns the payroll pages show — the monthly Payroll
 * report, the Staff Salary Sheet, and the Salary Structure table itself.
 * The switches all live in one place, the cog above the Salary Structure
 * table; every other surface only reads the value. Persisted in localStorage rather than the
 * database — it's a display preference, it needs no migration, and it takes
 * effect the moment it's toggled. Same-origin, so both the Salary Structure
 * page and the Payroll report (and every tab) read the one value, and the
 * `storage` event lets an open Payroll tab update live when it's changed. */
export type PayrollReportColumns = {
  // Attendance columns on the Payroll report / Staff Salary Sheet.
  workedDays: boolean;
  totalHours: boolean;
  overtime: boolean;
  lateEarly: boolean;
  // Contribution columns on the Salary Structure table. Hiding one takes it
  // out of the table and its printed / Excel copy; it does NOT change Net
  // Payable, which still deducts the amount. They exist for companies that
  // run a rate at 0 and do not want a column of zeroes.
  pf: boolean;
  ssfEmployer: boolean;
  ssfEmployee: boolean;
  /** No switch of its own anymore — always shown — but kept so the Payroll
   * report's existing `visibleCols.deductions` checks still resolve. */
  deductions: boolean;
};

export const DEFAULT_PAYROLL_REPORT_COLUMNS: PayrollReportColumns = {
  // Worked Days is the figure people actually check; Total Hours is a second,
  // noisier cut of the same attendance and starts hidden. Both are one tap
  // away in the column cog.
  workedDays: true,
  totalHours: false,
  overtime: true,
  lateEarly: true,
  deductions: true,
  pf: true,
  ssfEmployer: true,
  ssfEmployee: true,
};

export const PAYROLL_REPORT_COLUMNS_KEY = 'payrollReportColumns';

/** Coerce anything (a parsed localStorage blob, possibly stale or partial)
 * into a full PayrollReportColumns — each missing/!boolean key falls back to
 * its default (all shown except Total Hours). */
export function normalizePayrollReportColumns(raw: unknown): PayrollReportColumns {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const pick = (k: keyof PayrollReportColumns) =>
    typeof obj[k] === 'boolean' ? (obj[k] as boolean) : DEFAULT_PAYROLL_REPORT_COLUMNS[k];
  return {
    workedDays: pick('workedDays'),
    totalHours: pick('totalHours'),
    overtime: pick('overtime'),
    lateEarly: pick('lateEarly'),
    deductions: pick('deductions'),
    pf: pick('pf'),
    ssfEmployer: pick('ssfEmployer'),
    ssfEmployee: pick('ssfEmployee'),
  };
}

/** Read the saved choice. Safe on the server and in a locked-down browser —
 * returns the all-shown default if localStorage is unavailable or empty. */
export function loadPayrollReportColumns(): PayrollReportColumns {
  try {
    const raw = localStorage.getItem(PAYROLL_REPORT_COLUMNS_KEY);
    if (!raw) return DEFAULT_PAYROLL_REPORT_COLUMNS;
    return normalizePayrollReportColumns(JSON.parse(raw));
  } catch {
    return DEFAULT_PAYROLL_REPORT_COLUMNS;
  }
}

/** Persist the choice. No-ops if localStorage can't be written. */
export function savePayrollReportColumns(cols: PayrollReportColumns): void {
  try {
    localStorage.setItem(PAYROLL_REPORT_COLUMNS_KEY, JSON.stringify(cols));
  } catch {
    /* private mode / storage disabled — the in-memory state still applies for this session */
  }
}
