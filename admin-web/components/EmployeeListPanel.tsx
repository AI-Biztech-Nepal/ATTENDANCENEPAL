'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';
import type { Employee } from '@/lib/types';

/**
 * Always-visible employee list for master/detail pages (Attendance
 * Calendar): search at the top, one row per employee, the selected one
 * highlighted and kept scrolled into view. Hidden below lg, where pages fall
 * back to EmployeePicker.
 */
export default function EmployeeListPanel({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      [e.name, e.employee_code, e.department, e.designation].some(v => v && String(v).toLowerCase().includes(q))
    );
  }, [employees, query]);

  // Prev/next on the page changes the selection from outside — keep it visible.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-id="${value}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [value]);

  return (
    <aside className="flex max-h-[calc(100vh-8rem)] w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="border-b border-slate-100 px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-extrabold text-ink">Employees</h2>
          <span className="text-xs font-semibold text-slate-500">
            {filtered.length === employees.length ? employees.length : `${filtered.length} of ${employees.length}`}
          </span>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-slate-500">
          <SearchIcon className="h-4 w-4 shrink-0" />
          <span className="sr-only">Search employees</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name or code"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
          />
        </label>
      </div>

      <ul ref={listRef} aria-label="Employees" className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No employees match “{query}”.</li>}
        {filtered.map(emp => {
          const selected = emp.id === value;
          const sub = [emp.employee_code, emp.department].filter(Boolean).join(' · ');
          return (
            <li key={emp.id} data-id={emp.id}>
              <button
                type="button"
                onClick={() => onChange(emp.id)}
                aria-current={selected ? 'true' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  selected ? 'bg-accent/10' : 'hover:bg-slate-50'
                }`}
              >
                <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-9 w-9 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${selected ? 'font-extrabold text-accent' : 'font-semibold text-ink'}`}>{emp.name}</span>
                  {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
