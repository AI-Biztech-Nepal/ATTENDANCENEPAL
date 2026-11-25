// Ported from admin-web/lib/guestHistory.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MIGRATION, isMissingTable } from './kpiLoad';

// One guest's history: every visit from the bookings file and every feedback form, read through guest_history()
// (20261125160000_guest_names_and_history.sql). The guest is opened from a form or a booking row the signed-in person can see;
// the database matches the guest's other records by phone, otherwise by name. Admin and HR get everything, with the guest's
// phone and email; an employee gets only their own visits and forms with that guest.

/** Where a guest was opened from: a feedback form, or a booking row. */
export type GuestAnchor = { feedbackId: string } | { serviceId: string };

export type GuestVisit = { id: string; day: string; employee_id: string; employee_name: string | null; service: string | null; minutes: number | null };
export type GuestForm = {
  id: string;
  day: string;
  employee_id: string;
  employee_name: string | null;
  rating: number | null;
  recommend: number | null;
  comment: string | null;
  reference: string | null;
};
export type GuestHistory = { name: string | null; phone: string | null; email: string | null; visits: GuestVisit[]; forms: GuestForm[] };

/** One line of the history, newest first: a visit or a feedback form. */
export type GuestEntry = ({ kind: 'visit' } & GuestVisit) | ({ kind: 'form' } & GuestForm);

/** The numbers at the top of a guest's history, and every visit and form in one list, newest first (on the same day the
 * visit comes before the form about it). */
export function summariseGuest(h: GuestHistory): { visits: number; forms: number; average: number | null; firstDay: string | null; lastDay: string | null; entries: GuestEntry[] } {
  const rated = h.forms.map(f => f.rating).filter((r): r is number => r != null);
  const average = rated.length ? Math.round((rated.reduce((n, r) => n + r, 0) / rated.length) * 10) / 10 : null;
  const days = [...h.visits.map(v => v.day), ...h.forms.map(f => f.day)].sort();
  const entries: GuestEntry[] = [...h.visits.map(v => ({ kind: 'visit' as const, ...v })), ...h.forms.map(f => ({ kind: 'form' as const, ...f }))];
  entries.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.kind === b.kind ? 0 : a.kind === 'visit' ? -1 : 1));
  return { visits: h.visits.length, forms: h.forms.length, average, firstDay: days[0] ?? null, lastDay: days[days.length - 1] ?? null, entries };
}

const anchorKey = (a: GuestAnchor | null) => (!a ? '' : 'feedbackId' in a ? `f:${a.feedbackId}` : `s:${a.serviceId}`);

/** A guest's history, read when `anchor` is set. */
export function useGuestHistory(anchor: GuestAnchor | null): { loading: boolean; history: GuestHistory | null; error: string } {
  const key = anchorKey(anchor);
  const [done, setDone] = useState<{ key: string; history: GuestHistory | null; error: string } | null>(null);

  useEffect(() => {
    if (!anchor) return;
    let live = true;
    const args = 'feedbackId' in anchor ? { p_feedback_id: anchor.feedbackId } : { p_service_id: anchor.serviceId };
    supabase.rpc('guest_history', args).then(({ data, error }) => {
      if (!live) return;
      if (error) {
        const e = error as { code?: string; message?: string };
        setDone({ key, history: null, error: isMissingTable(e) ? `The guest history is not set up in the database yet (run ${MIGRATION.guests2}).` : `Could not load the history: ${e.message || 'the database did not say why'}.` });
        return;
      }
      const h = (data ?? {}) as Partial<GuestHistory>;
      setDone({ key, history: { name: h.name ?? null, phone: h.phone ?? null, email: h.email ?? null, visits: h.visits ?? [], forms: h.forms ?? [] }, error: '' });
    });
    return () => {
      live = false;
    };
    // `key` carries the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!anchor) return { loading: false, history: null, error: '' };
  return done && done.key === key ? { loading: false, history: done.history, error: done.error } : { loading: true, history: null, error: '' };
}
