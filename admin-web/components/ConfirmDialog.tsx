'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

type ConfirmTone = 'default' | 'danger';

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' renders the confirm button red — for anything that deletes or
   * overwrites existing data. Default is the app's normal accent color. */
  tone?: ConfirmTone;
};

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

type ConfirmState = {
  message: string;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
};

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** One shared in-app confirm dialog for the whole app, replacing the
 * browser's native window.confirm() — which renders as an OS-chrome popup
 * that looks out of place inside the desktop app shell. Mounted once at the
 * root layout; useConfirm() below gives every component a drop-in async
 * replacement (`if (!(await confirm(msg))) return;` instead of
 * `if (!confirm(msg)) return;`). Only one confirm can be open at a time,
 * same as the browser's own confirm() — a second call while one is already
 * open replaces it rather than queuing. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>(resolve => {
      resolveRef.current = resolve;
      setState({
        message,
        title: options?.title ?? 'Are you sure?',
        confirmLabel: options?.confirmLabel ?? 'Confirm',
        cancelLabel: options?.cancelLabel ?? 'Cancel',
        tone: options?.tone ?? 'default',
      });
    });
  }, []);

  function settle(value: boolean) {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="confirm-dialog-title" className="mb-2 text-lg font-semibold text-ink">
              {state.title}
            </h3>
            <p className="mb-5 whitespace-pre-line text-sm text-slate-600">{state.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                {state.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                autoFocus
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                  state.tone === 'danger' ? 'bg-critical hover:bg-critical/90' : 'bg-accent hover:bg-accent/90'
                }`}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Async in-app replacement for window.confirm(): `if (!(await confirm(msg))) return;` */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() must be used inside <ConfirmProvider>');
  return confirm;
}
