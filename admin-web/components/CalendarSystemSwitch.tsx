'use client';

import { useCalendarSystem } from '@/lib/calendarSystem';

/** The one AD/BS switch for the whole app — lives next to the page title.
 * `pill` is the owner top bar's rounded version. */
export default function CalendarSystemSwitch({ variant = 'boxed' }: { variant?: 'boxed' | 'pill' | 'onDark' }) {
  const { system, setSystem } = useCalendarSystem();

  // The employee pages' version, for the green sidebar / header: a translucent
  // track with a white active segment. The buttons stretch, so in the sidebar
  // (a full-width parent) it fills the row.
  if (variant === 'onDark') {
    return (
      <div className="flex shrink-0 rounded-full bg-white/15 p-[3px]">
        {(['AD', 'BS'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSystem(s)}
            aria-pressed={system === s}
            title={s === 'AD' ? 'Gregorian calendar' : 'Nepali (Bikram Sambat) calendar'}
            className={`h-[38px] flex-1 rounded-full px-3.5 text-xs transition-colors ${
              system === s ? 'bg-white font-extrabold text-brand' : 'font-bold text-white hover:bg-white/10'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div className="flex shrink-0 rounded-full bg-slate-100 p-[3px]">
        {(['AD', 'BS'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSystem(s)}
            title={s === 'AD' ? 'Gregorian calendar' : 'Nepali (Bikram Sambat) calendar'}
            className={`rounded-full px-[13px] py-[7px] text-xs transition-colors ${
              system === s ? 'bg-brand font-extrabold text-white' : 'font-bold text-[#586474] hover:text-ink'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center">
      <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold shadow-sm sm:text-base">
        <button
          type="button"
          onClick={() => setSystem('AD')}
          title="Gregorian calendar"
          className={`px-3 py-1.5 transition-colors sm:px-5 sm:py-2 ${
            system === 'AD' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          AD
        </button>
        <button
          type="button"
          onClick={() => setSystem('BS')}
          title="Nepali (Bikram Sambat) calendar"
          className={`px-3 py-1.5 transition-colors sm:px-5 sm:py-2 ${
            system === 'BS' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          BS
        </button>
      </div>
    </div>
  );
}
