'use client';

import { useCalendarSystem } from '@/lib/calendarSystem';

/** The one AD/BS switch for the whole app — lives next to the page title.
 * `pill` is the owner top bar's rounded version. */
export default function CalendarSystemSwitch({ variant = 'boxed' }: { variant?: 'boxed' | 'pill' }) {
  const { system, setSystem } = useCalendarSystem();

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
