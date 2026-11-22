'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The sections of the KPI module. Only the ones that exist are listed; each is its own page, so these are
// links (the current one is marked with aria-current), not in-page tabs.
const SECTIONS = [
  { href: '/kpis', label: 'Overview' },
  { href: '/kpis/feedback', label: 'Customer feedback' },
  { href: '/kpis/reviews', label: 'Colleague reviews' },
];

export default function KpiTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="KPI sections" className="flex flex-wrap gap-x-7 border-b border-slate-200">
      {SECTIONS.map(s => {
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
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
