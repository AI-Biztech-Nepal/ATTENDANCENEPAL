// How this month compares with last month, for the cards on a person's KPI page. Every KPI works out its own two numbers
// (this month and the month before, from its own data) and this turns them into one plain sentence: "Up 0.3 from October
// (4.2)". Nothing here judges the change as good or bad: the direction is a fact, and what it means depends on the KPI.
// Plain code with no network, so it can be tested on its own.

import { numberText } from './ownKpi';

/** Which way the number moved. 'none' means there is nothing fair to say (a month that is not over). */
export type Change = { dir: 'up' | 'down' | 'same' | 'none'; text: string };

/** What the numbers are: percentages and scores move in "points", ratings have one decimal, counts are plain, and a
 * number a company types in for a KPI of its own ('number') keeps up to two decimals and thousands separators. */
export type Unit = 'points' | 'rating' | 'count' | 'number';

/**
 * `cur` against `prev`, the month named `name` ("October", "Kartik"). `shown` is how last month's number is written when it
 * is not just the number ("60%", "+80").
 */
export function compare(cur: number, prev: number, o: { name: string; unit: Unit; shown?: string }): Change {
  if (o.unit === 'number') {
    const diff = Math.round((cur - prev) * 100) / 100;
    const shown = o.shown ?? numberText(prev);
    if (diff === 0) return { dir: 'same', text: `Same as ${o.name} (${shown})` };
    return { dir: diff > 0 ? 'up' : 'down', text: `${diff > 0 ? 'Up' : 'Down'} ${numberText(Math.abs(diff))} from ${o.name} (${shown})` };
  }
  const decimals = o.unit === 'rating' ? 1 : 0;
  const scale = 10 ** decimals;
  const diff = Math.round((cur - prev) * scale) / scale;
  const shown = o.shown ?? (decimals ? prev.toFixed(1) : String(prev));
  if (diff === 0) return { dir: 'same', text: `Same as ${o.name} (${shown})` };
  const amount = decimals ? Math.abs(diff).toFixed(1) : String(Math.abs(diff));
  const unit = o.unit === 'points' ? ` point${Math.abs(diff) === 1 ? '' : 's'}` : '';
  return { dir: diff > 0 ? 'up' : 'down', text: `${diff > 0 ? 'Up' : 'Down'} ${amount}${unit} from ${o.name} (${shown})` };
}

/**
 * Services performed against the whole of last month. A month that is over is compared like any other number. A month
 * still going has only part of its services, so it is not called "down" for having fewer than a whole month: it says it
 * is already past last month's total, or just gives last month's total.
 */
export function compareServices(total: number, previousTotal: number, name: string, monthIsOver: boolean): Change {
  if (monthIsOver) return compare(total, previousTotal, { name, unit: 'count' });
  if (total > previousTotal) return { dir: 'up', text: `Already ${total - previousTotal} more than all of ${name} (${previousTotal})` };
  if (total === previousTotal) return { dir: 'same', text: `Already the same as all of ${name} (${previousTotal})` };
  return { dir: 'none', text: `${name} in all: ${previousTotal}` };
}

/** "Up 4 points from October (96%)" -> "up 4 points from October (96%)", to follow a label ("Present: up 4 points ..."). */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
