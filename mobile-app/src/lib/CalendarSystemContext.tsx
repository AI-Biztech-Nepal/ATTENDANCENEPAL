import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarSystem } from './calendar';

const STORAGE_KEY = 'attendance-nepal-calendar-system';

const CalendarSystemContext = createContext<{ system: CalendarSystem; setSystem: (system: CalendarSystem) => void }>({
  system: 'BS',
  setSystem: () => {},
});

export function CalendarSystemProvider({ children }: { children: React.ReactNode }) {
  // BS (Nepali calendar) is the default for a first-time user — AD stays
  // fully available via the switch, this only changes what's selected
  // before anyone's ever touched it. Anyone who already picked AD before
  // (or picks it going forward) keeps that choice via AsyncStorage below,
  // same as always.
  const [system, setSystemState] = useState<CalendarSystem>('BS');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored === 'AD' || stored === 'BS') setSystemState(stored);
    });
  }, []);

  function setSystem(next: CalendarSystem) {
    setSystemState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }

  return <CalendarSystemContext.Provider value={{ system, setSystem }}>{children}</CalendarSystemContext.Provider>;
}

export function useCalendarSystem() {
  return useContext(CalendarSystemContext);
}
