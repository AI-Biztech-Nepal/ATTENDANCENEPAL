export default function StatCard({
  label,
  value,
  hint,
  icon,
  iconClassName,
  className,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  /** Overrides the icon badge's default `bg-slate-50 text-accent` — e.g. `'bg-violet-50 text-violet-600'`. */
  iconClassName?: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-5 ${
        onClick ? 'cursor-pointer text-left transition hover:border-accent hover:shadow-md' : ''
      } ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 sm:text-sm">{label}</span>
        {icon && <span className={`shrink-0 rounded-lg p-2 ${iconClassName ?? 'bg-slate-50 text-accent'}`}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold text-ink sm:mt-3 sm:text-3xl">{value}</div>
      {hint && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span className="truncate">{hint}</span>
        </div>
      )}
    </div>
  );
}
