import { formatAdDate } from '@/lib/calendar';
import type { CalendarSystem } from '@/lib/calendar';
import type { Employee } from '@/lib/types';

export type SalaryFigures = {
  basic: number | null;
  allowance: number;
  gross: number | null;
  pfAmt: number | null;
  ssfAmt: number | null;
  tdsAmt: number | null;
  overtimeAmt: number | null;
  net: number | null;
};

/** Turns an employee's stored Basic / Allowance plus the company-wide
 * PF / SSF / TDS / Overtime percentages into the figures every salary view
 * shows. One place so the list page, the per-employee page and any export
 * never drift apart. Overtime here is a flat allowance (ADDED to Net
 * Payable), not the real attendance-based overtime pay computed elsewhere
 * from actual hours worked — the two are intentionally different numbers. */
export function computeSalaryFigures(
  salary: number | null,
  allowanceRaw: number | null,
  pf: number,
  ssf: number,
  tds: number,
  overtimeRate: number = 0
): SalaryFigures {
  const allowance = allowanceRaw ?? 0;
  if (salary == null) {
    return { basic: null, allowance, gross: null, pfAmt: null, ssfAmt: null, tdsAmt: null, overtimeAmt: null, net: null };
  }
  const pfAmt = Math.round((salary * pf) / 100);
  const ssfAmt = Math.round((salary * ssf) / 100);
  const tdsAmt = Math.round((salary * tds) / 100);
  const overtimeAmt = Math.round((salary * overtimeRate) / 100);
  const gross = salary + allowance;
  return { basic: salary, allowance, gross, pfAmt, ssfAmt, tdsAmt, overtimeAmt, net: gross - pfAmt - ssfAmt - tdsAmt + overtimeAmt };
}

export type BreakdownLine = { label: string; value: number | null; sign?: '+' | '−'; strong?: boolean };

export function salaryBreakdownLines(f: SalaryFigures, pf: number, ssf: number, tds: number, overtimeRate: number = 0): BreakdownLine[] {
  return [
    { label: 'Basic', value: f.basic },
    { label: 'Allowance', value: f.allowance, sign: '+' },
    { label: 'Gross Pay', value: f.gross, strong: true },
    { label: `PF (${pf}% of basic)`, value: f.pfAmt, sign: '−' },
    { label: `SSF by Employer (${ssf}% of basic)`, value: f.ssfAmt, sign: '−' },
    { label: `SSF by Employee (${tds}% of basic)`, value: f.tdsAmt, sign: '−' },
    { label: `Overtime allowance (${overtimeRate}% of basic)`, value: f.overtimeAmt, sign: '+' },
    { label: 'Net Payable', value: f.net, strong: true },
  ];
}

function money(n: number | null, divide: boolean, daysInMonth: number) {
  if (n == null) return '—';
  const v = divide ? n / daysInMonth : n;
  return v.toLocaleString(undefined, { maximumFractionDigits: divide ? 2 : 0 });
}

/** Employee identifiers + a Basic→Net Payable table with per-month and
 * per-day columns side by side. Used on the per-employee Salary Structure
 * page and printed as-is. */
export default function SalaryBreakdown({
  employee,
  figures,
  pf,
  ssf,
  tds,
  overtimeRate = 0,
  daysInMonth,
  monthLabel,
  system,
}: {
  employee: Employee;
  figures: SalaryFigures;
  pf: number;
  ssf: number;
  tds: number;
  overtimeRate?: number;
  daysInMonth: number;
  monthLabel: string;
  system: CalendarSystem;
}) {
  const meta: [string, string][] = [
    ['Employee code', employee.employee_code || '—'],
    ['Enroll ID', employee.fingerprint_id || '—'],
    ['Designation', employee.designation || '—'],
    ['Department', employee.department || '—'],
    ['Date of joining', employee.date_of_joining ? formatAdDate(employee.date_of_joining, system) : '—'],
    ['PAN no', employee.pan_no || '—'],
    ['SSF no', employee.ssf_no || '—'],
  ];

  const lines = salaryBreakdownLines(figures, pf, ssf, tds, overtimeRate);

  return (
    <div className="grid gap-5 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-2 print:border-slate-300 print:shadow-none">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Employee details</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-400">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Salary breakdown</div>
        <table className="w-full tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1 text-left font-medium">Component</th>
              <th className="py-1 text-right font-medium">Per month</th>
              <th className="py-1 text-right font-medium">Per day</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr
                key={l.label}
                className={l.strong ? 'border-t border-slate-200 font-semibold text-ink' : 'text-slate-600'}
              >
                <td className="py-1 text-left">
                  {l.sign && <span className="mr-0.5 text-slate-400">{l.sign}</span>}
                  {l.label}
                </td>
                <td className="py-1 text-right">{money(l.value, false, daysInMonth)}</td>
                <td className="py-1 text-right">{money(l.value, true, daysInMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-400">
          Per-day = per-month ÷ {daysInMonth} days ({monthLabel} has {daysInMonth} days)
        </p>
      </div>
    </div>
  );
}
