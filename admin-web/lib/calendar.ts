import NepaliDate from 'nepali-date-converter';

export type CalendarSystem = 'AD' | 'BS';

export type CalendarCell = {
  /** AD calendar date as YYYY-MM-DD — the key attendance_logs is queried by. */
  adKey: string;
  /** The day-of-month number to display, in whichever system is active. */
  displayDay: number;
  inMonth: boolean;
  isToday: boolean;
};

export type CalendarMonth = {
  label: string;
  weeks: CalendarCell[][];
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateKey(year: number, monthIndex0: number, day: number) {
  return `${year}-${pad(monthIndex0 + 1)}-${pad(day)}`;
}

/** The AD calendar-date key (YYYY-MM-DD) for a punch_time, in the browser's
 * LOCAL timezone — matching how grid cells below compute their own adKey.
 * Never slice the raw ISO string for this: that gives the UTC date, which
 * silently disagrees with the local date whenever the browser's timezone
 * offset pushes a punch across midnight relative to UTC. */
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function chunkIntoWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** AD grid needs no library — plain JS Date, weekday 0=Sun same as the BS lib. */
function buildAdMonth(year: number, monthIndex: number, todayKey: string): CalendarMonth {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weekday = first.getDay();
  const totalCells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, monthIndex, 1 - weekday + i);
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    cells.push({
      adKey: key,
      displayDay: d.getDate(),
      inMonth: d.getMonth() === monthIndex && d.getFullYear() === year,
      isToday: key === todayKey,
    });
  }
  return {
    label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    weeks: chunkIntoWeeks(cells),
  };
}

/**
 * A fresh NepaliDate per cell (not one mutated/reused instance): setDate()
 * re-bases against whatever month the object currently holds, so reusing one
 * instance across cells that roll into adjacent months would compound.
 */
function buildBsMonth(bsYear: number, bsMonth: number, todayKey: string): CalendarMonth {
  const daysInMonth = new NepaliDate(bsYear, bsMonth + 1, 0).getDate();
  const first = new NepaliDate(bsYear, bsMonth, 1);
  const weekday = first.getDay();
  const totalCells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cell = new NepaliDate(bsYear, bsMonth, 1);
    cell.setDate(1 - weekday + i);
    const ad = cell.getAD();
    const key = dateKey(ad.year, ad.month, ad.date);
    cells.push({
      adKey: key,
      displayDay: cell.getDate(),
      inMonth: cell.getYear() === bsYear && cell.getMonth() === bsMonth,
      isToday: key === todayKey,
    });
  }
  return { label: first.format('MMMM YYYY'), weeks: chunkIntoWeeks(cells) };
}

