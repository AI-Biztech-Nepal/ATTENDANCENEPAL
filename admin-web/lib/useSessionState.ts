'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useState that survives a page refresh in the same browser tab
 * (sessionStorage) — so refreshing the Leave page stays on Leave Balance, and
 * the Attendance Report keeps its dates, employee and Correction mode, instead
 * of starting over. A new tab starts fresh.
 *
 * The saved value is applied right after mount, so the server render and the
 * first client render stay identical (no hydration mismatch), and a value that
 * fails `isValid` is ignored. Storage errors (private mode, blocked site data)
 * just mean nothing is remembered.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
  opts?: { enabled?: boolean; isValid?: (v: unknown) => boolean }
) {
  const enabled = opts?.enabled !== false;
  const [value, setValue] = useState<T>(initial);
  const skipFirstWrite = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw == null) return;
      const parsed: unknown = JSON.parse(raw);
      if (!opts?.isValid || opts.isValid(parsed)) setValue(parsed as T);
    } catch {
      // Nothing remembered — keep the default.
    }
    // Read once per key, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    // The first run is the initial default, before the saved value is back —
    // writing it would overwrite what we are about to restore.
    if (skipFirstWrite.current) {
      skipFirstWrite.current = false;
      return;
    }
    if (!enabled) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not remembered; the page still works.
    }
  }, [key, value, enabled]);

  return [value, setValue] as const;
}
