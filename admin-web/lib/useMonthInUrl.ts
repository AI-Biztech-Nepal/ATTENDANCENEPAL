'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/** Keeps the month on screen in the address (`?date=`, the month's first day), so the other sections of a person's KPIs,
 * and the way back to the list, open on the same month. Replaces the address; it does not add a history entry.
 * Next.js passes the change on to useSearchParams only when the history state is `null` (see "Shallow routing"). */
export function useMonthInUrl(start: string) {
  const current = useSearchParams().get('date');
  useEffect(() => {
    if (current === start) return;
    const params = new URLSearchParams(window.location.search);
    params.set('date', start);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [start, current]);
}
