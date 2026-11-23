// KPI 4, NPS (net promoter score): from the "how likely are you to recommend us" number (0 to 10) on the customer forms.
// The share who would recommend (9 or 10) minus the share who are not likely to (0 to 6); 7 and 8 are neutral. The
// result runs from -100 (nobody would recommend) to +100 (everybody would). Plain code with no network, so it can be
// tested on its own; useFeedbackKpi.ts reads the rows. A form can leave the number empty, and such a form does not count.

/** A typed-in form as far as the recommend number is concerned. */
export type RecommendForm = { employee_id: string; recommend: number | null };

export type NpsSummary = {
  /** Forms that have a recommend number. */
  count: number;
  /** 9 or 10: would recommend. */
  promoters: number;
  /** 7 or 8: neutral. */
  passives: number;
  /** 0 to 6: not likely. */
  detractors: number;
  /** The NPS, a whole number from -100 to +100. */
  score: number;
};

const validNumber = (n: number | null): n is number => n != null && Number.isInteger(n) && n >= 0 && n <= 10;

/** The NPS of some recommend numbers, or null when none is a real one (a whole number from 0 to 10). */
export function summariseNps(numbers: (number | null)[]): NpsSummary | null {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const n of numbers) {
    if (!validNumber(n)) continue;
    if (n >= 9) promoters += 1;
    else if (n >= 7) passives += 1;
    else detractors += 1;
  }
  const count = promoters + passives + detractors;
  if (count === 0) return null;
  // Rounded half away from zero, so +x and -x read alike.
  const raw = ((promoters - detractors) / count) * 100;
  const score = Math.sign(raw) * Math.round(Math.abs(raw));
  return { count, promoters, passives, detractors, score: score === 0 ? 0 : score };
}

/** Each person's NPS from the forms about them. A person with no recommend number has no entry. */
export function summariseNpsByEmployee(rows: RecommendForm[]): Map<string, NpsSummary> {
  const by = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const list = by.get(r.employee_id) ?? [];
    list.push(r.recommend);
    by.set(r.employee_id, list);
  }
  const out = new Map<string, NpsSummary>();
  for (const [id, numbers] of by) {
    const s = summariseNps(numbers);
    if (s) out.set(id, s);
  }
  return out;
}

/** Nothing yet, too few forms to stand for a month (Settings holds how many are needed), or the NPS. */
export type NpsState = { kind: 'none' } | { kind: 'few'; count: number; need: number } | { kind: 'ok'; summary: NpsSummary };

export function npsState(summary: NpsSummary | null | undefined, minForms: number): NpsState {
  if (!summary) return { kind: 'none' };
  if (summary.count < minForms) return { kind: 'few', count: summary.count, need: minForms };
  return { kind: 'ok', summary };
}

/** 61 -> "+61", 0 -> "0", -40 -> "−40" (a real minus sign). */
export const scoreText = (score: number) => (score > 0 ? `+${score}` : score < 0 ? `−${Math.abs(score)}` : '0');

/** The same, for reading out: "plus 61", "minus 40", "0". */
export const scoreWords = (score: number) => (score > 0 ? `plus ${score}` : score < 0 ? `minus ${Math.abs(score)}` : '0');

/** The whole percent of the forms a number is. */
export const sharePct = (n: number, count: number) => (count > 0 ? Math.round((n / count) * 100) : 0);
