export default function AuthCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center overflow-y-auto bg-slate-50 py-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl animate-float">
        <div className="mb-3 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Attendance Nepal" className="mb-1.5 h-36 w-36 shrink-0" />
          <span className="text-lg font-bold text-ink">Attendance Nepal</span>
          {title && <span className="text-xs text-slate-500">{title}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}
