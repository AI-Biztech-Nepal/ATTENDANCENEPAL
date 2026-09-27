const TONES = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200/60 shadow-sm shadow-emerald-500/5',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/60 shadow-sm shadow-amber-500/5',
  critical: 'bg-rose-50 text-rose-700 border-rose-200/60 shadow-sm shadow-rose-500/5',
  info: 'bg-sky-50 text-sky-700 border-sky-200/60 shadow-sm shadow-sky-500/5',
  neutral: 'bg-slate-50 text-slate-700 border-slate-200/60 shadow-sm shadow-slate-500/5',
} as const;

export default function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest backdrop-blur-md ${TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone === 'good' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : tone === 'critical' ? 'bg-rose-500' : tone === 'info' ? 'bg-sky-500' : 'bg-slate-400'}`} />
      {children}
    </span>
  );
}
