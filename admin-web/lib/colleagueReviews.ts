import type { Employee } from './types';

// Colleague reviews: once a month, colleagues give each other feedback (a rating from 1 to 5 and an optional
// comment). Four kinds feed four KPIs. The person being reviewed never learns who said what: they have no access
// to any of it. Which colleagues are asked is decided here when a round starts.

export type ReviewRelation = 'peer' | 'manager' | 'c_level' | 'training';

export const RELATION_LABEL: Record<ReviewRelation, string> = {
  peer: 'Peer',
  manager: 'Manager',
  c_level: 'C-level executive',
  training: 'Training and compliance',
};

/** "As a peer" — how the giver's own list says what they are giving it as. */
export const RELATION_AS: Record<ReviewRelation, string> = {
  peer: 'As a peer',
  manager: 'As the manager',
  c_level: 'As C-level executive',
  training: 'As training and compliance',
};

/** The words under the five numbers when giving feedback. */
export const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export const DEFAULT_PEER_LIMIT = 5;
export const COMMENT_MAX = 1000;

export type ReviewRound = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  due_on: string | null;
  status: 'open' | 'closed';
  created_at: string;
  closed_at: string | null;
};

/** One review in a round. `rating` is null until it is given. */
export type ColleagueReview = {
  id: string;
  round_id: string;
  subject_id: string;
  reviewer_id: string;
  relation: ReviewRelation;
  rating: number | null;
  given_at: string | null;
};

/** What my_reviews_to_give() returns for the signed-in person. */
export type ReviewToGive = {
  review_id: string;
  round_id: string;
  round_title: string;
  due_on: string | null;
  relation: ReviewRelation;
  subject_name: string;
  subject_department: string | null;
  rating: number | null;
  comment: string | null;
  given_at: string | null;
};

export type ReviewGiver = { employee_id: string; relation: 'c_level' | 'training' };
export type ReviewPerson = Pick<Employee, 'id' | 'name' | 'department' | 'status'> & { reporting_to?: string | null };
export type Assignment = { subject_id: string; reviewer_id: string; relation: ReviewRelation };

const byName = (a: ReviewPerson, b: ReviewPerson) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id);

/**
 * Every review a new round asks for, from the company's rules. Only active employees are involved.
 *   - Peers: people in the same department. Each person is reviewed by up to `peerLimit` of them, and gives the
 *     same number, so nobody carries more than their share. Who is paired with whom moves along each month
 *     (`roundIndex` is how many rounds there have been), so a person is not always reviewed by the same people.
 *   - Manager: the person set as "Reports to" on the profile, if they are active.
 *   - C-level and training and compliance: each chosen giver reviews everyone else.
 * Nobody reviews themselves, and the same review is never listed twice.
 */
export function buildAssignments(people: ReviewPerson[], givers: ReviewGiver[], peerLimit: number, roundIndex: number): Assignment[] {
  const active = people.filter(p => p.status === 'active');
  const activeIds = new Set(active.map(p => p.id));
  const out: Assignment[] = [];
  const seen = new Set<string>();
  const push = (a: Assignment) => {
    if (a.subject_id === a.reviewer_id) return;
    const key = `${a.relation}|${a.subject_id}|${a.reviewer_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };

  const departments = new Map<string, ReviewPerson[]>();
  for (const p of active) {
    const d = (p.department ?? '').trim();
    if (!d) continue;
    departments.set(d, [...(departments.get(d) ?? []), p]);
  }
  // Departments in name order, so the result does not depend on the order the people were listed in.
  for (const [, group] of [...departments.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const list = [...group].sort(byName);
    const n = list.length;
    if (n < 2) continue;
    const k = Math.max(0, Math.min(Math.floor(peerLimit), n - 1));
    const shift = Math.abs(Math.floor(roundIndex)) % (n - 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) {
        const offset = ((shift + j) % (n - 1)) + 1;
        push({ subject_id: list[i].id, reviewer_id: list[(i + offset) % n].id, relation: 'peer' });
      }
    }
  }

  for (const p of active) {
    if (p.reporting_to && p.reporting_to !== p.id && activeIds.has(p.reporting_to)) {
      push({ subject_id: p.id, reviewer_id: p.reporting_to, relation: 'manager' });
    }
  }

  for (const g of givers) {
    if (!activeIds.has(g.employee_id)) continue;
    for (const p of active) push({ subject_id: p.id, reviewer_id: g.employee_id, relation: g.relation });
  }
  return out;
}

/** How many reviews of each kind a round asks for, and how many different people are asked. */
export function describeAssignments(list: Assignment[]): { total: number; givers: number; byRelation: Record<ReviewRelation, number> } {
  const byRelation: Record<ReviewRelation, number> = { peer: 0, manager: 0, c_level: 0, training: 0 };
  for (const a of list) byRelation[a.relation] += 1;
  return { total: list.length, givers: new Set(list.map(a => a.reviewer_id)).size, byRelation };
}

export function roundProgress(reviews: Pick<ColleagueReview, 'given_at'>[]): { total: number; given: number; waiting: number } {
  const given = reviews.filter(r => r.given_at != null).length;
  return { total: reviews.length, given, waiting: reviews.length - given };
}

/** One line of "Still to give": a giver and what they have left in one role. */
export type StillToGive = {
  reviewerId: string;
  relation: ReviewRelation;
  total: number;
  given: number;
  /** Who the feedback still to give is about. */
  pendingSubjects: string[];
};

/** The reviews still to be given, one line per giver and role, the giver with most left first. Fully given
 * groups are left out. */
export function stillToGive(reviews: ColleagueReview[], nameOf: (id: string) => string, giverName: (id: string) => string): StillToGive[] {
  const groups = new Map<string, StillToGive>();
  for (const r of reviews) {
    const key = `${r.reviewer_id}|${r.relation}`;
    const g = groups.get(key) ?? { reviewerId: r.reviewer_id, relation: r.relation, total: 0, given: 0, pendingSubjects: [] };
    g.total += 1;
    if (r.given_at) g.given += 1;
    else g.pendingSubjects.push(nameOf(r.subject_id));
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter(g => g.pendingSubjects.length > 0)
    .map(g => ({ ...g, pendingSubjects: g.pendingSubjects.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }))
    .sort((a, b) => b.pendingSubjects.length - a.pendingSubjects.length || giverName(a.reviewerId).localeCompare(giverName(b.reviewerId), undefined, { numeric: true }) || a.relation.localeCompare(b.relation));
}

/** "Not started", "2 of 5 given". */
export function givenStatus(g: Pick<StillToGive, 'total' | 'given'>): string {
  return g.given === 0 ? 'Not started' : `${g.given} of ${g.total} given`;
}

/** "Sita Gurung", "3 people". */
export function forText(subjects: string[]): string {
  return subjects.length === 1 ? subjects[0] : `${subjects.length} people`;
}

/** What is wrong with the feedback about to be sent, or null. */
export function validateGive(rating: number | null, comment: string): string | null {
  if (rating == null || !Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose a rating from 1 to 5.';
  if (comment.trim().length > COMMENT_MAX) return `The comment is too long (${COMMENT_MAX} characters at most).`;
  return null;
}

/** The first day a round for this month would be asked for, the last it is due: the whole month. */
export function overlaps(a: { period_start: string; period_end: string }, b: { period_start: string; period_end: string }): boolean {
  return a.period_start <= b.period_end && a.period_end >= b.period_start;
}
