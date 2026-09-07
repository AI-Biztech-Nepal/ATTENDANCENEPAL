'use client';

/** Which optional columns the monthly Payroll report shows. The switches
 * live on the Salary Structure page (the cog above its table); the Payroll
 * report only reads the value. Persisted in localStorage rather than the
 * database — it's a display preference, it needs no migration, and it takes
 * effect the moment it's toggled. Same-origin, so both the Salary Structure
 * page and the Payroll report (and every tab) read the one value, and the
 * `storage` event lets an open Payroll tab update live when it's changed. */
export type PayrollReportColumns = {
  workedDays: boolean;
  totalHours: boolean;
  overtime: boolean;
  lateEarly: boolean;
  /** No switch of its own anymore — always shown — but kept so the Payroll
   * report's existing `visibleCols.deductions` checks still resolve. */
  deductions: boolean;
};

export const DEFAULT_PAYROLL_REPORT_COLUMNS: PayrollReportColumns = {
  workedDays: true,
  totalHours: true,
  overtime: true,
  lateEarly: true,
  deductions: true,
};

export const PAYROLL_REPORT_COLUMNS_KEY = 'payrollReportColumns';

/** Coerce anything (a parsed localStorage blob, possibly stale or partial)
 * into a full PayrollReportColumns — each missing/!boolean key falls back to
 * shown. */
export function normalizePayrollReportColumns(raw: unknown): PayrollReportColumns {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const pick = (k: keyof PayrollReportColumns) => (typeof obj[k] === 'boolean' ? (obj[k] as boolean) : true);
  return {
    workedDays: pick('workedDays'),
    totalHours: pick('totalHours'),
    overtime: pick('overtime'),
    lateEarly: pick('lateEarly'),
    deductions: pick('deductions'),
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
