import type { KpiId } from './kpiSettings';
import type { ReviewRelation } from './colleagueReviews';

// KPIs 7 to 10, colleague feedback: the average rating (1 to 5) a person got from their peers, from their immediate
// manager, from the C-level executive and from training and compliance, in the month's round of colleague reviews.
// Plain code with no network, so it can be tested on its own; useColleagueKpi.ts reads the rows.

/** A review in a round, as far as the KPIs go. `rating` is empty until it is given. */
export type ReviewRow = { subject_id: string; relation: ReviewRelation; rating: number | null };

/** One role's part of a person's month: how many reviews were asked, how many are given, and the average of the given ones. */
export type RoleSummary = { asked: number; given: number; average: number | null };

export type Roles = Record<ReviewRelation, RoleSummary>;

/** The four KPIs and the kind of colleague each one asks. */
export const RELATION_OF_KPI: Record<'peers' | 'manager' | 'clevel' | 'training', ReviewRelation> = {
  peers: 'peer',
  manager: 'manager',
  clevel: 'c_level',
  training: 'training',
};

export const COLLEAGUE_KPIS = Object.keys(RELATION_OF_KPI) as (keyof typeof RELATION_OF_KPI)[];
export const isColleagueKpi = (id: KpiId): id is keyof typeof RELATION_OF_KPI => id in RELATION_OF_KPI;

/** Peers must give at least this many reviews before their average shows (fewer if fewer were asked at all). */
export const PEER_MIN = 3;

const noRoles = (): Roles => ({
  peer: { asked: 0, given: 0, average: null },
  manager: { asked: 0, given: 0, average: null },
  c_level: { asked: 0, given: 0, average: null },
  training: { asked: 0, given: 0, average: null },
});

const validRating = (r: number | null): r is number => r != null && Number.isInteger(r) && r >= 1 && r <= 5;

/** Each person's four roles from the reviews of a round. A person nobody was asked about has no entry. */
export function summariseReviews(rows: ReviewRow[]): Map<string, Roles> {
  const sums = new Map<string, Record<ReviewRelation, number>>();
  const out = new Map<string, Roles>();
  for (const r of rows) {
    const roles = out.get(r.subject_id) ?? noRoles();
    const sum = sums.get(r.subject_id) ?? { peer: 0, manager: 0, c_level: 0, training: 0 };
    const role = roles[r.relation];
    role.asked += 1;
    if (validRating(r.rating)) {
      role.given += 1;
      sum[r.relation] += r.rating;
    }
    out.set(r.subject_id, roles);
    sums.set(r.subject_id, sum);
  }
  for (const [id, roles] of out) {
    for (const relation of Object.keys(roles) as ReviewRelation[]) {
      const role = roles[relation];
      role.average = role.given > 0 ? Math.round((sums.get(id)![relation] / role.given) * 10) / 10 : null;
    }
  }
  return out;
}

/** How many reviews a role needs before its average shows: three from peers (so one or two do not stand for everybody),
 * one from each of the others; and never more than were asked. */
export const neededReviews = (relation: ReviewRelation, asked: number) => Math.min(relation === 'peer' ? PEER_MIN : 1, asked);

/** Nobody was asked ('none'), some were but not enough have answered ('few'), or the average ('ok'). */
export type RoleState = { kind: 'none' } | { kind: 'few'; given: number; need: number; asked: number } | { kind: 'ok'; average: number; given: number; asked: number };

export function roleState(summary: RoleSummary | null | undefined, relation: ReviewRelation): RoleState {
  if (!summary || summary.asked === 0) return { kind: 'none' };
  const need = neededReviews(relation, summary.asked);
  if (summary.given < need || summary.average == null) return { kind: 'few', given: summary.given, need, asked: summary.asked };
  return { kind: 'ok', average: summary.average, given: summary.given, asked: summary.asked };
}

export const reviewWord = (n: number) => (n === 1 ? 'review' : 'reviews');
