'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'notificationReads:v1';

export type ApprovalCounts = { gps: number; corrections: number; leave: number };

/** What the owner has already read in the bell, kept on this device. Approvals are counted, not listed, so
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

function readStored(): ReadMarks {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return NO_MARKS;
  }
}

/** What is unread in the bell, and the "Mark all as read" action. Remembered in this browser (localStorage), so
 * it survives a reload; a private window that blocks storage just starts unread each time. */
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

  return { unread: unreadOf(items, marks), markAllRead: () => save(markAllRead(items)) };
}
