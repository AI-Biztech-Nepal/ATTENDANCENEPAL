'use client';

export type CalendarView = 'calendar' | 'log';

const OPTIONS: { value: CalendarView; label: string; icon: string }[] = [
  // A month grid, and a list of rows.
  { value: 'calendar', label: 'Calendar', icon: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4' },
  { value: 'log', label: 'Daily log', icon: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' },
];

/** The Calendar / Daily log switch — one is showing at a time. `boxed` sits on the
 * owner console's white page (same look as its AD/BS switch); `hero` sits on the
 * employee pages' green header, with 44px touch targets that fill the row. */
export default function CalendarViewSwitch({
  value,
  onChange,
  variant = 'boxed',
}: {
  value: CalendarView;
  onChange: (view: CalendarView) => void;
  variant?: 'boxed' | 'hero';
}) {
  const hero = variant === 'hero';
  return (
    <div
      role="group"
      aria-label="Calendar view"
      className={hero ? 'flex rounded-[14px] bg-white/15 p-1' : 'inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold shadow-sm'}
    >
      {OPTIONS.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={
              hero
                ? `flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm transition-colors ${on ? 'bg-white font-extrabold text-brand' : 'font-bold text-white hover:bg-white/10'}`
                : `flex items-center gap-2 px-4 py-2 transition-colors ${on ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`
            }
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={o.icon} />
            </svg>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
