'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isKpiOn, type KpiId } from '@/lib/kpiSettings';
import { useKpiSettings } from '@/lib/useKpiSettings';

// The sections of the KPI module. Only the ones that exist are listed; each is its own page, so these are
// links (the current one is marked with aria-current), not in-page tabs. A section whose KPIs this company
// turned off (Settings) is left out, unless it is the page being looked at.
const SECTIONS: { href: string; label: string; uses?: KpiId[] }[] = [
  { href: '/kpis', label: 'Overview' },
  { href: '/kpis/feedback', label: 'Customer feedback', uses: ['feedback', 'nps'] },
  { href: '/kpis/reviews', label: 'Colleague reviews', uses: ['peers', 'manager', 'clevel', 'training'] },
  { href: '/kpis/import', label: 'Import', uses: ['services', 'rebooking', 'utilisation'] },
  { href: '/kpis/settings', label: 'Settings' },
];

export default function KpiTabs() {
  const pathname = usePathname();
  const { settings, words, loaded } = useKpiSettings();
  // Until the settings are read the tabs keep their place but are not shown, so a renamed or hidden tab does not flash.
  return (
    <nav aria-label="KPI sections" className={`flex flex-wrap gap-x-7 border-b border-slate-200 ${loaded ? '' : 'invisible'}`}>
      {SECTIONS.filter(s => pathname === s.href || !s.uses || s.uses.some(id => isKpiOn(id, settings))).map(s => {
        const current = pathname === s.href;
        return (
          <Link
            key={s.href}
            href={s.href}
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
