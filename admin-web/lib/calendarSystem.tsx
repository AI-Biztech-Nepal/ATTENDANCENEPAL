'use client';

import { createContext, useContext, useState } from 'react';
import type { CalendarSystem } from './calendar';

const CalendarSystemContext = createContext<{
  system: CalendarSystem;
  setSystem: (system: CalendarSystem) => void;
}>({ system: 'BS', setSystem: () => {} });

/** BS (Bikram Sambat) is the calendar for the whole admin site. Every load
 * starts in BS — the AD/BS switch in the page header still works for an
 * ad-hoc look at Gregorian dates, but the choice is deliberately NOT
 * persisted: a refresh (or a new tab) always comes back to BS. It does
 * survive client-side navigation within one session, since this provider
 * stays mounted at the layout level. */
export function CalendarSystemProvider({ children }: { children: React.ReactNode }) {
  const [system, setSystem] = useState<CalendarSystem>('BS');

  return <CalendarSystemContext.Provider value={{ system, setSystem }}>{children}</CalendarSystemContext.Provider>;
}

/** The one global AD/BS choice — every date field and every displayed date
 * across the app reads and writes this same value, so switching it once
 * (from the switch in the page header) changes everything at once. */
export function useCalendarSystem() {
  return useContext(CalendarSystemContext);
}
