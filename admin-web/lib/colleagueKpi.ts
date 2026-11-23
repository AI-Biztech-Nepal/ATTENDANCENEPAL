import type { KpiId } from './kpiSettings';
import type { FeedbackRelation } from './colleagueFeedback';

// KPIs 7 to 10, colleague feedback: the average rating (1 to 5) a person got from their peers, from their immediate
// manager, from the C-level executive and from training and compliance, in the feedback colleagues gave during the month.
// Plain code with no network, so it can be tested on its own; useColleagueKpi.ts reads the rows.

/** A piece of feedback, as far as the KPIs go. */
export type FeedbackRow = { subject_id: string; relation: FeedbackRelation; rating: number | null };

/** One kind of colleague's part of a person's month: how many gave feedback, and the average of what they gave. */
export type RoleSummary = { given: number; average: number | null };

export type Roles = Record<FeedbackRelation, RoleSummary>;

/** The four KPIs and the kind of colleague each one asks. */
export const RELATION_OF_KPI: Record<'peers' | 'manager' | 'clevel' | 'training', FeedbackRelation> = {
  peers: 'peer',
  manager: 'manager',
  clevel: 'c_level',
  training: 'training',
};

export const COLLEAGUE_KPIS = Object.keys(RELATION_OF_KPI) as (keyof typeof RELATION_OF_KPI)[];
export const isColleagueKpi = (id: KpiId): id is keyof typeof RELATION_OF_KPI => id in RELATION_OF_KPI;

/** Peers must have given at least this much feedback before their average shows, so one or two do not stand for everybody. */
export const PEER_MIN = 3;

const noRoles = (): Roles => ({
  peer: { given: 0, average: null },
  manager: { given: 0, average: null },
  c_level: { given: 0, average: null },
  training: { given: 0, average: null },
});

const validRating = (r: number | null): r is number => r != null && Number.isInteger(r) && r >= 1 && r <= 5;

/** Each person's four kinds from the month's feedback. A person nobody gave feedback has no entry. */
export function summariseFeedback(rows: FeedbackRow[]): Map<string, Roles> {
  const sums = new Map<string, Record<FeedbackRelation, number>>();
  const out = new Map<string, Roles>();
  for (const r of rows) {
    if (!validRating(r.rating)) continue;
    const roles = out.get(r.subject_id) ?? noRoles();
    const sum = sums.get(r.subject_id) ?? { peer: 0, manager: 0, c_level: 0, training: 0 };
    roles[r.relation].given += 1;
    sum[r.relation] += r.rating;
    out.set(r.subject_id, roles);
    sums.set(r.subject_id, sum);
  }
  for (const [id, roles] of out) {
    for (const relation of Object.keys(roles) as FeedbackRelation[]) {
      const role = roles[relation];
      role.average = role.given > 0 ? Math.round((sums.get(id)![relation] / role.given) * 10) / 10 : null;
    }
  }
  return out;
}

/** How much feedback a kind needs before its average shows: three from peers, one from each of the others. */
export const neededFeedback = (relation: FeedbackRelation) => (relation === 'peer' ? PEER_MIN : 1);

/** Nobody of that kind gave any ('none'), some did but not enough yet ('few'), or the average ('ok'). */
export type RoleState = { kind: 'none' } | { kind: 'few'; given: number; need: number } | { kind: 'ok'; average: number; given: number };

export function roleState(summary: RoleSummary | null | undefined, relation: FeedbackRelation): RoleState {
  if (!summary || summary.given === 0) return { kind: 'none' };
  const need = neededFeedback(relation);
  if (summary.given < need || summary.average == null) return { kind: 'few', given: summary.given, need };
  return { kind: 'ok', average: summary.average, given: summary.given };
}

export const reviewWord = (n: number) => (n === 1 ? 'review' : 'reviews');