function todayKey() {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

/** anchor is always an AD (year, monthIndex, day) triple — the single
 * source of truth for "which point we're looking at", independent of
 * which calendar system is currently displayed. The day matters: a BS
 * month's 1st can fall anywhere within an AD month, so two different BS
 * months can both have their 1st land in the *same* AD month — dropping
 * the day (keeping only year+month) made consecutive "next month" steps
 * in BS mode round-trip back to an unchanged AD anchor and get stuck. */
export type CalendarAnchor = { year: number; month: number; day: number };

export function buildMonth(system: CalendarSystem, anchor: CalendarAnchor): CalendarMonth {
  const tKey = todayKey();
  if (system === 'AD') return buildAdMonth(anchor.year, anchor.month, tKey);
  const bs = NepaliDate.fromAD(new Date(anchor.year, anchor.month, anchor.day)).getBS();
  return buildBsMonth(bs.year, bs.month, tKey);
}

/** Steps the anchor by one full month in the currently displayed system,
 * then returns the new anchor back in AD terms (year, month, and the
 * actual day the new BS month's 1st fell on — see CalendarAnchor). */
export function stepAnchor(system: CalendarSystem, anchor: CalendarAnchor, direction: 1 | -1): CalendarAnchor {
  if (system === 'AD') {
    const d = new Date(anchor.year, anchor.month + direction, 1);
    return { year: d.getFullYear(), month: d.getMonth(), day: 1 };
  }
  const bs = NepaliDate.fromAD(new Date(anchor.year, anchor.month, anchor.day)).getBS();
  const nextBs = new NepaliDate(bs.year, bs.month + direction, 1);
  const ad = nextBs.getAD();
  return { year: ad.year, month: ad.month, day: ad.date };
}

export function todayAnchor(): CalendarAnchor {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/** The AD date-key span (day 1 through the actual last day) of the calendar
 * month `anchor` falls in, in whichever `system` is active. The BS branch
 * computes the true BS month's own boundary (e.g. Shrawan's 31/32 days,
 * converted to AD) — not an AD month's span relabeled with BS names, which
 * is what selecting "Shrawan 2083" used to produce (some AD month that
 * straddles two BS months, e.g. 16 Shrawan - 15 Bhadra). */
export function monthDateRange(system: CalendarSystem, anchor: CalendarAnchor): { start: string; end: string } {
  if (system === 'AD') {
    const daysInMonth = new Date(anchor.year, anchor.month + 1, 0).getDate();
    return { start: dateKey(anchor.year, anchor.month, 1), end: dateKey(anchor.year, anchor.month, daysInMonth) };
  }
  const bs = NepaliDate.fromAD(new Date(anchor.year, anchor.month, anchor.day)).getBS();
  const daysInMonth = new NepaliDate(bs.year, bs.month + 1, 0).getDate();
  const firstAd = new NepaliDate(bs.year, bs.month, 1).getAD();
  const lastAd = new NepaliDate(bs.year, bs.month, daysInMonth).getAD();
  return { start: dateKey(firstAd.year, firstAd.month, firstAd.date), end: dateKey(lastAd.year, lastAd.month, lastAd.date) };
}

/** AD date key (YYYY-MM-DD) -> "DD/MM/YYYY" in the current calendar system. */
export function formatDdMmYyyy(adKey: string, system: CalendarSystem): string {
  const [y, m, d] = adKey.split('-').map(Number);
  if (system === 'AD') return `${pad(d)}/${pad(m)}/${y}`;
  return NepaliDate.fromAD(new Date(y, m - 1, d)).format('DD/MM/YYYY');
}

/** A selectable month-long period: a real calendar month in whichever
 * system it was built for, with its true AD start/end already resolved
 * (see monthDateRange()) — never an AD month wearing a BS label that
 * doesn't match its own day-1-to-last-day span. Shared by the admin
 * Payroll page and the employee my-payroll page so both pick periods the
 * same way. */
export type CalendarPeriod = { key: string; label: string; start: string; end: string };

export function adPeriod(year: number, month: number): CalendarPeriod {
  const anchor: CalendarAnchor = { year, month, day: 1 };
  const label = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return { key: `AD-${year}-${month}`, label, ...monthDateRange('AD', anchor) };
}

export function bsPeriod(bsYear: number, bsMonth: number): CalendarPeriod {
  const ad = new NepaliDate(bsYear, bsMonth, 1).getAD();
  const anchor: CalendarAnchor = { year: ad.year, month: ad.month, day: ad.date };
  const label = new NepaliDate(bsYear, bsMonth, 1).format('MMMM YYYY');
  return { key: `BS-${bsYear}-${bsMonth}`, label, ...monthDateRange('BS', anchor) };
}

export function systemPeriod(system: CalendarSystem, year: number, month: number): CalendarPeriod {
  return system === 'AD' ? adPeriod(year, month) : bsPeriod(year, month);
}

export function currentSystemYearMonth(system: CalendarSystem): { year: number; month: number } {
  const now = new Date();
  if (system === 'AD') return { year: now.getFullYear(), month: now.getMonth() };
  const bs = NepaliDate.fromAD(now).getBS();
  return { year: bs.year, month: bs.month };
}

function yearMonthIndex(year: number, month: number) {
  return year * 12 + month;
}

function indexToYearMonth(i: number) {
  return { year: Math.floor(i / 12), month: ((i % 12) + 12) % 12 };
}

/** One flat list of every period a "pick a month" dropdown can jump to,
 * instead of a separate Month select + Year select. Bounded to where
 * `dataRange` (the earliest/latest AD dates with actual data) says data
 * exists, capped to a max of 12 months back even if data goes further, but
 * "now" is always included so you can jump to the current month before any
 * of its data exists yet. `selected` is always kept selectable even if it
 * falls outside that computed window. */
export function buildPeriodOptions(
  system: CalendarSystem,
  dataRange: { earliest: Date; latest: Date } | null,
  selected: CalendarPeriod
): CalendarPeriod[] {
  const { year: nowYear, month: nowMonth } = currentSystemYearMonth(system);
  const currentIndex = yearMonthIndex(nowYear, nowMonth);

  let latestIndex = currentIndex;
  let earliestIndex = currentIndex - 11;
  if (dataRange) {
    const dataLatest =
      system === 'AD'
        ? { year: dataRange.latest.getFullYear(), month: dataRange.latest.getMonth() }
        : NepaliDate.fromAD(dataRange.latest).getBS();
    const dataEarliest =
      system === 'AD'
        ? { year: dataRange.earliest.getFullYear(), month: dataRange.earliest.getMonth() }
        : NepaliDate.fromAD(dataRange.earliest).getBS();
    latestIndex = Math.max(yearMonthIndex(dataLatest.year, dataLatest.month), currentIndex);
    earliestIndex = Math.max(yearMonthIndex(dataEarliest.year, dataEarliest.month), latestIndex - 11);
  }

  const options: CalendarPeriod[] = [];
  for (let i = earliestIndex; i <= latestIndex; i++) {
    const { year, month } = indexToYearMonth(i);
    options.push(systemPeriod(system, year, month));
  }

  if (!options.some(o => o.key === selected.key)) {
    options.push(selected);
    options.sort((a, b) => a.start.localeCompare(b.start));
  }
  return options;
}

/** Formats an AD date key (YYYY-MM-DD) for display in whichever calendar
 * system is currently active — the single place every page should go
 * through so a global AD/BS switch changes every displayed date at once. */
export function formatAdDate(adKey: string | null | undefined, system: CalendarSystem): string {
  if (!adKey) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(adKey);
  if (!m) return adKey;
  const [, y, mo, d] = m;
  if (system === 'AD') {
    return new Date(Number(y), Number(mo) - 1, Number(d)).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  return NepaliDate.fromAD(new Date(Number(y), Number(mo) - 1, Number(d))).format('D MMMM YYYY');
}

/** Formats a full ISO timestamp's clock time — reads the same regardless of
 * calendar system, so this never branches on AD/BS. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Formats a full ISO timestamp as "<date in the active calendar system> · <time>" —
 * the counterpart to formatAdDate() for values that carry a time-of-day too
 * (e.g. a last-punch or last-sync timestamp), not just a bare date. */
export function formatDateTime(value: string | null | undefined, system: CalendarSystem): string {
  if (!value) return '—';
  return `${formatAdDate(localDateKey(value), system)} · ${formatTime(value)}`;
}

export type WeekRange = { start: string; end: string; label: string; dates: string[] };

/** The Sun-Sat AD week (7 real calendar dates) containing `anchorKey` —
 * always AD, since the weekly duty roster is filled in Sun-Sat regardless
 * of which calendar system the rest of the app is currently displaying. */
export function weekRange(anchorKey: string): WeekRange {
  const [y, m, d] = anchorKey.split('-').map(Number);
  const anchor = new Date(y, m - 1, d);
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + i);
    dates.push(dateKey(day.getFullYear(), day.getMonth(), day.getDate()));
  }
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const label =
    sunday.getFullYear() === saturday.getFullYear()
      ? `${fmt(sunday)} – ${fmt(saturday)}, ${saturday.getFullYear()}`
      : `${fmt(sunday)}, ${sunday.getFullYear()} – ${fmt(saturday)}, ${saturday.getFullYear()}`;
  return { start: dates[0], end: dates[6], label, dates };
}

/** Steps `anchorKey` by one week (+1 or -1) — re-derive the new week with
 * weekRange() on the result. */
export function stepWeek(anchorKey: string, direction: 1 | -1): string {
  const [y, m, d] = anchorKey.split('-').map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + direction * 7);
  return dateKey(next.getFullYear(), next.getMonth(), next.getDate());
}
