import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { birthdaysToNotify } from './hrAlerts';
import { useSharedHrAlerts } from './HrAlertsProvider';
import { usePendingApprovals } from './PendingApprovals';

const STORAGE_KEY = 'attendance-nepal-notification-reads';

export type ApprovalCounts = { gps: number; corrections: number; leave: number };
export type ApprovalQueue = keyof ApprovalCounts;

/** What the owner has already read in the bell, kept on this phone. Approvals are counted, not listed, so
 * they are remembered as "how many were waiting"; every other item is remembered by a key that changes when
 * the item does (a renewed contract, an exit moving to its next stage, next year's birthday), so a change
 * shows up as new. */
export type ReadMarks = { keys: string[]; seen: ApprovalCounts };

export const NO_MARKS: ReadMarks = { keys: [], seen: { gps: 0, corrections: 0, leave: 0 } };

/** Everything the bell lists, as plain data. `counts` marks the ones that also raise the badge. */
export type NotificationItems = {
  approvals: ApprovalCounts;
  contracts: { id: string; endKey: string }[];
  exits: { id: string; kind: string; handedInOn: string | null; lastWorkingOn: string | null; counts: boolean }[];
  birthdays: { id: string; dateKey: string; counts: boolean }[];
};

const NO_ITEMS: NotificationItems = { approvals: { gps: 0, corrections: 0, leave: 0 }, contracts: [], exits: [], birthdays: [] };

/** What is still unread: the badge's total with its parts, and everything unread whether or not it raises the badge. */
export type Unread = { approvals: number; contracts: number; resignations: number; birthdays: number; total: number; listed: number };

export const contractKey = (c: { id: string; endKey: string }) => `contract:${c.id}:${c.endKey}`;
export const exitKey = (e: { id: string; kind: string; handedInOn: string | null; lastWorkingOn: string | null }) =>
  `exit:${e.id}:${e.kind}:${e.handedInOn ?? ''}:${e.lastWorkingOn ?? ''}`;
export const birthdayKey = (b: { id: string; dateKey: string }) => `bday:${b.id}:${b.dateKey}`;

function itemKeys(items: NotificationItems): string[] {
  return [...items.contracts.map(contractKey), ...items.exits.map(exitKey), ...items.birthdays.map(birthdayKey)];
}

/** How many of a queue's waiting requests have not been read. */
export function queueUnread(items: NotificationItems, marks: ReadMarks, queue: ApprovalQueue): number {
  const waiting = items.approvals[queue];
  return Math.max(0, waiting - Math.min(marks.seen[queue], waiting));
}

/** How many items are still unread. */
export function unreadOf(items: NotificationItems, marks: ReadMarks): Unread {
  const read = new Set(marks.keys);
  const approvals = queueUnread(items, marks, 'gps') + queueUnread(items, marks, 'corrections') + queueUnread(items, marks, 'leave');
  const contracts = items.contracts.filter(c => !read.has(contractKey(c))).length;
  const unreadExits = items.exits.filter(e => !read.has(exitKey(e)));
  const unreadBirthdays = items.birthdays.filter(b => !read.has(birthdayKey(b)));
  const resignations = unreadExits.filter(e => e.counts).length;
  const birthdays = unreadBirthdays.filter(b => b.counts).length;
  return {
    approvals,
    contracts,
    resignations,
    birthdays,
    total: approvals + contracts + resignations + birthdays,
    listed: approvals + contracts + unreadExits.length + unreadBirthdays.length,
  };
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

/** What is unread in the owner's bell, and the "Mark all as read" action. The panel lists only what is unread
 * (`isRead` / `queueUnread` say which), so marking everything read empties it. */
export function useNotificationReads() {
  const { counts, loaded: approvalsLoaded } = usePendingApprovals();
  const { contracts, birthdays, exits } = useSharedHrAlerts();
  const { marks, loaded, save } = useContext(NotificationReadsContext);

  const items = useMemo<NotificationItems>(() => {
    const soon = new Set(birthdaysToNotify(birthdays).map(b => b.id));
    return {
      approvals: { gps: counts.gps, corrections: counts.corrections, leave: counts.leave },
      contracts: contracts.map(c => ({ id: c.id, endKey: c.endKey })),
      exits: exits.map(e => ({ id: e.id, kind: e.kind, handedInOn: e.handedInOn, lastWorkingOn: e.lastWorkingOn, counts: e.kind === 'handed_in' })),
      birthdays: birthdays.map(b => ({ id: b.id, dateKey: b.dateKey, counts: soon.has(b.id) })),
    };
  }, [counts.gps, counts.corrections, counts.leave, contracts, exits, birthdays]);

  // Not before the marks have been read back and the queues counted: until then they are empty or 0, and
  // lowering would wipe what was remembered.
  useEffect(() => {
    if (!loaded || !approvalsLoaded) return;
    const lowered = lowerSeen(items, marks);
    if (lowered !== marks) save(lowered);
  }, [items, marks, loaded, approvalsLoaded, save]);

  // Until the stored marks are back, show nothing rather than a number that then drops.
  const unread = useMemo(() => unreadOf(loaded ? items : NO_ITEMS, marks), [items, marks, loaded]);
  const read = useMemo(() => new Set(marks.keys), [marks]);

  return {
    unread,
    loaded,
    isRead: (key: string) => read.has(key),
    queueUnread: (queue: ApprovalQueue) => queueUnread(items, marks, queue),
    markAllRead: () => save(markAllRead(items)),
  };
}
