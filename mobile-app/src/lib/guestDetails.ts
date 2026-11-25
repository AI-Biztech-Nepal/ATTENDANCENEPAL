// Ported from admin-web/lib/guestDetails.ts — keep the two in step (see mobile-app/README.md, "Shared logic").
import { supabase } from './supabase';
import { guestRow, type FeedbackDraft, type GuestDetails } from './customerFeedback';

// Who the guest is (name, phone, email) is kept in its own table, apart from the customer form, so an employee who may read the
// forms about themselves cannot read it: only admin and HR can (20261124120000_customer_feedback_guest_details.sql). These two
// functions are the only places the app reads or writes it.

/** The guest details of some forms, by form id. A form with none is not in the map. A read that fails leaves the map empty: the
 * forms are still listed, just without their guests. */
export async function loadGuests(formIds: string[]): Promise<Map<string, GuestDetails>> {
  const out = new Map<string, GuestDetails>();
  if (formIds.length === 0) return out;
  const { data, error } = await supabase.from('customer_feedback_guests').select('feedback_id, guest_name, guest_phone, guest_email').in('feedback_id', formIds);
  if (error || !Array.isArray(data)) return out;
  for (const r of data as (GuestDetails & { feedback_id: string })[]) out.set(r.feedback_id, { guest_name: r.guest_name, guest_phone: r.guest_phone, guest_email: r.guest_email });
  return out;
}

/** Keeps the guest details typed for a form. A guest is never removed on its own (it goes when the form is deleted); an old form
 * with none on file and nothing typed has nothing to keep. Returns the database's message when it failed, or ''. */
export async function saveGuest(draft: FeedbackDraft, formId: string): Promise<string> {
  const row = guestRow(draft, formId);
  if (!row) return '';
  const { error } = await supabase.from('customer_feedback_guests').upsert(row, { onConflict: 'feedback_id' });
  return error ? error.message : '';
}
