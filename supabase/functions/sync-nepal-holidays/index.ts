// Scrapes hamropatro.com's public holiday calendar and replaces
// nepal_public_holidays with whatever it currently says — run daily by
// pg_cron (see supabase/migrations/20260823200000_nepal_public_holidays.sql)
// so the New Holiday form's suggestions (admin-web/app/week-off/page.tsx)
// never get stuck on one BS year or drift out of date. Nepali festival
// dates are lunar/panchang-based and shift every year — there is no formula
// for them, only a real published calendar, hence the scrape instead of a
// hardcoded list.
//
// Deploy with: supabase functions deploy sync-nepal-holidays
// See supabase/functions/sync-nepal-holidays/README.md for the one-time
// setup this needs.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SOURCE_URL = 'https://www.hamropatro.com/en/nepali-public-holidays';

// Matches one <li> holiday row's essentials straight out of hamropatro's
// server-rendered HTML:
//   <a href="/en/date/2083-7-2" ...>
//     ...<span class="...text-text-primary">Dashain Holiday</span>
//     <span class="...text-text-secondary"><span class="block">Monday</span><span class="block">Oct 19, 2026</span></span>
//   </a>
// The BS date comes straight from the href (no BS<->AD conversion needed),
// the AD date from the second "block" span. Verified 2026-08-23 against the
// live page — if hamropatro ever redesigns this page, this regex simply
// stops matching and syncNepalHolidays() below returns 0 rows without
// touching the table (see the `if (rows.length === 0) return` guard), so a
// site redesign degrades to "stops updating," never "writes garbage."
const ROW_RE =
  /href="\/en\/date\/(\d+)-(\d+)-(\d+)"[^>]*>[\s\S]*?font-np text-body-md font-semibold text-text-primary">([^<]+)<\/span><span class="shrink-0 text-right font-np text-label-sm text-text-secondary"><span class="block">[^<]+<\/span><span class="block">([^<]+)<\/span>/g;

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** "Oct 19, 2026" -> "2026-10-19". Parsed by hand (not `new Date()`) so it's
 * not at the mercy of the runtime's default timezone shifting the date. */
function parseAdDate(text: string): string | null {
  const m = /^(\w{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const mm = MONTHS[m[1]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
}

/** First one or two "/"-separated tags from hamropatro's often long
 * combined name (e.g. "International Labour Day / Ubhauli Parwa / Buddha
 * Jayanti / Chandi Poornima / ...") — a short, human-picked-sounding label
 * instead of the full multi-tag string, capped so it never blows up the
 * New Holiday form's suggestion list. */
function shortName(raw: string): string {
  const decoded = decodeEntities(raw).trim();
  const parts = decoded.split('/').map(p => p.trim()).filter(Boolean);
  const short = parts.slice(0, 2).join(' / ');
  return short.length > 60 ? short.slice(0, 57) + '…' : short;
}

type ParsedRow = { name: string; date: string; bsYear: number };
type HolidayRange = { bsYear: number; name: string; start: string; end: string };

function addOneDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Groups calendar-adjacent rows into one ranged holiday ONLY when the run
 * also contains explicit "Dashain" or "Tihar" text somewhere in it — those
 * are the two festivals Nepal actually observes as a multi-day closure (the
 * government's own gazette calls out "5 days for Dashain, 5 for Tihar"),
 * but hamropatro labels each day in between with its own specific ritual
 * name (Maha Ashtami, Bijaya Dashami, Bhai Tika, ...) rather than repeating
 * "Dashain"/"Tihar" on every line, so pure date-adjacency alone isn't
 * enough. It also isn't safe on its own: several unrelated holidays happen
 * to land on consecutive calendar days most years (e.g. Bakar Eid ->
 * Republic Day, Raksha Bandhan -> Gaijatra) and must NOT be merged into one
 * holiday just because they're back-to-back. Requiring the keyword match is
 * what tells those two cases apart without hand-maintaining actual dates. */
function mergeFestivalRuns(rows: ParsedRow[]): HolidayRange[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const out: HolidayRange[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && addOneDay(sorted[j].date) === sorted[j + 1].date) j++;
    const run = sorted.slice(i, j + 1);
    const isDashain = run.some(r => /dashain/i.test(r.name));
    const isTihar = run.some(r => /tihar/i.test(r.name));
    if (run.length > 1 && (isDashain || isTihar)) {
      out.push({
        bsYear: run[0].bsYear,
        name: isDashain ? 'Dashain Holiday' : 'Tihar Holiday',
        start: run[0].date,
        end: run[run.length - 1].date,
      });
    } else {
      for (const r of run) out.push({ bsYear: r.bsYear, name: r.name, start: r.date, end: r.date });
    }
    i = j + 1;
  }
  return out;
}

export async function scrapeHamroPatro(): Promise<HolidayRange[]> {
  const res = await fetch(SOURCE_URL, {
    headers: {
      // hamropatro serves a different (JS-only) page to bare/bot-looking
      // requests — a normal desktop-browser UA is what got a scrapable
      // server-rendered response during testing.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`hamropatro.com returned ${res.status}`);
  const html = await res.text();

  const rows: ParsedRow[] = [];
  for (const m of html.matchAll(ROW_RE)) {
    const bsYear = Number(m[1]);
    const date = parseAdDate(m[5]);
    if (!date) continue;
    rows.push({ bsYear, name: shortName(m[4]), date });
  }
  return mergeFestivalRuns(rows);
}

Deno.serve(async req => {
  try {
    const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');
    if (!expected || authHeader !== `Bearer ${expected}`) {
      return new Response('Not authorized', { status: 401 });
    }

    const holidays = await scrapeHamroPatro();
    if (holidays.length === 0) {
      // hamropatro's markup changed, or the fetch got blocked — leave the
      // table exactly as it was rather than wiping it out with nothing.
      return new Response(JSON.stringify({ upserted: 0, note: 'No rows parsed — leaving existing data untouched' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Full replace per BS year seen in this scrape — the table is a pure
    // mirror of hamropatro, not user data, so there's nothing to preserve
    // across a run beyond "whatever the site says right now."
    const bsYears = [...new Set(holidays.map(h => h.bsYear))];
    const { error: deleteError } = await supabase.from('nepal_public_holidays').delete().in('bs_year', bsYears);
    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase.from('nepal_public_holidays').insert(
      holidays.map(h => ({ bs_year: h.bsYear, name: h.name, start_date: h.start, end_date: h.end }))
    );
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ upserted: holidays.length, bsYears }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('sync-nepal-holidays failed:', err);
    return new Response('Internal error', { status: 500 });
  }
});
