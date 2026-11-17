'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';
import type { Employee } from '@/lib/types';

/**
 * Searchable employee selector — replaces a plain <select> that only listed
 * names in one long scroll. Filters by name, employee code, department or
 * designation; ↑/↓ + Enter pick from the keyboard, Esc or an outside click
 * closes it.
 */
export default function EmployeePicker({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = employees.find(e => e.id === value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      [e.name, e.employee_code, e.department, e.designation].some(v => v && String(v).toLowerCase().includes(q))
    );
  }, [employees, query]);

  // Opening starts from a clean search with the current employee highlighted.
  function openPicker() {
    setQuery('');
    setHighlight(Math.max(0, employees.findIndex(e => e.id === value)));
    setOpen(true);
  }

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 text-left shadow-sm transition-colors hover:border-slate-300"
      >
        {selected ? (
          <Avatar name={selected.name} photoUrl={selected.profile_photo_url} className="h-10 w-10 text-sm" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <UserIcon className="h-4 w-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-semibold uppercase leading-none tracking-wide text-slate-400">Employee</span>
          <span className="mt-1 max-w-[16rem] truncate text-sm font-semibold text-ink">{selected?.name ?? 'Select employee'}</span>
        </span>
        <ChevronDownIcon className={`ml-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <label className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-slate-500">
              <SearchIcon className="h-4 w-4 shrink-0" />
              <span className="sr-only">Search employees</span>
              <input
                autoFocus
                type="search"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search name, code or department"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
              />
            </label>
          </div>
          <ul ref={listRef} role="listbox" aria-label="Employees" className="max-h-80 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No employees match “{query}”.</li>}
            {filtered.map((emp, i) => {
              const sub = [emp.employee_code, emp.department].filter(Boolean).join(' · ');
              const isSelected = emp.id === value;
              return (
                <li key={emp.id} role="option" aria-selected={isSelected} data-index={i}>
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(emp.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === highlight ? 'bg-accent/5' : ''}`}
                  >
                    <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${isSelected ? 'font-bold text-accent' : 'font-semibold text-ink'}`}>{emp.name}</span>
                      {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
                    </span>
                    {isSelected && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            {filtered.length === employees.length ? `${employees.length} active employees` : `${filtered.length} of ${employees.length} employees`}
          </div>
        </div>
      )}
    </div>
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

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
    </svg>
  );
}
