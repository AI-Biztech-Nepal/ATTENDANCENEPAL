import type { Shift } from './types';

/** Two sentinel cell values, distinct from any real shift_id: "no row for
 * this cell at all" (falls back to the employee's normal shift) vs. "an
 * explicit Week Off row" (shift_id stored as null) — see employee_daily_shifts'
 * design (20260806100000_employee_daily_shifts.sql). Shared by the Weekly
 * and Monthly roster grids and their paint bar. */
export const UNSET = 'unset';
export const WEEK_OFF_VALUE = 'week-off';

export type PaintOption = {
  value: string;
  label: string;
  /** 2-3 letter stand-in for `label` — the Monthly grid's cells are too
   * narrow (up to 31 to a row) for a full shift name, unlike the Weekly
   * grid's 7 wider columns, which show `label` itself, truncated. */
  abbr: string;
  /** "" for Week Off / Clear, "09:00–17:00" for a real shift. */
  sub: string;
  bg: string;
  text: string;
  dot: string;
};

/** "Day & Night Duty" -> "D&N", "Night Duty" -> "ND", "Day Duty" -> "DD" —
 * the initial of each word (an "&" keeps its own initial as itself), so two
 * differently-named shifts a company defines are still visually distinct in
 * a cell too narrow for their full names. */
function abbreviate(name: string): string {
  const letters = name
    .split(/\s+/)
    .map(w => (w === '&' ? '&' : w.charAt(0).toUpperCase()))
    .join('');
  return letters.slice(0, 3) || name.slice(0, 3).toUpperCase();
}

/** A small rotating set of Tailwind color pairs for shift-template brushes
 * and cells — distinct from the app's semantic accent/good/warning/critical
 * tokens (those mean status, not "which shift"), so an arbitrary number of
 * company-defined shift templates each get a stable, legible color of their
 * own instead of every real shift sharing one generic accent tint. */
const PALETTE = [
  { bg: 'bg-teal-100', text: 'text-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800', dot: 'bg-indigo-500' },
  { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  { bg: 'bg-rose-100', text: 'text-rose-800', dot: 'bg-rose-500' },
  { bg: 'bg-violet-100', text: 'text-violet-800', dot: 'bg-violet-500' },
  { bg: 'bg-cyan-100', text: 'text-cyan-800', dot: 'bg-cyan-500' },
  { bg: 'bg-lime-100', text: 'text-lime-800', dot: 'bg-lime-600' },
  { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
] as const;

/** Every paintable value for a company's roster: Week Off and Clear first
 * (always in the same place regardless of how many templates exist), then
 * each real shift template in a stable color. `shifts` should already be
 * template-only (employee_id === null). */
export function buildPaintOptions(templateShifts: Shift[]): PaintOption[] {
  return [
    { value: WEEK_OFF_VALUE, label: 'Week Off', abbr: 'Off', sub: '', bg: 'bg-warning-bg', text: 'text-warning-text', dot: 'bg-warning' },
    { value: UNSET, label: 'Clear', abbr: '', sub: '', bg: 'bg-white', text: 'text-slate-500', dot: '' },
    ...templateShifts.map((s, i) => {
      const c = PALETTE[i % PALETTE.length];
      return {
        value: s.id,
        label: s.name,
        abbr: abbreviate(s.name),
        sub: `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
        bg: c.bg,
        text: c.text,
        dot: c.dot,
      };
    }),
  ];
}

/** The department each employee sorts into for grouping — free-text, so an
 * unset one is bucketed together rather than splitting into many one-person
 * "null" groups. */
export function departmentOf(employee: { department: string | null }): string {
  return employee.department?.trim() || 'Unassigned';
}
