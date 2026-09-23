'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useConfirm } from '@/components/ConfirmDialog';
import type { RosterMode } from '@/lib/weekOff';

const MODE_COPY: Record<RosterMode, { label: string; confirm: string }> = {
  weekly: {
    label: 'Weekly Roster',
    confirm:
      'Switch to the Weekly Roster? Every employee will follow the same recurring Sun–Sat pattern from now on, instead ' +
      'of exact dates. The Monthly Roster is kept, not deleted — switching back restores it.',
  },
  monthly: {
    label: 'Monthly Roster',
    confirm:
      'Switch to the Monthly Roster? Shifts will follow the exact dates filled in on the grid instead of a repeating ' +
      'pattern. The Weekly Roster is kept, not deleted — switching back restores it.',
  },
};

/** The one control for companies.roster_mode — a company-wide setting that
 * decides which of two independent data models actually drives real
 * attendance/payroll shift resolution (see the Weekly/Monthly mutual-
 * exclusion design in resolveShiftForDate(), lib/shift.ts). Lives once in
 * the Shifts page header, in its own bubble separate from the Shift
 * Templates control — this is what's "in use", a data-model flag, not a
 * view you're merely looking at. Picking the option already in use just
 * shows that roster; picking the other one confirms first, since it changes
 * what every admin and every employee's attendance sees. Writes straight to
 * the database (there's nothing to stage) and calls onChange so the page
 * (and any other open tab) shows the new roster immediately. */
export default function RosterModeSwitch({
  companyId,
  mode,
  onChange,
}: {
  companyId: string | null;
  mode: RosterMode;
  onChange: (mode: RosterMode) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function pick(next: RosterMode) {
    // No-op while the company is still loading (briefly true on first
    // paint) rather than optimistically flipping the view without anything
    // to actually persist the switch to.
    if (next === mode || saving || !companyId) return;
    if (!(await confirm(MODE_COPY[next].confirm, { title: 'Use this roster instead?', confirmLabel: `Switch to ${MODE_COPY[next].label}` }))) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from('companies').update({ roster_mode: next }).eq('id', companyId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onChange(next);
  }

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {(Object.keys(MODE_COPY) as RosterMode[]).map(key => {
          const active = mode === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
              disabled={saving}
              title={active ? undefined : MODE_COPY[key].confirm}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-white/80' : 'border border-slate-400'}`} />
              {MODE_COPY[key].label}
            </button>
          );
        })}
      </div>
      {error && <span className="text-xs text-critical">Could not switch: {error}</span>}
    </div>
  );
}
