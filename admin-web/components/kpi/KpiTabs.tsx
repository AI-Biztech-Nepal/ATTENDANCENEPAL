'use client';

import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { isKpiOn, type KpiId } from '@/lib/kpiSettings';
import { useKpiSettings } from '@/lib/useKpiSettings';

// The sections of one person's KPIs (/kpis/<employee>/...). Each is its own page, so these are links (the current
// one is marked with aria-current), not in-page tabs. Import and Settings are for the whole company, and show the
// same on every person's page. A section whose KPIs this company turned off (Settings) is left out, unless it is
// the page being looked at. The month on screen (`?date=`) is carried from one section to the next.
const SECTIONS: { path: string; label: string; uses?: KpiId[] }[] = [
  { path: '', label: 'Overview' },
  { path: '/feedback', label: 'Customer feedback', uses: ['feedback', 'nps'] },
  { path: '/reviews', label: 'Colleague reviews', uses: ['peers', 'manager', 'clevel', 'training'] },
  { path: '/import', label: 'Import', uses: ['services', 'rebooking', 'utilisation'] },
  { path: '/settings', label: 'Settings' },
];

export default function KpiTabs() {
  const pathname = usePathname();
  const { employeeId } = useParams<{ employeeId: string }>();
  const date = useSearchParams().get('date');
  const { settings, words, loaded } = useKpiSettings();
  const query = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : '';
  // Until the settings are read the tabs keep their place but are not shown, so a renamed or hidden tab does not flash.
  return (
    <nav aria-label="KPI sections" className={`flex flex-wrap gap-x-7 border-b border-slate-200 print:hidden ${loaded ? '' : 'invisible'}`}>
      {SECTIONS.map(s => ({ ...s, href: `/kpis/${employeeId}${s.path}` }))
        .filter(s => pathname === s.href || !s.uses || s.uses.some(id => isKpiOn(id, settings)))
        .map(s => {
          const current = pathname === s.href;
          return (
            <Link
              key={s.href}
              href={`${s.href}${query}`}
              aria-current={current ? 'page' : undefined}
              className={`-mb-px flex min-h-[48px] items-center border-b-[3px] px-0.5 text-sm ${
                current ? 'border-teal-700 font-extrabold text-teal-700' : 'border-transparent font-bold text-slate-600 hover:text-ink'
              }`}
            >
              {words.t(s.label)}
            </Link>
          );
        })}
    </nav>
  );
}
