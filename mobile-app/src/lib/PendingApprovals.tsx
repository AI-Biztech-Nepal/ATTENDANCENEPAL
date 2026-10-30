import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

type Counts = { gps: number; corrections: number; leave: number };
type PendingApprovalsValue = { counts: Counts; total: number; refresh: () => void };

const EMPTY: Counts = { gps: 0, corrections: 0, leave: 0 };

const PendingApprovalsContext = createContext<PendingApprovalsValue>({ counts: EMPTY, total: 0, refresh: () => {} });

function countPending(table: string) {
  return supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .then(({ count }) => count ?? 0);
}

/** Pending GPS check-ins, missed-punch corrections and leave requests, shared
 * by the owner's Approvals tab badge and Home's "Needs your approval" card.
 * Re-counted every minute and whenever an approve/reject calls refresh(). */
export function PendingApprovalsProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Counts>(EMPTY);

  const refresh = useCallback(() => {
    Promise.all([
      countPending('attendance_gps_requests'),
      countPending('attendance_correction_requests'),
      countPending('leave_requests'),
    ]).then(([gps, corrections, leave]) => setCounts({ gps, corrections, leave }));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <PendingApprovalsContext.Provider value={{ counts, total: counts.gps + counts.corrections + counts.leave, refresh }}>
      {children}
    </PendingApprovalsContext.Provider>
  );
}

export function usePendingApprovals() {
  return useContext(PendingApprovalsContext);
}
