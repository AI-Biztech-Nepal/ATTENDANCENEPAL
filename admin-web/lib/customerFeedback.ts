import type { CustomerFeedback } from './types';

// Customer feedback forms: customers fill in a paper form, staff type each one in (KPIs > Customer feedback).
// The same form feeds two KPIs, the 1-5 service rating and the 0-10 would-recommend number (NPS).

export const FEEDBACK_PAGE_SIZE = 10;
export const COMMENT_MAX = 1000;
export const REFERENCE_MAX = 80;

/** The columns the page reads (everything the table holds that it shows). */
export const FEEDBACK_COLUMNS = 'id, employee_id, given_on, reference, rating, recommend, comment, created_at';

/** What is typed into the form, as text, exactly as typed. */
export type FeedbackDraft = {
  employeeId: string;
  /** AD date key, YYYY-MM-DD. */
  date: string;
  reference: string;
  rating: string;
  recommend: string;
  comment: string;
};

export const emptyDraft = (date: string): FeedbackDraft => ({ employeeId: '', date, reference: '', rating: '', recommend: '', comment: '' });

/** A whole number written as digits only ("7"), or null for anything else ("", "7.5", "-1", "seven"). */
function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
}

/** What is wrong with the form, in a sentence the person typing can act on, or null when it can be saved.
 * `today` is the Nepal date; a form cannot be dated after it. The database holds the same limits. */
export function validateFeedback(d: FeedbackDraft, today: string): string | null {
  if (!d.employeeId) return 'Pick who served the customer.';
  if (!d.date) return 'Pick the date on the form.';
  if (d.date > today) return 'That date is in the future. Use the date written on the form.';
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

/** The row to send for a form that passed validateFeedback(): empty boxes become null. */
export function feedbackRow(d: FeedbackDraft) {
  return {
    employee_id: d.employeeId,
    given_on: d.date,
    reference: d.reference.trim() || null,
    rating: d.rating.trim() === '' ? null : Number(d.rating),
    recommend: d.recommend.trim() === '' ? null : Number(d.recommend),
    comment: d.comment.trim() || null,
  };
}

/** A saved form back into the boxes, to edit it. */
export function draftFromRow(r: CustomerFeedback): FeedbackDraft {
  return {
    employeeId: r.employee_id,
    date: r.given_on,
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
