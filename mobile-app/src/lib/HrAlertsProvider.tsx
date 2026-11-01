import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useCalendarSystem } from './CalendarSystemContext';
import { useHrAlerts, type BirthdayAlert, type ContractAlert } from './hrAlerts';

type HrAlertsValue = { contracts: ContractAlert[]; birthdays: BirthdayAlert[]; refresh: () => void };

const HrAlertsContext = createContext<HrAlertsValue>({ contracts: [], birthdays: [], refresh: () => {} });

/** Contracts ending and upcoming birthdays, loaded once for the owner's bell — the header
 * is rendered by several stacks, and each should read the same list rather than fetch its own. */
export function HrAlertsProvider({ children }: { children: React.ReactNode }) {
  const { system } = useCalendarSystem();
  const [refreshKey, setRefreshKey] = useState(0);
  const { contracts, birthdays } = useHrAlerts(system, refreshKey);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);
  const value = useMemo(() => ({ contracts, birthdays, refresh }), [contracts, birthdays, refresh]);
  return <HrAlertsContext.Provider value={value}>{children}</HrAlertsContext.Provider>;
}

export function useSharedHrAlerts() {
  return useContext(HrAlertsContext);
}
