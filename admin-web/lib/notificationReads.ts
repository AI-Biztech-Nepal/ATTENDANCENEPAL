'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'notificationReads:v1';

export type ApprovalCounts = { gps: number; corrections: number; leave: number };
export type ApprovalQueue = keyof ApprovalCounts;

/** What the owner has already read in the bell, kept on this device. Approvals are counted, not listed, so
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

function readStored(): ReadMarks {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return NO_MARKS;
  }
}

/** What is unread in the bell, and the "Mark all as read" action. Remembered in this browser (localStorage), so
 * it survives a reload; a private window that blocks storage just starts unread each time. The panel lists only
 * what is unread (`isRead` / `queueUnread` say which), so marking everything read empties it. */
export function useNotificationReads(items: NotificationItems, approvalsLoaded: boolean) {
  const [marks, setMarks] = useState<ReadMarks>(() => (typeof window === 'undefined' ? NO_MARKS : readStored()));

  const save = useCallback((next: ReadMarks) => {
    setMarks(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the marks last until the page is reloaded.
    }
  }, []);

  // Another tab marking things read updates this one too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMarks(parse(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Not before the queues have been counted: until then they read 0, and that would wipe what was remembered.
  useEffect(() => {
    if (!approvalsLoaded) return;
    const lowered = lowerSeen(items, marks);
    if (lowered !== marks) save(lowered);
  }, [items, marks, save, approvalsLoaded]);

  const read = new Set(marks.keys);
  return {
    unread: unreadOf(items, marks),
    isRead: (key: string) => read.has(key),
    queueUnread: (queue: ApprovalQueue) => queueUnread(items, marks, queue),
    markAllRead: () => save(markAllRead(items)),
  };
}
