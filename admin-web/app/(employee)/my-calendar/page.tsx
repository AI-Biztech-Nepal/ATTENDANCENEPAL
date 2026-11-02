'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';

export default function MyCalendarPage() {
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

  return (
    // flush: the calendar draws its own green hero panel edge to edge on a phone.
    <EmployeeShell title="Calendar" flush>
      {loading ? (
        <p className="p-4 text-center text-sm text-slate-500">Loading…</p>
      ) : !employeeId ? (
        <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <EmployeeCalendarView employeeId={employeeId} variant="portal" />
      )}
    </EmployeeShell>
  );
}
