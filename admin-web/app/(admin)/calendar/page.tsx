'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Avatar from '@/components/Avatar';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';
import type { Employee } from '@/lib/types';

export default function CalendarPage() {
  usePageTitle('Attendance Calendar');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const selectedEmployee = employees.find(e => e.id === employeeId);

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
    <>
      <div className="mb-4 flex w-fit items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm">
        {selectedEmployee ? (
          <Avatar name={selectedEmployee.name} photoUrl={selectedEmployee.profile_photo_url} className="h-10 w-10 text-sm" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <UserIcon className="h-4 w-4" />
          </span>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-semibold uppercase leading-none tracking-wide text-slate-400">Employee</label>
          <select
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            className="max-w-[16rem] bg-transparent text-sm font-semibold text-ink focus:outline-none"
          >
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {employeeId && <EmployeeCalendarView employeeId={employeeId} />}
    </>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
