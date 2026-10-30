import NepaliDate from 'nepali-date-converter';

export type CalendarSystem = 'AD' | 'BS';

export type CalendarCell = {
  adKey: string;
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

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function chunkIntoWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

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

export type CalendarAnchor = { year: number; month: number; day: number };

export function buildMonth(system: CalendarSystem, anchor: CalendarAnchor): CalendarMonth {
  const tKey = todayKey();
  if (system === 'AD') return buildAdMonth(anchor.year, anchor.month, tKey);
  const bs = NepaliDate.fromAD(new Date(anchor.year, anchor.month, anchor.day)).getBS();
  return buildBsMonth(bs.year, bs.month, tKey);
}

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

export function formatDdMmYyyy(adKey: string, system: CalendarSystem): string {
  const [y, m, d] = adKey.split('-').map(Number);
  if (system === 'AD') return `${pad(d)}/${pad(m)}/${y}`;
  return NepaliDate.fromAD(new Date(y, m - 1, d)).format('DD/MM/YYYY');
}

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
    const dataLatest = system === 'AD' ? { year: dataRange.latest.getFullYear(), month: dataRange.latest.getMonth() } : NepaliDate.fromAD(dataRange.latest).getBS();
    const dataEarliest = system === 'AD' ? { year: dataRange.earliest.getFullYear(), month: dataRange.earliest.getMonth() } : NepaliDate.fromAD(dataRange.earliest).getBS();
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

export function formatAdDate(adKey: string | null | undefined, system: CalendarSystem): string {
  if (!adKey) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(adKey);
  if (!m) return adKey;
  const [, y, mo, d] = m;
  if (system === 'AD') {
    return new Date(Number(y), Number(mo) - 1, Number(d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return NepaliDate.fromAD(new Date(Number(y), Number(mo) - 1, Number(d))).format('D MMMM YYYY');
}

/** "Thu, 30 Oct 2026  ·  13 Kartik 2083" — both calendars at once, for the
 * greeting bands on the employee and owner home screens. */
export function formatTodayLine(adKey: string): string {
  const [y, mo, d] = adKey.split('-').map(Number);
  const weekday = new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday}, ${formatAdDate(adKey, 'AD')}  ·  ${formatAdDate(adKey, 'BS')}`;
}
