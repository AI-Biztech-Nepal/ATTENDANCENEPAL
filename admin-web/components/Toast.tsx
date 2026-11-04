'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastApi = { show: (text: string) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });

const VISIBLE_MS = 3000;

/** A small message that pops up at the top right and goes away by itself — for "it worked" feedback that
 * needs no answer. Mounted once at the root (app/layout.tsx); any page calls `useToast().show('Saved')`.
 * A second message replaces the first instead of stacking. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, text });
    timer.current = setTimeout(() => setToast(current => (current?.id === id ? null : current)), VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        // Below the top bar, so it never covers the bell or the account menu.
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed right-4 top-20 z-[100] flex items-center gap-2 rounded-xl border border-good/30 bg-white px-4 py-3 text-sm font-semibold text-good-text shadow-[0_8px_30px_rgba(15,23,42,0.16)]"
        >
          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-good-bg text-xs font-extrabold">
            ✓
          </span>
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
