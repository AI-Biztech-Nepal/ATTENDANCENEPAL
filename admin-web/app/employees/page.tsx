'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useConfirm } from '@/components/ConfirmDialog';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, Shift, Profile, Branch, Department } from '@/lib/types';
import { resolveShift, formatShiftHours } from '@/lib/shift';

const PAGE_SIZE = 10;

const EMPTY_FORM = {
  employee_code: '',
  name: '',
  username: '',
  email: '',
  phone: '',
  address: '',
  gender: '',
  department: '',
  designation: '',
  fingerprint_id: '',
  branch_id: '',
  date_of_joining: '',
  pan_no: '',
  ssf_no: '',
  emergency_contact_name: '',
  emergency_contact_relationship: '',
  emergency_contact_phone: '',
};

const CSV_COLUMNS = ['employee_code', 'name', 'email', 'phone', 'department', 'designation', 'fingerprint_id'] as const;

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  return out;
}

// Minimal CSV parser: handles quoted fields ("a,b") and escaped quotes (""),
// which covers what a spreadsheet export actually produces — no need for a
// dependency for a 7-column import.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some(v => v.trim() !== '')) rows.push(row);
  }
  return rows;
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={null}>
      <EmployeesView />
    </Suspense>
  );
}

function EmployeesView() {
  const confirm = useConfirm();
  const { system } = useCalendarSystem();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterEmployeeIds, setRosterEmployeeIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'employee_id' | 'role'>[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; failed: { row: number; error: string }[] } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-row photo upload uses one shared hidden <input>, remembering which
  // employee it was opened for.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoTargetId, setPhotoTargetId] = useState<string | null>(null);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);

  // Branch/Department/Designation edits are staged here rather than saved
  // immediately on change — a Save/Cancel bar appears above the table once
  // anything's pending, so a stray click on a dropdown can't silently write
  // to the database. Shift assignment is handled on the Shifts page instead,
  // not here.
  const [pendingBranch, setPendingBranch] = useState<Record<string, string>>({});
  const [pendingDepartment, setPendingDepartment] = useState<Record<string, string>>({});
  const [pendingDesignation, setPendingDesignation] = useState<Record<string, string>>({});
  const [savingPending, setSavingPending] = useState(false);

  // Username edits its own row, with its own Save/Cancel (not staged with
  // Branch/Shift) since it's a sensitive, immediate auth-email change.
  const [editingUsernameId, setEditingUsernameId] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  const [loginModalEmployee, setLoginModalEmployee] = useState<Employee | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginResult, setLoginResult] = useState<{ email: string; password: string } | null>(null);

  const [resetModalEmployee, setResetModalEmployee] = useState<Employee | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);

  const [loginEmailByEmployee, setLoginEmailByEmployee] = useState<Record<string, string>>({});

  // Permanently deleting an employee (not just the normal "Remove", which
  // is deliberately blocked once real history exists) needs its own,
  // heavier confirmation — typing the name back, not a single OK click —
  // since it erases attendance/payroll/task/leave history with no undo.
  const [forceDeleteEmployee, setForceDeleteEmployee] = useState<Employee | null>(null);
  const [forceDeleteConfirmText, setForceDeleteConfirmText] = useState('');
  const [forceDeleting, setForceDeleting] = useState(false);
  const [forceDeleteError, setForceDeleteError] = useState<string | null>(null);

  function reload() {
    supabase.from('employees').select('*').order('created_at', { ascending: false }).then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('employee_id')
      .then(({ data }) => setRosterEmployeeIds(new Set((data ?? []).map(r => r.employee_id))));
    supabase.from('profiles').select('id, employee_id, role').then(({ data }) => setProfiles(data ?? []));
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartmentOptions(data ?? []));
    loadLoginEmails();
  }

  async function loadLoginEmails() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const res = await fetch('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const map: Record<string, string> = {};
    for (const acc of body.accounts ?? []) {
      if (acc.employeeId) map[acc.employeeId] = acc.email;
    }
    setLoginEmailByEmployee(map);
  }

  function startEditUsername(emp: Employee) {
    setEditingUsernameId(emp.id);
    setUsernameDraft(loginEmailByEmployee[emp.id] ?? '');
  }

  function cancelEditUsername() {
    setEditingUsernameId(null);
    setUsernameDraft('');
  }

  async function saveUsername(emp: Employee) {
    const email = usernameDraft.trim();
    if (!email) {
      alert('Username cannot be empty.');
      return;
    }
    if (email === (loginEmailByEmployee[emp.id] ?? '')) {
      // Unchanged — nothing to save, just close the editor.
      setEditingUsernameId(null);
      return;
    }
    setSavingUsername(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSavingUsername(false);
      alert('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/update-login-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId: emp.id, email }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingUsername(false);
    if (!res.ok) {
      const message: string = body.error ?? 'unknown error';
      alert(
        /already been registered|already exists|duplicate/i.test(message)
          ? 'That username is already used by another login — usernames must be unique.'
          : `Could not update the username: ${message}`
      );
      return;
    }
    setEditingUsernameId(null);
    loadLoginEmails();
  }

  useEffect(reload, []);

  // Deep-link support for the sidebar's "Resigned" tab (/employees?filter=Resigned).
  // useSearchParams (not window.location) is required here — this route
  // doesn't remount when only its query string changes via a client-side
  // Link, so a mount-only read of window.location.search never re-fired.
  const searchParams = useSearchParams();
  const filterParam = searchParams.get('filter');
  useEffect(() => {
    if (filterParam) setFilter(filterParam);
  }, [filterParam]);

  // Let Escape close the Add Employee modal — the mobile/back-button
  // expectation for a modal that otherwise only closes via its own buttons.
  useEffect(() => {
    if (!showForm) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowForm(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showForm]);

  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[],
    [employees]
  );

  const linkedEmployeeIds = useMemo(
    () => new Set(profiles.map(p => p.employee_id).filter((id): id is string => Boolean(id))),
    [profiles]
  );

  const filtered = useMemo(() => {
    // "Mark Resigned" promises to remove someone from active views — this is
    // the view that promise was never actually kept for, so a resigned
    // employee stayed mixed in with active staff indefinitely. Resigned
    // employees now only show up under the explicit "Resigned" filter.
    let list = employees;
    if (filter === 'Resigned') {
      list = list.filter(e => e.status !== 'active');
    } else {
      list = list.filter(e => e.status === 'active');
      if (filter === 'Unenrolled') list = list.filter(e => !e.fingerprint_id);
      else if (filter !== 'All') list = list.filter(e => e.department === filter);
    }

    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(e => {
        const shift = resolveShift(e, shifts);
        return [e.name, e.employee_code, e.phone, e.email, e.department, e.designation, e.fingerprint_id, shift.name, formatShiftHours(shift)]
          .filter(Boolean)
          .some(v => (v as string).toLowerCase().includes(term));
      });
    }
    // By employee code, so the list stays in a stable, predictable sequence
    // instead of a just-added (often not-yet-enrolled) employee jumping to
    // the top and reshuffling everyone else.
    return [...list].sort((a, b) => a.employee_code.localeCompare(b.employee_code, undefined, { numeric: true }));
  }, [employees, shifts, filter, search]);

  const searchSuggestions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    const seen = new Set<string>();
    const matches: string[] = [];
    for (const e of employees) {
      if (e.name.toLowerCase().includes(term) && !seen.has(e.name)) {
        seen.add(e.name);
        matches.push(e.name);
        if (matches.length >= 6) break;
      }
    }
    return matches;
  }, [employees, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const { error } = await supabase.from('employees').insert({
      employee_code: form.employee_code,
      name: form.name,
      username: form.username || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
      gender: form.gender || null,
      pan_no: form.pan_no || null,
      ssf_no: form.ssf_no || null,
      department: form.department || null,
      designation: form.designation || null,
      fingerprint_id: form.fingerprint_id || null,
      branch_id: form.branch_id || null,
      date_of_joining: form.date_of_joining || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_relationship: form.emergency_contact_relationship || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      status: 'active',
    });
    setSaving(false);
    if (error) {
      if (error.code === '23505') {
        setFormError(
          error.message.includes('email')
            ? 'That email is already used by another employee.'
            : 'That Employee ID is already in use — each employee needs a unique ID.'
        );
      } else {
        setFormError(error.message);
      }
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function handleDelete(id: string) {
    if (!(await confirm('Remove this employee?', { title: 'Remove employee?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) {
      if (error.code === '23503') {
        alert(
          'Could not remove: this employee already has attendance, tasks, shifts, leave, or other records tied to them, ' +
            'so deleting would break that history. Use "Mark Resigned" instead — it keeps their history but removes them ' +
            'from active views. If you specifically want their history erased too, mark them resigned first, then use ' +
            '"Permanently Delete" under the Resigned Employees filter.'
        );
      } else {
        alert(`Could not remove: ${error.message}`);
      }
      return;
    }
    reload();
  }

  async function handleMarkResigned(emp: Employee) {
    if (!(await confirm(`Mark ${emp.name} as resigned? They'll be removed from active views but their history is kept.`, { title: 'Mark as resigned?', confirmLabel: 'Mark resigned', tone: 'danger' }))) return;
    const { error } = await supabase
      .from('employees')
      .update({ status: 'inactive', resigned_at: new Date().toISOString().slice(0, 10) })
      .eq('id', emp.id);
    if (error) alert(`Could not update: ${error.message}`);
    reload();
  }

  async function handleRestore(emp: Employee) {
    if (!(await confirm(`Restore ${emp.name} to active? They'll show up in active views again.`, { title: 'Restore employee?', confirmLabel: 'Restore' }))) return;
    const { error } = await supabase.from('employees').update({ status: 'active', resigned_at: null }).eq('id', emp.id);
    if (error) alert(`Could not update: ${error.message}`);
    reload();
  }

  function openForceDelete(emp: Employee) {
    setForceDeleteEmployee(emp);
    setForceDeleteConfirmText('');
    setForceDeleteError(null);
  }

  async function handleForceDelete() {
    if (!forceDeleteEmployee) return;
    setForceDeleting(true);
    setForceDeleteError(null);
    const { error } = await supabase.rpc('admin_force_delete_employee', { p_employee_id: forceDeleteEmployee.id });
    setForceDeleting(false);
    if (error) {
      setForceDeleteError(error.message);
      return;
    }
    setForceDeleteEmployee(null);
    reload();
  }

  async function handleCsvSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) return;

    // Map columns by header name, not position — a positional mapping
    // silently wrote values into the wrong fields for any CSV whose column
    // order didn't exactly match CSV_COLUMNS (e.g. a different HR export).
    // A header row identifying every required column is now mandatory,
    // rather than optionally skipped, since there's no safe way to guess
    // column order without it.
    const header = rows[0].map(h => h.trim().toLowerCase());
    const missingColumns = CSV_COLUMNS.filter(col => !header.includes(col));
    if (missingColumns.length > 0) {
      setImportResult({
        inserted: 0,
        failed: [{ row: 1, error: `CSV must have a header row including: ${CSV_COLUMNS.join(', ')} (missing: ${missingColumns.join(', ')})` }],
      });
      return;
    }
    const colIndex = Object.fromEntries(CSV_COLUMNS.map(col => [col, header.indexOf(col)])) as Record<(typeof CSV_COLUMNS)[number], number>;
    const dataRows = rows.slice(1);

    setImporting(true);
    setImportResult(null);
    const failed: { row: number; error: string }[] = [];
    let inserted = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const cols = dataRows[i];
      const record: Record<string, string | null> = {};
      CSV_COLUMNS.forEach(col => {
        const value = cols[colIndex[col]]?.trim();
        record[col] = value || null;
      });
      if (!record.employee_code || !record.name) {
        failed.push({ row: i + 2, error: 'employee_code and name are required' });
        continue;
      }
      const { error } = await supabase.from('employees').insert({ ...record, status: 'active' });
      if (error) failed.push({ row: i + 2, error: error.message });
      else inserted++;
    }

    setImporting(false);
    setImportResult({ inserted, failed });
    reload();
  }

  function openPhotoPicker(employeeId: string) {
    setPhotoTargetId(employeeId);
    photoInputRef.current?.click();
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingPhotoFile(file);
  }

  async function handlePhotoCropped(blob: Blob) {
    const employeeId = photoTargetId;
    if (!employeeId) return;

    setUploadingPhotoId(employeeId);
    const path = `employee-photos/${employeeId}-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, blob, {
      contentType: 'image/jpeg',
    });
    if (uploadError) {
      setUploadingPhotoId(null);
      alert(`Photo upload failed: ${uploadError.message}`);
      return;
    }
    const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
    await supabase.from('employees').update({ profile_photo_url: publicUrl.publicUrl }).eq('id', employeeId);
    setUploadingPhotoId(null);
    setPendingPhotoFile(null);
    reload();
  }

  const pendingCount =
    Object.keys(pendingBranch).length + Object.keys(pendingDepartment).length + Object.keys(pendingDesignation).length;

  function handleCancelPending() {
    setPendingBranch({});
    setPendingDepartment({});
    setPendingDesignation({});
  }

  async function handleSavePending() {
    setSavingPending(true);
    const employeeIds = new Set([
      ...Object.keys(pendingBranch),
      ...Object.keys(pendingDepartment),
      ...Object.keys(pendingDesignation),
    ]);
    const errors: string[] = [];
    for (const employeeId of employeeIds) {
      const updates: Record<string, string | null> = {};
      if (employeeId in pendingBranch) updates.branch_id = pendingBranch[employeeId] || null;
      if (employeeId in pendingDepartment) updates.department = pendingDepartment[employeeId] || null;
      if (employeeId in pendingDesignation) updates.designation = pendingDesignation[employeeId] || null;
      const { error } = await supabase.from('employees').update(updates).eq('id', employeeId);
      if (error) errors.push(error.message);
    }
    setSavingPending(false);
    setPendingBranch({});
    setPendingDepartment({});
    setPendingDesignation({});
    if (errors.length > 0) alert(`Some changes could not be saved:\n${errors.join('\n')}`);
    reload();
  }

  function openLoginModal(emp: Employee) {
    setLoginForm({ email: emp.email ?? '', password: generatePassword() });
    setLoginError(null);
    setLoginResult(null);
    setLoginModalEmployee(emp);
  }

  async function handleCreateLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginModalEmployee) return;
    setCreatingLogin(true);
    setLoginError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setCreatingLogin(false);
      setLoginError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/create-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId: loginModalEmployee.id, email: loginForm.email, password: loginForm.password }),
    });
    const body = await res.json().catch(() => ({}));
    setCreatingLogin(false);
    if (!res.ok) {
      setLoginError(body.error ?? 'Could not create the login.');
      return;
    }
    setLoginResult({ email: loginForm.email, password: loginForm.password });
    reload();
  }

  function openResetModal(emp: Employee) {
    setResetPassword(generatePassword());
    setResetError(null);
    setResetResult(null);
    setResetModalEmployee(emp);
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetModalEmployee) return;
    setResettingPassword(true);
    setResetError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setResettingPassword(false);
      setResetError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId: resetModalEmployee.id, password: resetPassword }),
    });
    const body = await res.json().catch(() => ({}));
    setResettingPassword(false);
    if (!res.ok) {
      setResetError(body.error ?? 'Could not reset the password.');
      return;
    }
    setResetResult(resetPassword);
  }

  return (
    <AppShell title="Employee Directory">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <FilterIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
            <select
              value={filter}
              onChange={e => {
                setFilter(e.target.value);
                setPage(1);
              }}
              className="min-w-[13rem] rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm font-medium text-ink shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {['All', ...departments, 'Unenrolled', 'Resigned'].map(f => (
                <option key={f} value={f}>
                  {f === 'All' ? 'All Departments' : f === 'Unenrolled' ? 'Biometric Unenrolled' : f === 'Resigned' ? 'Resigned Employees' : f}
                </option>
              ))}
            </select>
          </div>

          <div
            ref={searchBoxRef}
            tabIndex={-1}
            onBlur={e => {
              if (!searchBoxRef.current?.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
            }}
            className="relative"
          >
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search employees..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              className="w-56 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {suggestionsOpen && searchSuggestions.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {searchSuggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSearch(s);
                      setPage(1);
                      setSuggestionsOpen(false);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvSelected} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {importing ? 'Importing…' : '⭱ Import CSV'}
          </button>
          {filter !== 'Resigned' && (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
            >
              + Add Employee
            </button>
          )}
        </div>
      </div>

      {importResult && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-ink">
            Imported {importResult.inserted} employee{importResult.inserted === 1 ? '' : 's'}
            {importResult.failed.length > 0 && `, ${importResult.failed.length} failed`}.
          </p>
          {importResult.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-critical">
              {importResult.failed.map((f, i) => (
                <li key={i}>
                  Row {f.row}: {f.error}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setImportResult(null)} className="mt-2 text-xs text-slate-500 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <p className="mb-3 text-xs text-slate-400">
        CSV columns: employee_code, name, email, phone, department, designation, fingerprint_id (header row optional).
      </p>

      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      {pendingCount > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5">
          <span className="text-sm font-medium text-ink">
            {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleCancelPending}
              disabled={savingPending}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePending}
              disabled={savingPending}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {savingPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Mobile: one stacked card per employee — no side-scrolling. */}
        <div className="divide-y divide-slate-100 md:hidden">
          {pageItems.map(emp => {
            const shift = resolveShift(emp, shifts);
            return (
              <div key={emp.id} className="p-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openPhotoPicker(emp.id)}
                    title="Upload photo"
                    className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-accent/10 text-sm font-semibold text-accent"
                  >
                    {uploadingPhotoId === emp.id ? (
                      <span className="flex h-full w-full items-center justify-center">…</span>
                    ) : emp.profile_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={emp.profile_photo_url} alt={emp.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">{emp.name.slice(0, 1)}</span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${emp.id}`} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                      {emp.name}
                    </Link>
                    <div className="mt-0.5 truncate text-xs text-slate-400">{emp.phone ?? '—'}</div>
                    {emp.email && <div className="truncate text-xs text-slate-400">{emp.email}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={emp.fingerprint_id ? 'good' : 'neutral'}>{emp.fingerprint_id ? 'Bio Enrolled' : 'Not Enrolled'}</Badge>
                    {linkedEmployeeIds.has(emp.id) && <Badge tone="good">Login Active</Badge>}
                    {emp.attendance_exempt && <Badge tone="neutral">Excused</Badge>}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">ID</dt>
                    <dd className="font-semibold text-ink">{emp.fingerprint_id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Date of Joining</dt>
                    <dd className="text-slate-600">{emp.date_of_joining ? formatAdDate(emp.date_of_joining, system) : '—'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-400">Username</dt>
                    <dd>
                      {linkedEmployeeIds.has(emp.id) ? (
                        editingUsernameId === emp.id ? (
                          <div className="flex flex-col items-start gap-1.5">
                            <input
                              type="email"
                              autoFocus
                              value={usernameDraft}
                              onChange={e => setUsernameDraft(e.target.value)}
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm font-semibold text-ink"
                            />
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={() => saveUsername(emp)}
                                disabled={savingUsername}
                                className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
                              >
                                {savingUsername ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditUsername}
                                className="text-xs font-medium text-slate-400 hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="break-all text-sm font-semibold text-ink">
                              {loginEmailByEmployee[emp.id] ?? '—'}
                            </span>
                            <button
                              type="button"
                              onClick={() => startEditUsername(emp)}
                              title="Edit username"
                              className="shrink-0 text-slate-400 hover:text-accent"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Shift</dt>
                    <dd>
                      {rosterEmployeeIds.has(emp.id) ? (
                        <Link
                          href="/shifts?tab=roster"
                          className="inline-block rounded-lg border border-accent/20 bg-accent/5 px-2 py-1.5 text-center text-xs font-semibold text-accent hover:bg-accent/10"
                        >
                          Custom — Weekly Roster
                        </Link>
                      ) : (
                        <span className="inline-flex flex-col items-center gap-0.5 rounded-lg border border-slate-200 px-2 py-1.5 text-center">
                          <span className="text-xs font-semibold text-ink">{shift.name}</span>
                          <span className="text-[10px] text-slate-400">{formatShiftHours(shift)}</span>
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Branch</dt>
                    <dd>
                      <select
                        value={pendingBranch[emp.id] ?? (emp.branch_id ?? '')}
                        onChange={e => setPendingBranch(p => ({ ...p, [emp.id]: e.target.value }))}
                        className={`w-full rounded-md border px-2 py-1 text-xs ${
                          (pendingBranch[emp.id] ?? emp.branch_id) ? 'border-slate-200 text-slate-600' : 'border-warning text-warning-text'
                        }`}
                      >
                        <option value="">Unassigned</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Department</dt>
                    <dd>
                      <select
                        value={pendingDepartment[emp.id] ?? (emp.department ?? '')}
                        onChange={e => setPendingDepartment(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      >
                        <option value="">No department</option>
                        {departmentOptions.map(d => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                        {emp.department && !departmentOptions.some(d => d.name === emp.department) && (
                          <option value={emp.department}>{emp.department}</option>
                        )}
                      </select>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-400">Designation</dt>
                    <dd>
                      <input
                        type="text"
                        placeholder="—"
                        value={pendingDesignation[emp.id] ?? (emp.designation ?? '')}
                        onChange={e => setPendingDesignation(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      />
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                  {linkedEmployeeIds.has(emp.id) ? (
                    <ActionTile icon={<KeyIcon className="h-4 w-4" />} label="Reset password" tone="accent" onClick={() => openResetModal(emp)} />
                  ) : (
                    <ActionTile icon={<KeyIcon className="h-4 w-4" />} label="Create login" tone="accent" onClick={() => openLoginModal(emp)} />
                  )}
                  {emp.status === 'active' && (
                    <ActionTile
                      icon={<UserMinusIcon className="h-4 w-4" />}
                      label="Mark Resigned"
                      tone="warning"
                      onClick={() => handleMarkResigned(emp)}
                    />
                  )}
                  <ActionTile icon={<TrashIcon className="h-4 w-4" />} label="Remove" tone="critical" onClick={() => handleDelete(emp.id)} />
                  {emp.status !== 'active' && (
                    <>
                      <ActionTile
                        icon={<RestoreIcon className="h-4 w-4" />}
                        label="Restore"
                        tone="accent"
                        onClick={() => handleRestore(emp)}
                      />
                      <ActionTile
                        icon={<TrashIcon className="h-4 w-4" />}
                        label="Permanently Delete"
                        tone="critical"
                        onClick={() => openForceDelete(emp)}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {pageItems.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-400">No employees match this filter.</div>
          )}
        </div>

        {/* Desktop: full table. */}
        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-3 text-center font-medium">ID</th>
                <th className="px-3 py-3 text-center font-medium">Employee Name</th>
                <th className="px-2 py-3 text-center font-medium">Username</th>
                <th className="w-32 px-2 py-3 text-center font-medium">Date of Joining</th>
                <th className="w-28 px-2 py-3 text-center font-medium">Branch</th>
                <th className="w-32 px-2 py-3 text-center font-medium">Department</th>
                <th className="w-28 px-2 py-3 text-center font-medium">Designation</th>
                <th className="w-32 px-2 py-3 text-center font-medium">Shift</th>
                <th className="px-3 py-3 text-center font-medium">Bio Enrollment</th>
                <th className="px-3 py-3 text-center font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(emp => {
                const shift = resolveShift(emp, shifts);
                return (
                  <tr key={emp.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-3 text-center text-sm font-semibold text-ink">{emp.fingerprint_id ?? '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openPhotoPicker(emp.id)}
                          title="Upload photo"
                          className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-accent/10 text-xs font-semibold text-accent"
                        >
                          {uploadingPhotoId === emp.id ? (
                            <span className="flex h-full w-full items-center justify-center">…</span>
                          ) : emp.profile_photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={emp.profile_photo_url} alt={emp.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center">{emp.name.slice(0, 1)}</span>
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Link href={`/employees/${emp.id}`} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                              {emp.name}
                            </Link>
                            {emp.attendance_exempt && <Badge tone="neutral">Excused</Badge>}
                          </div>
                          <div className="truncate text-xs text-slate-400">{emp.phone ?? '—'}</div>
                          {emp.email && <div className="truncate text-xs text-slate-400">{emp.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {linkedEmployeeIds.has(emp.id) ? (
                        editingUsernameId === emp.id ? (
                          <div className="flex flex-col items-start gap-1.5">
                            <input
                              type="email"
                              autoFocus
                              value={usernameDraft}
                              onChange={e => setUsernameDraft(e.target.value)}
                              className="w-full min-w-[12rem] rounded-md border border-slate-200 px-1.5 py-1 text-sm font-semibold text-ink"
                            />
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={() => saveUsername(emp)}
                                disabled={savingUsername}
                                className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
                              >
                                {savingUsername ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditUsername}
                                className="text-xs font-medium text-slate-400 hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="whitespace-nowrap text-sm font-semibold text-ink">
                              {loginEmailByEmployee[emp.id] ?? '—'}
                            </span>
                            <button
                              type="button"
                              onClick={() => startEditUsername(emp)}
                              title="Edit username"
                              className="shrink-0 text-slate-400 hover:text-accent"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="w-32 px-2 py-3 text-center text-xs text-slate-500">
                      {emp.date_of_joining ? formatAdDate(emp.date_of_joining, system) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="w-28 px-2 py-3">
                      <select
                        value={pendingBranch[emp.id] ?? (emp.branch_id ?? '')}
                        onChange={e => setPendingBranch(p => ({ ...p, [emp.id]: e.target.value }))}
                        className={`w-full max-w-[7rem] rounded-md border px-1.5 py-1 text-xs ${
                          (pendingBranch[emp.id] ?? emp.branch_id) ? 'border-slate-200 text-slate-600' : 'border-warning text-warning-text'
                        }`}
                      >
                        <option value="">Unassigned</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="w-32 px-2 py-3">
                      <select
                        value={pendingDepartment[emp.id] ?? (emp.department ?? '')}
                        onChange={e => setPendingDepartment(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full max-w-[8rem] rounded-md border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
                      >
                        <option value="">No department</option>
                        {departmentOptions.map(d => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                        {emp.department && !departmentOptions.some(d => d.name === emp.department) && (
                          <option value={emp.department}>{emp.department}</option>
                        )}
                      </select>
                    </td>
                    <td className="w-28 px-2 py-3">
                      <input
                        type="text"
                        placeholder="—"
                        value={pendingDesignation[emp.id] ?? (emp.designation ?? '')}
                        onChange={e => setPendingDesignation(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full max-w-[7rem] rounded-md border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
                      />
                    </td>
                    <td className="w-32 px-2 py-3 text-center">
                      {rosterEmployeeIds.has(emp.id) ? (
                        <Link
                          href="/shifts?tab=roster"
                          className="inline-block rounded-lg border border-accent/20 bg-accent/5 px-2 py-1.5 text-center text-xs font-semibold text-accent hover:bg-accent/10"
                        >
                          Custom — Weekly Roster
                        </Link>
                      ) : (
                        <span className="inline-flex flex-col items-center gap-0.5 rounded-lg border border-slate-200 px-2 py-1.5 text-center">
                          <span className="text-xs font-semibold text-ink">{shift.name}</span>
                          <span className="text-[10px] text-slate-400">{formatShiftHours(shift)}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={emp.fingerprint_id ? 'good' : 'neutral'}>{emp.fingerprint_id ? 'Bio Enrolled' : 'Not Enrolled'}</Badge>
                        {linkedEmployeeIds.has(emp.id) && <Badge tone="good">Login Active</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid w-48 grid-cols-3 gap-1.5">
                        {linkedEmployeeIds.has(emp.id) ? (
                          <ActionTile
                            icon={<KeyIcon className="h-3.5 w-3.5" />}
                            label="Reset"
                            title="Reset password"
                            tone="accent"
                            onClick={() => openResetModal(emp)}
                          />
                        ) : (
                          <ActionTile
                            icon={<KeyIcon className="h-3.5 w-3.5" />}
                            label="Login"
                            title="Create login"
                            tone="accent"
                            onClick={() => openLoginModal(emp)}
                          />
                        )}
                        {emp.status === 'active' && (
                          <ActionTile
                            icon={<UserMinusIcon className="h-3.5 w-3.5" />}
                            label="Resign"
                            title="Mark Resigned"
                            tone="warning"
                            onClick={() => handleMarkResigned(emp)}
                          />
                        )}
                        <ActionTile
                          icon={<TrashIcon className="h-3.5 w-3.5" />}
                          label="Remove"
                          tone="critical"
                          onClick={() => handleDelete(emp.id)}
                        />
                        {emp.status !== 'active' && (
                          <>
                            <ActionTile
                              icon={<RestoreIcon className="h-3.5 w-3.5" />}
                              label="Restore"
                              title="Restore to active"
                              tone="accent"
                              onClick={() => handleRestore(emp)}
                            />
                            <ActionTile
                              icon={<TrashIcon className="h-3.5 w-3.5" />}
                              label="Delete forever"
                              title="Permanently delete this employee and all their history"
                              tone="critical"
                              onClick={() => openForceDelete(emp)}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                    No employees match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>
            Showing {pageItems.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {(page - 1) * PAGE_SIZE + pageItems.length} of{' '}
            {filtered.length} employees
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Breathing room so the floating ‹ › scroll pill (fixed, bottom-right)
          never sits on top of the Prev / Next pagination buttons. */}
      <div aria-hidden className="h-20" />

      {showForm && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowForm(false)}
        >
          <form
            onSubmit={handleAddEmployee}
            onClick={e => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-lg"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-ink">Add Employee</h3>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['employee_code', 'Employee code', true],
                    ['name', 'Full name', true],
                    ['username', 'Username', false],
                    ['email', 'Email', false],
                    ['phone', 'Contact number', false],
                    ['address', 'Address', false],
                    ['designation', 'Designation', false],
                    ['pan_no', 'PAN No.', false],
                    ['ssf_no', 'SSF No.', false],
                    ['fingerprint_id', 'Fingerprint / Biometric ID', false],
                  ] as const
                ).map(([key, label, required]) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
                    <input
                      required={required}
                      value={form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Gender</label>
                  <select
                    value={form.gender}
                    onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">Not set</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Used for gender-specific holidays (e.g. Teej).</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Department</label>
                  <select
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">Unassigned</option>
                    {departmentOptions.map(d => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Branch</label>
                  <select
                    value={form.branch_id}
                    onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">Unassigned</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {!form.branch_id && <p className="mt-1 text-xs text-slate-400">GPS check-in won&apos;t work until set.</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Date of joining</label>
                  <DatePicker value={form.date_of_joining} onChange={v => setForm(f => ({ ...f, date_of_joining: v }))} />
                </div>
              </div>

              <h4 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Emergency Contact
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ['emergency_contact_name', 'Name'],
                    ['emergency_contact_relationship', 'Relationship'],
                    ['emergency_contact_phone', 'Phone'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
                    <input
                      value={form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                ))}
              </div>
              {formError && <p className="mt-3 text-sm text-critical">{formError}</p>}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save employee'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loginModalEmployee && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            {loginResult ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Login created</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Share these with {loginModalEmployee.name} so they can sign in on the mobile app. This password won&apos;t
                  be shown again.
                </p>
                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <div>
                    <span className="text-xs uppercase text-slate-400">Email</span>
                    <div className="font-medium text-ink">{loginResult.email}</div>
                  </div>
                  <div>
                    <span className="text-xs uppercase text-slate-400">Password</span>
                    <div className="font-mono font-medium text-ink">{loginResult.password}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setLoginModalEmployee(null)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreateLogin}>
                <h3 className="mb-1 text-lg font-semibold text-ink">Create Login</h3>
                <p className="mb-4 text-xs text-slate-500">{loginModalEmployee.name} will use this to sign in on the mobile app.</p>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <label className="mb-1 block text-xs font-medium text-slate-600">Temporary password</label>
                <div className="mb-3 flex gap-2">
                  <input
                    required
                    minLength={8}
                    value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => setLoginForm(f => ({ ...f, password: generatePassword() }))}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Regenerate
                  </button>
                </div>
                {loginError && <p className="mb-3 text-sm text-critical">{loginError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setLoginModalEmployee(null)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingLogin}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {creatingLogin ? 'Creating…' : 'Create login'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {resetModalEmployee && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            {resetResult ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Password reset</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Share this with {resetModalEmployee.name}. Their old password no longer works. This won&apos;t be shown
                  again.
                </p>
                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <div>
                    <span className="text-xs uppercase text-slate-400">New password</span>
                    <div className="font-mono font-medium text-ink">{resetResult}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setResetModalEmployee(null)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleResetPassword}>
                <h3 className="mb-1 text-lg font-semibold text-ink">Reset Password</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Sets a new password for {resetModalEmployee.name}&apos;s login. Their current password stops working
                  immediately.
                </p>
                <label className="mb-1 block text-xs font-medium text-slate-600">New password</label>
                <div className="mb-3 flex gap-2">
                  <input
                    required
                    minLength={8}
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => setResetPassword(generatePassword())}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Regenerate
                  </button>
                </div>
                {resetError && <p className="mb-3 text-sm text-critical">{resetError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModalEmployee(null)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPassword}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {resettingPassword ? 'Resetting…' : 'Reset password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {forceDeleteEmployee && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setForceDeleteEmployee(null)}
        >
          <div className="w-full max-w-md rounded-xl border-2 border-critical/30 bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <AlertIcon className="h-5 w-5 shrink-0 text-critical" />
              <h3 className="text-lg font-semibold text-ink">Permanently delete {forceDeleteEmployee.name}?</h3>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              This erases their attendance logs, payroll history, tasks, leave requests, corrections, and CV entries —
              everything, not just their profile. <span className="font-semibold text-critical">There is no undo.</span>{' '}
              Their sign-in account (if any) is kept but unlinked, not deleted.
            </p>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Type <span className="font-mono font-semibold text-ink">{forceDeleteEmployee.name}</span> to confirm
            </label>
            <input
              autoFocus
              value={forceDeleteConfirmText}
              onChange={e => setForceDeleteConfirmText(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-critical/30"
            />
            {forceDeleteError && <p className="mt-3 text-sm text-critical">{forceDeleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForceDeleteEmployee(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleForceDelete}
                disabled={forceDeleting || forceDeleteConfirmText !== forceDeleteEmployee.name}
                className="rounded-lg bg-critical px-4 py-2 text-sm font-semibold text-white hover:bg-critical/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {forceDeleting ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPhotoFile && (
        <PhotoCropModal
          file={pendingPhotoFile}
          saving={uploadingPhotoId != null}
          onCancel={() => setPendingPhotoFile(null)}
          onSave={handlePhotoCropped}
        />
      )}
    </AppShell>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}


const ACTION_TILE_TONES = {
  accent: 'border-accent/20 bg-accent/5 text-accent hover:bg-accent/10',
  warning: 'border-warning/30 bg-warning-bg text-warning-text hover:bg-warning-bg/70',
  critical: 'border-critical/30 bg-critical-bg text-critical-text hover:bg-critical-bg/70',
} as const;

// A per-row action ("Reset password", "Mark Resigned", "Remove") as a small
// icon-over-label tile instead of an inline text link — up to three sit
// side by side in a 3-column grid, easier to scan and tap than a run of
// underlined links.
function ActionTile({
  icon,
  label,
  tone,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  tone: keyof typeof ACTION_TILE_TONES;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-center text-[10px] font-semibold leading-tight transition-colors ${ACTION_TILE_TONES[tone]}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m21 21-4.3-4.3" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10.8 12.2 8-8M15.5 3.5l2 2M18.5 6.5l2 2" />
    </svg>
  );
}

function UserMinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 19c1-3.2 3.6-5 6.5-5s5.5 1.8 6.5 5M16.5 9h5" />
    </svg>
  );
}

function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}
