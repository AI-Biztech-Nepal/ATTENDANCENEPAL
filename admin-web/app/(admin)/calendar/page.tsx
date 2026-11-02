'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import EmployeeListPanel from '@/components/EmployeeListPanel';
import EmployeePicker from '@/components/EmployeePicker';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';
import type { Employee } from '@/lib/types';

// Master/detail: the employee list stays beside the calendar (lg and up) so
// switching person is one click; below lg it folds into EmployeePicker.
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
    <div className="flex items-start gap-5">
      <div className="hidden lg:block">
        <EmployeeListPanel employees={employees} value={employeeId} onChange={setEmployeeId} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-3 lg:hidden">
          <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
        </div>

        {employeeId && <EmployeeCalendarView employeeId={employeeId} />}
      </div>
    </div>
  );
}
