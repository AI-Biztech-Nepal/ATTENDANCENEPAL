'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import KpiTabs from '@/components/kpi/KpiTabs';

// One person's KPIs, on pages of their own (not part of the employee directory): the way back to the list, the
// person's name in the title, and the sections: Overview, Customer feedback, Colleague reviews, Import and
// Settings. Import and Settings are for the whole company and are the same on every person's page.
export default function PersonKpiLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams needs a Suspense boundary, like the other pages that read the address.
  return (
    <Suspense fallback={null}>
      <Frame>{children}</Frame>
    </Suspense>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { employeeId } = useParams<{ employeeId: string }>();
  const date = useSearchParams().get('date');
  const [person, setPerson] = useState<{ name: string } | 'missing' | null>(null);

  useEffect(() => {
    let live = true;
    setPerson(null);
    supabase
      .from('employees')
      .select('id, name')
      .eq('id', employeeId)
      .single()
      .then(({ data, error }) => {
        if (live) setPerson(error || !data ? 'missing' : { name: (data as { name: string }).name });
      });
    return () => {
      live = false;
    };
  }, [employeeId]);

  // "KPIs" above the name once it is known; until then just "KPIs", not the same word twice.
  const name = person && person !== 'missing' ? person.name : '';
  usePageTitle(name || 'KPIs', name ? 'KPIs' : '');

  const back = (
    <Link href={`/kpis${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''}`} className="inline-flex items-center gap-1.5 self-start text-[13px] font-extrabold text-accent hover:underline print:hidden">
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 6-6 6 6 6" />
      </svg>
      All employees&apos; KPIs
    </Link>
  );

  if (person === 'missing') {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm font-semibold text-slate-700 shadow-sm">
          That employee was not found.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <KpiTabs />
      {children}
    </div>
  );
}
