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
 * exclusion design in resolveShiftForDate(), lib/shift.ts). Lives in the
 * Shifts page's Roster view, labelled "Active roster" there — a data-model
 * flag, distinct from the Weekly Pattern/Monthly Roster tabs beside it,
 * which only decide which grid you're LOOKING AT and never touch this.
 * Picking the mode already active is a no-op; picking the other confirms
 * first, since it changes what every admin and every employee's attendance
 * sees. Writes straight to the database (there's nothing to stage) and calls
 * onChange so the page (and any other open tab) reflects it immediately. */
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
      {/* Controlled by `mode`, not by what's picked — pick() only calls
          onChange after the confirm succeeds and the write lands, so a
          cancelled or failed switch leaves this showing the mode still
          actually in use, same as the confirm dialog it used to gate a
          button-pair with. */}
      <select
        value={mode}
        disabled={saving}
        onChange={e => pick(e.target.value as RosterMode)}
        title={MODE_COPY[mode === 'weekly' ? 'monthly' : 'weekly'].confirm}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {(Object.keys(MODE_COPY) as RosterMode[]).map(key => (
          <option key={key} value={key}>
            {MODE_COPY[key].label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-critical">Could not switch: {error}</span>}
    </div>
  );
}
