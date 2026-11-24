import type { CustomerFeedback } from './types';

// Customer feedback forms: customers fill in a paper form, staff type each one in (KPIs > Customer feedback).
// The same form feeds two KPIs, the 1-5 service rating and the 0-10 would-recommend number (NPS).

export const FEEDBACK_PAGE_SIZE = 10;
export const COMMENT_MAX = 1000;
export const REFERENCE_MAX = 80;
export const GUEST_NAME_MAX = 100;
export const GUEST_PHONE_MAX = 30;
export const GUEST_EMAIL_MAX = 120;

/** The columns the page reads from the form table (the guest's name, phone and email are read separately, from the table only admin
 * and HR can read: see lib/guestDetails.ts). `visit_date` is new: until the migration is run the page reads the columns without it. */
export const FEEDBACK_COLUMNS = 'id, employee_id, given_on, visit_date, reference, rating, recommend, comment, created_at';
export const FEEDBACK_COLUMNS_WITHOUT_VISIT = 'id, employee_id, given_on, reference, rating, recommend, comment, created_at';

/** Who the guest is, as kept apart from the form. */
export type GuestDetails = { guest_name: string | null; guest_phone: string | null; guest_email: string | null };

/** True when a database message is about the guest-details migration not having been run (the visit-date column or the table is missing). */
export const needsGuestMigration = (message: string) => /visit_date|customer_feedback_guests/.test(message) && /does not exist|schema cache|could not find/i.test(message);

/** What is typed into the form, as text, exactly as typed. */
export type FeedbackDraft = {
  employeeId: string;
  /** AD date key, YYYY-MM-DD. */
  date: string;
  /** The day of the visit, AD date key, or '' when the form does not say. */
  visitDate: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  reference: string;
  rating: string;
  recommend: string;
  comment: string;
};

export const emptyDraft = (date: string): FeedbackDraft => ({ employeeId: '', date, visitDate: '', guestName: '', guestPhone: '', guestEmail: '', reference: '', rating: '', recommend: '', comment: '' });

/** A whole number written as digits only ("7"), or null for anything else ("", "7.5", "-1", "seven"). */
function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
}

/** A phone number as written on a form: digits with spaces, + ( ) - . / between them, at least five digits. */
export const validPhone = (text: string) => text.length <= GUEST_PHONE_MAX && /^[0-9+()./ -]+$/.test(text) && (text.match(/[0-9]/g) ?? []).length >= 5;

/** An email address, loosely: something@something.something with no spaces. */
export const validEmail = (text: string) => text.length <= GUEST_EMAIL_MAX && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text);

/** What is wrong with the form, in a sentence the person typing can act on, or null when it can be saved.
 * `today` is the Nepal date; a form cannot be dated after it. The database holds the same limits. */
export function validateFeedback(d: FeedbackDraft, today: string): string | null {
  if (!d.employeeId) return 'Pick who served the customer.';
  if (!d.date) return 'Pick the date on the form.';
  if (d.date > today) return 'That date is in the future. Use the date written on the form.';
  if (d.visitDate) {
    if (d.visitDate > today) return 'The date of the visit is in the future.';
    if (d.visitDate > d.date) return 'The visit cannot be after the date on the form.';
  }
  if (d.guestName.trim().length > GUEST_NAME_MAX) return `The customer's name is too long (${GUEST_NAME_MAX} characters at most).`;
  if (d.guestPhone.trim() !== '' && !validPhone(d.guestPhone.trim())) return 'The phone number looks wrong. Use digits, spaces, + and -, with at least 5 digits.';
  if (d.guestEmail.trim() !== '' && !validEmail(d.guestEmail.trim())) return 'The email address looks wrong. It should look like name@example.com.';
  if (d.rating.trim() !== '') {
    const n = wholeNumber(d.rating);
    if (n == null || n < 1 || n > 5) return 'The service rating must be a whole number from 1 to 5.';
  }
  if (d.recommend.trim() !== '') {
    const n = wholeNumber(d.recommend);
    if (n == null || n > 10) return 'The recommend number must be a whole number from 0 to 10.';
  }
  if (d.reference.trim().length > REFERENCE_MAX) return `"What it was for" is too long (${REFERENCE_MAX} characters at most).`;
  if (d.comment.trim().length > COMMENT_MAX) return `The comment is too long (${COMMENT_MAX} characters at most).`;
  if (d.rating.trim() === '' && d.recommend.trim() === '' && d.comment.trim() === '') {
    return 'Fill in at least one answer: the rating, the recommend number or a comment.';
  }
  return null;
}

/** The row to send for a form that passed validateFeedback(): empty boxes become null. The visit date is only sent when there is
 * one (or `hadVisit`: the form had one, so emptying the box must clear it), so a form without it saves even on a database that
 * has not had the guest-details migration run yet. */
export function feedbackRow(d: FeedbackDraft, hadVisit = false) {
  return {
    employee_id: d.employeeId,
    given_on: d.date,
    ...(d.visitDate || hadVisit ? { visit_date: d.visitDate || null } : {}),
    reference: d.reference.trim() || null,
    rating: d.rating.trim() === '' ? null : Number(d.rating),
    recommend: d.recommend.trim() === '' ? null : Number(d.recommend),
    comment: d.comment.trim() || null,
  };
}

/** The row for the table that holds who the guest is, or null when none of the three boxes was filled in (nothing is kept). */
export function guestRow(d: FeedbackDraft, feedbackId: string) {
  const guest_name = d.guestName.trim() || null;
  const guest_phone = d.guestPhone.trim() || null;
  const guest_email = d.guestEmail.trim() || null;
  return guest_name || guest_phone || guest_email ? { feedback_id: feedbackId, guest_name, guest_phone, guest_email } : null;
}

/** A saved form back into the boxes, to edit it. */
export function draftFromRow(r: CustomerFeedback): FeedbackDraft {
  return {
    employeeId: r.employee_id,
    date: r.given_on,
    visitDate: r.visit_date ?? '',
    guestName: r.guest?.guest_name ?? '',
    guestPhone: r.guest?.guest_phone ?? '',
    guestEmail: r.guest?.guest_email ?? '',
    reference: r.reference ?? '',
    rating: r.rating == null ? '' : String(r.rating),
    recommend: r.recommend == null ? '' : String(r.recommend),
    comment: r.comment ?? '',
  };
}

/** "Showing 11–20 of 247 forms", or "No forms". */
export function rangeText(page: number, shown: number, total: number): string {
  if (total === 0 || shown === 0) return 'No forms';
  const from = page * FEEDBACK_PAGE_SIZE + 1;
  return `Showing ${from}–${from + shown - 1} of ${total} ${total === 1 ? 'form' : 'forms'}`;
}
