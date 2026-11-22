'use client';

/** The month arrows with the month's name, and the same month in the other calendar underneath. Shared by
 * the KPI list and one person's KPI page. */
export default function MonthStepper({ label, subtitle, onPrevious, onNext }: {
  label: string;
  /** Under the name: the other calendar's months, and a note such as "month so far". */
  subtitle?: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <StepButton label="Previous month" onClick={onPrevious}>
        <path d="m15 6-6 6 6 6" />
      </StepButton>
      <div className="min-w-[170px]" aria-live="polite">
        <div className="text-lg font-extrabold text-ink">{label}</div>
        {subtitle && <div className="text-[12.5px] text-slate-600">{subtitle}</div>}
      </div>
      <StepButton label="Next month" onClick={onNext}>
        <path d="m9 6 6 6-6 6" />
      </StepButton>
    </div>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
