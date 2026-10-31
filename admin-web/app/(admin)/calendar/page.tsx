'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Avatar from '@/components/Avatar';
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
  const index = employees.findIndex(e => e.id === employeeId);
  const selected = index >= 0 ? employees[index] : undefined;

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
  // employee's month in turn.
  function step(delta: 1 | -1) {
    const next = employees[index + delta];
    if (next) setEmployeeId(next.id);
  }

  return (
    <div className="flex items-start gap-5">
      <div className="hidden lg:block">
        <EmployeeListPanel employees={employees} value={employeeId} onChange={setEmployeeId} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-3 lg:hidden">
          <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
        </div>

        {selected && (
          <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <Avatar name={selected.name} photoUrl={selected.profile_photo_url} className="h-12 w-12 text-base" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-extrabold text-ink">{selected.name}</h2>
              <p className="truncate text-sm font-semibold text-slate-500">
                {[selected.employee_code, selected.designation, selected.department].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            {employees.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-slate-500">
                  {index + 1} of {employees.length}
                </span>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={index <= 0}
                  aria-label="Previous employee"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ArrowIcon className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={index >= employees.length - 1}
                  aria-label="Next employee"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ArrowIcon className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {employeeId && <EmployeeCalendarView employeeId={employeeId} />}
      </div>
    </div>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
