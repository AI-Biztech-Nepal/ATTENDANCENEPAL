import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { birthdaysToNotify } from './hrAlerts';
import { useSharedHrAlerts } from './HrAlertsProvider';
import { usePendingApprovals } from './PendingApprovals';

const STORAGE_KEY = 'attendance-nepal-notification-reads';

export type ApprovalCounts = { gps: number; corrections: number; leave: number };

/** What the owner has already read in the bell, kept on this phone. Approvals are counted, not listed, so
 * they are remembered as "how many were waiting"; every other item is remembered by a key that changes when
 * the item does (a renewed contract, a new resignation, next year's birthday), so a change shows up as new. */
export type ReadMarks = { keys: string[]; seen: ApprovalCounts };

export const NO_MARKS: ReadMarks = { keys: [], seen: { gps: 0, corrections: 0, leave: 0 } };

/** Everything the bell's badge counts, as plain data. */
export type NotificationItems = {
  approvals: ApprovalCounts;
  contracts: { id: string; endKey: string }[];
  resignations: { id: string; handedInOn: string | null }[];
  birthdays: { id: string; dateKey: string }[];
};

const NO_ITEMS: NotificationItems = { approvals: { gps: 0, corrections: 0, leave: 0 }, contracts: [], resignations: [], birthdays: [] };

export type Unread = { approvals: number; contracts: number; resignations: number; birthdays: number; total: number };

const contractKey = (c: { id: string; endKey: string }) => `contract:${c.id}:${c.endKey}`;
const resignationKey = (r: { id: string; handedInOn: string | null }) => `exit:${r.id}:${r.handedInOn ?? ''}`;
const birthdayKey = (b: { id: string; dateKey: string }) => `bday:${b.id}:${b.dateKey}`;

function itemKeys(items: NotificationItems): string[] {
  return [...items.contracts.map(contractKey), ...items.resignations.map(resignationKey), ...items.birthdays.map(birthdayKey)];
}

/** How many badge items are still unread. */
export function unreadOf(items: NotificationItems, marks: ReadMarks): Unread {
  const read = new Set(marks.keys);
  const approvals = (['gps', 'corrections', 'leave'] as const).reduce((sum, q) => sum + Math.max(0, items.approvals[q] - Math.min(marks.seen[q], items.approvals[q])), 0);
  const contracts = items.contracts.filter(c => !read.has(contractKey(c))).length;
  const resignations = items.resignations.filter(r => !read.has(resignationKey(r))).length;
  const birthdays = items.birthdays.filter(b => !read.has(birthdayKey(b))).length;
  return { approvals, contracts, resignations, birthdays, total: approvals + contracts + resignations + birthdays };
}

/** Everything the bell shows right now counts as read. Anything remembered from before that is no longer
 * listed is dropped, so the stored list never grows. */
export function markAllRead(items: NotificationItems): ReadMarks {
  return { keys: itemKeys(items), seen: { ...items.approvals } };
}

/** When approvals get handled the queue shrinks; remember the smaller number, so the next request to arrive
 * counts as new instead of hiding behind the old, larger one. Returns `marks` itself when nothing changed. */
export function lowerSeen(items: NotificationItems, marks: ReadMarks): ReadMarks {
  const seen = {
    gps: Math.min(marks.seen.gps, items.approvals.gps),
    corrections: Math.min(marks.seen.corrections, items.approvals.corrections),
    leave: Math.min(marks.seen.leave, items.approvals.leave),
  };
  return seen.gps === marks.seen.gps && seen.corrections === marks.seen.corrections && seen.leave === marks.seen.leave ? marks : { ...marks, seen };
}

function parse(raw: string | null): ReadMarks {
  if (!raw) return NO_MARKS;
  try {
    const v = JSON.parse(raw) as Partial<ReadMarks>;
    const n = (x: unknown) => (typeof x === 'number' && x >= 0 ? x : 0);
    return {
      keys: Array.isArray(v.keys) ? v.keys.filter((k): k is string => typeof k === 'string') : [],
      seen: { gps: n(v.seen?.gps), corrections: n(v.seen?.corrections), leave: n(v.seen?.leave) },
    };
  } catch {
    return NO_MARKS;
  }
}

type ReadsValue = { marks: ReadMarks; loaded: boolean; save: (next: ReadMarks) => void };

const NotificationReadsContext = createContext<ReadsValue>({ marks: NO_MARKS, loaded: false, save: () => {} });

/** Holds what the owner has read, loaded once from the phone's storage — the header is rendered by several
 * stacks and the bell's panel reads the same marks as its badge. */
export function NotificationReadsProvider({ children }: { children: React.ReactNode }) {
  const [marks, setMarks] = useState<ReadMarks>(NO_MARKS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => setMarks(parse(raw)))
      .catch(() => {})
      .then(() => setLoaded(true));
  }, []);

  const save = useCallback((next: ReadMarks) => {
    setMarks(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const value = useMemo(() => ({ marks, loaded, save }), [marks, loaded, save]);
  return <NotificationReadsContext.Provider value={value}>{children}</NotificationReadsContext.Provider>;
}

/** What is unread in the owner's bell, and the "Mark all as read" action. */
export function useNotificationReads() {
  const { counts, loaded: approvalsLoaded } = usePendingApprovals();
  const { contracts, birthdays, exits } = useSharedHrAlerts();
  const { marks, loaded, save } = useContext(NotificationReadsContext);

  const items = useMemo<NotificationItems>(
    () => ({
      approvals: { gps: counts.gps, corrections: counts.corrections, leave: counts.leave },
      contracts: contracts.map(c => ({ id: c.id, endKey: c.endKey })),
      resignations: exits.filter(e => e.kind === 'handed_in').map(e => ({ id: e.id, handedInOn: e.handedInOn })),
      birthdays: birthdaysToNotify(birthdays).map(b => ({ id: b.id, dateKey: b.dateKey })),
    }),
    [counts.gps, counts.corrections, counts.leave, contracts, exits, birthdays]
  );

  // Not before the marks have been read back and the queues counted: until then they are empty or 0, and
  // lowering would wipe what was remembered.
  useEffect(() => {
    if (!loaded || !approvalsLoaded) return;
    const lowered = lowerSeen(items, marks);
    if (lowered !== marks) save(lowered);
  }, [items, marks, loaded, approvalsLoaded, save]);

  // Until the stored marks are back, show nothing rather than a number that then drops.
  const unread = useMemo(() => unreadOf(loaded ? items : NO_ITEMS, marks), [items, marks, loaded]);

  return { unread, markAllRead: () => save(markAllRead(items)) };
}
