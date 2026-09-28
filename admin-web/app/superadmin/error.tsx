'use client';

// Scoped to /superadmin only — a crash here can never reach any tenant-facing
// page, since Next.js renders each route independently. This just keeps the
// failure visible and small instead of a blank page.
export default function SuperadminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium text-critical">Something went wrong in the superadmin panel.</p>
      <p className="max-w-md text-xs text-slate-500">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
      >
        Try again
      </button>
    </div>
  );
}
