'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';
import { PageBody } from '@/components/employee/parts';

export default function MyCalendarPage() {
  usePageTitle('Calendar');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      setEmployeeId(profile?.employee_id ?? null);
    });
  }, []);

  if (loading) return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;
  if (!employeeId) return <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>;
  return (
    <PageBody>
      <EmployeeCalendarView employeeId={employeeId} />
    </PageBody>
  );
}
