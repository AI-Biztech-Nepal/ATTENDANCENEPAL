// Colleague feedback: everyone who works in the company can give feedback to anyone else, at any time (a rating from 1 to 5
// and an optional comment). It is shown to the person it is about as a report, with the name of the colleague who gave it,
// and it feeds the four colleague KPIs. Plain code with no network, so it can be tested on its own.

export type FeedbackRelation = 'peer' | 'manager' | 'c_level' | 'training';
export const FEEDBACK_RELATIONS: FeedbackRelation[] = ['peer', 'manager', 'c_level', 'training'];

/** The kind of colleague a piece of feedback came from, as a report says it when the giver's name is not on file. */
export const RELATION_FROM: Record<FeedbackRelation, string> = {
  peer: 'From a peer',
  manager: 'From the manager',
  c_level: 'From C-level',
  training: 'From training and compliance',
};

/** The kind of colleague, beside the giver's name. */
export const RELATION_ONE: Record<FeedbackRelation, string> = {
  peer: 'Peer',
  manager: 'Manager',
  c_level: 'C-level',
  training: 'Training and compliance',
};

/** The same four kinds as a name for each KPI's row in the report. */
export const RELATION_LABEL: Record<FeedbackRelation, string> = {
  peer: 'Peers',
  manager: 'Manager',
  c_level: 'C-level',
  training: 'Training and compliance',
};

/** The words under the five numbers when giving feedback. */
export const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
export const ratingWord = (rating: number) => RATING_WORDS[rating - 1] ?? '';

export const COMMENT_MAX = 1000;

/** A colleague feedback can be given to (feedback_colleagues()). */
export type Colleague = { id: string; name: string; department: string | null };

/** One piece of feedback about a person, as the report shows it. `giver_name` is who gave it (colleague_feedback_givers()),
 * null when that is not on file. */
export type FeedbackItem = { id: string; relation: FeedbackRelation; rating: number; comment: string | null; given_on: string; giver_name: string | null };

/** What the signed-in person already gave this month (feedback_i_gave()), so sending again can say it replaces it. */
export type GivenFeedback = { id: string; subject_id: string; subject_name: string; rating: number; comment: string | null; given_on: string };

/** A person as the "who is C-level / training and compliance" choice lists them. */
export type FeedbackPerson = { id: string; name: string; department: string | null; status: string | null };

/** What is wrong with feedback that is about to be sent, or null. */
export function validateGive(subjectId: string, rating: number | null, comment: string): string | null {
  if (!subjectId) return 'Choose who the feedback is for.';
  if (rating == null || !Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose a rating from 1 to 5.';
  if (comment.trim().length > COMMENT_MAX) return `The comment is too long (${COMMENT_MAX} characters at most).`;
  return null;
}

/** The first word of a name, for "how was working with Maya". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type RoleLine = { relation: FeedbackRelation; count: number; average: number | null };
export type Report = {
  /** All the feedback in the period. */
  count: number;
  /** Each kind of colleague: how many gave feedback and the average. A kind nobody gave has count 0 and no average. */
  roles: RoleLine[];
};

const valid = (r: number) => Number.isInteger(r) && r >= 1 && r <= 5;

/** The numbers at the top of a report. Every kind is listed, in the order of the owner's sheet, so a gap is visible. The
 * average is shown from the first piece of feedback: the person can read each one below it anyway. */
export function summariseReport(items: FeedbackItem[]): Report {
  const roles: RoleLine[] = FEEDBACK_RELATIONS.map(relation => {
    const mine = items.filter(i => i.relation === relation && valid(i.rating));
    return { relation, count: mine.length, average: mine.length ? Math.round((mine.reduce((n, i) => n + i.rating, 0) / mine.length) * 10) / 10 : null };
  });
  return { count: roles.reduce((n, r) => n + r.count, 0), roles };
}

/** "1 piece of feedback", "3 pieces of feedback". */
export const feedbackCount = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'} of feedback`;

/** Newest first: by the day it was given, then as the database gave them (they come newest first already). */
export const newestFirst = (items: FeedbackItem[]) => [...items].sort((a, b) => (a.given_on < b.given_on ? 1 : a.given_on > b.given_on ? -1 : 0));
