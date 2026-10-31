'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import EmployeePicker from '@/components/EmployeePicker';
import EmployeeCalendarView from '@/components/EmployeeCalendarView';
import type { Employee } from '@/lib/types';

export default function CalendarPage() {
  usePageTitle('Attendance Calendar');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const index = employees.findIndex(e => e.id === employeeId);

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

  // Previous/next step through the same sorted list, for reviewing each
  // employee's month in turn without reopening the picker.
  function step(delta: 1 | -1) {
    const next = employees[index + delta];
    if (next) setEmployeeId(next.id);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
        {employees.length > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={index <= 0}
              aria-label="Previous employee"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowIcon className="h-4 w-4 rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={index < 0 || index >= employees.length - 1}
              aria-label="Next employee"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowIcon className="h-4 w-4" />
            </button>
            {index >= 0 && (
              <span className="ml-1 text-xs font-semibold text-slate-500">
                {index + 1} of {employees.length}
              </span>
            )}
          </div>
        )}
      </div>

      {employeeId && <EmployeeCalendarView employeeId={employeeId} />}
    </>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
