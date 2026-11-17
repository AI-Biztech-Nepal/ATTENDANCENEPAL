'use client';

export type CalendarView = 'calendar' | 'log';

const OPTIONS: { value: CalendarView; label: string; icon: string }[] = [
  // A month grid, and a list of rows.
  { value: 'calendar', label: 'Calendar', icon: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4' },
  { value: 'log', label: 'Daily log', icon: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' },
];

/** The Calendar / Daily log switch, two icons — one is showing at a time. It sits
 * on the month stepper's row. `boxed` is for the owner console's white page (same
 * look as its AD/BS switch); `hero` is for the employee pages' green header, with
 * 44px touch targets to match the stepper beside it. */
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
      className={hero ? 'flex shrink-0 rounded-[14px] bg-white/15 p-1' : 'inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-300 shadow-sm'}
    >
      {OPTIONS.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            aria-label={o.label}
            title={o.label}
            className={
              hero
                ? `flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${on ? 'bg-white text-brand' : 'text-white hover:bg-white/10'}`
                : `flex h-8 w-9 items-center justify-center transition-colors ${on ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`
            }
          >
            <svg viewBox="0 0 24 24" className={hero ? 'h-5 w-5' : 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={o.icon} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
