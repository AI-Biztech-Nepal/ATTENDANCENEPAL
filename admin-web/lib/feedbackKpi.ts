// KPI 3, customer feedback: the average service rating (1 to 5) from the customer forms staff typed in. Plain code with
// no network, so it can be tested on its own; useFeedbackKpi.ts reads the rows. A form can leave the rating empty (the
// customer skipped it), and such a form does not count here.

/** A typed-in form as far as the rating is concerned. */
export type RatedForm = { employee_id: string; rating: number | null };

export type FeedbackSummary = {
  /** Forms that have a rating. */
  count: number;
  /** The average rating, to one decimal. */
  average: number;
  /** How many forms gave each rating: index 0 is 1 star, index 4 is 5 stars. */
  byRating: [number, number, number, number, number];
};

const validRating = (r: number | null): r is number => r != null && Number.isInteger(r) && r >= 1 && r <= 5;

/** The summary of some ratings, or null when none is a real rating (1 to 5). */
export function summariseRatings(ratings: (number | null)[]): FeedbackSummary | null {
  const byRating: FeedbackSummary['byRating'] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const r of ratings) {
    if (!validRating(r)) continue;
    byRating[r - 1] += 1;
    sum += r;
    count += 1;
  }
  return count === 0 ? null : { count, average: Math.round((sum / count) * 10) / 10, byRating };
}

/** Each person's summary of the forms about them. A person with no rated form has no entry. */
export function summariseFeedback(rows: RatedForm[]): Map<string, FeedbackSummary> {
  const by = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const list = by.get(r.employee_id) ?? [];
    list.push(r.rating);
    by.set(r.employee_id, list);
  }
  const out = new Map<string, FeedbackSummary>();
  for (const [id, ratings] of by) {
    const s = summariseRatings(ratings);
    if (s) out.set(id, s);
  }
  return out;
}

/**
 * What to show for one person: nothing yet ('none') or the average ('ok'). The average shows from the first form, and the
 * card says how many forms it comes from, so a month with one or two is never hidden.
 */
export type FeedbackState = { kind: 'none' } | { kind: 'ok'; summary: FeedbackSummary };

export function feedbackState(summary: FeedbackSummary | null | undefined): FeedbackState {
  if (!summary) return { kind: 'none' };
  return { kind: 'ok', summary };
}

/** 4.6 -> "4.6", 5 -> "5.0": always one decimal, so numbers line up. */
export const averageText = (n: number) => n.toFixed(1);

export const formWord = (n: number) => (n === 1 ? 'form' : 'forms');
