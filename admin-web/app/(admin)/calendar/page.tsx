'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import EmployeeListPanel from '@/components/EmployeeListPanel';
import EmployeePicker from '@/components/EmployeePicker';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';
import TeamTodayCard from '@/components/TeamTodayCard';
import type { Employee } from '@/lib/types';

// Master/detail: the employee list stays beside the calendar (lg and up) so
// switching person is one click; below lg it folds into EmployeePicker. The
// Team today card sits under the list — the list takes the room the card leaves,
// so both fit on the first screen — and on a smaller screen it drops to the
// bottom of the page.
export default function CalendarPage() {
  usePageTitle('Attendance Calendar');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => {
        const sorted = (data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setEmployees(sorted);
        if (sorted.length > 0) setEmployeeId(sorted[0].id);
      });
  }, []);

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="order-2 w-full lg:order-1 lg:flex lg:max-h-[calc(100vh-9rem)] lg:w-72 lg:shrink-0 lg:flex-col lg:gap-5">
        <div className="hidden min-h-0 lg:flex lg:flex-1">
          <EmployeeListPanel employees={employees} value={employeeId} onChange={setEmployeeId} />
        </div>
        <TeamTodayCard employees={employees} />
      </div>

      <div className="order-1 min-w-0 flex-1 lg:order-2">
        <div className="mb-3 lg:hidden">
          <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
        </div>

        {employeeId && <EmployeeCalendarView employeeId={employeeId} />}
      </div>
    </div>
  );
}
