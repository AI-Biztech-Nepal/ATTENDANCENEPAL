'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import EmployeeListPanel from '@/components/EmployeeListPanel';
import EmployeePicker from '@/components/EmployeePicker';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';
import TeamTodayCard from '@/components/TeamTodayCard';
import { useTeamToday } from '@/lib/teamToday';
import type { Employee } from '@/lib/types';

// Master/detail: the employee list stays beside the calendar (lg and up) so
// switching person is one click; below lg it folds into EmployeePicker. Each row
// shows how that person's day is going, and the compact Team today card sits under
// the list at the bottom of the column — the list is the long part and takes all the
// room the card leaves — and on a smaller screen the card drops to the bottom of the page.
export default function CalendarPage() {
  usePageTitle('Attendance Calendar');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  // One read of today's attendance feeds both the status on each list row and the card under the list.
  const team = useTeamToday(employees);

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
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* The left column is as tall as the calendar side, so the card ends level with the bottom of the page and
          nothing is left empty beside it. The list takes whatever the card leaves; it is pinned inside its box
          (absolute) so a long staff list scrolls there instead of making this column taller than the other. */}
      <div className="order-2 w-full lg:order-1 lg:flex lg:min-h-[calc(100vh-9rem)] lg:w-72 lg:shrink-0 lg:flex-col lg:gap-5">
        <div className="hidden lg:relative lg:block lg:min-h-[11rem] lg:flex-1">
          <div className="lg:absolute lg:inset-0 lg:flex">
            <EmployeeListPanel employees={employees} value={employeeId} onChange={setEmployeeId} statusOf={team.statusOf} />
          </div>
        </div>
        <TeamTodayCard summary={team.summary} nextHoliday={team.nextHoliday} />
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
