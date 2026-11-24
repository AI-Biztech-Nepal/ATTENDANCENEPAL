'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import KpiTabs from '@/components/kpi/KpiTabs';

// One person's KPIs, on pages of their own (not part of the employee directory): the sections Overview, Customer
// feedback, Colleague reviews and Import. Import is for the whole company and is the same on every person's page.
// The header only says "KPIs" (the person's name is on their card below it), and the way back to the list is the
// KPIs item in the sidebar, so the page has no back link of its own.
export default function PersonKpiLayout({ children }: { children: React.ReactNode }) {
  // The sections read the address (`?date=`), which needs a Suspense boundary, like the other pages that do.
  return (
    <Suspense fallback={null}>
      <Frame>{children}</Frame>
    </Suspense>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { employeeId } = useParams<{ employeeId: string }>();
  // Whether this employee exists: null while it is being read.
  const [found, setFound] = useState<boolean | null>(null);
  usePageTitle('KPIs');

  useEffect(() => {
    let live = true;
    setFound(null);
    supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .single()
      .then(({ data, error }) => {
        if (live) setFound(!error && !!data);
      });
    return () => {
      live = false;
    };
  }, [employeeId]);

  if (found === false) {
    return (
      <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm font-semibold text-slate-700 shadow-sm">
        That employee was not found.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <KpiTabs />
      {children}
    </div>
  );
}
