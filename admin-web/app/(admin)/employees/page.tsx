'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useConfirm } from '@/components/ConfirmDialog';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, Shift, Profile, Branch, Department } from '@/lib/types';
import { resolveShift, formatShiftHours } from '@/lib/shift';
import { usePageTitle } from '@/lib/pageTitle';
import { fetchAll } from '@/lib/leaveBalance';
import { downloadExcel } from '@/components/TableExportBar';
import { DOCUMENTS_BUCKET } from '@/lib/employeeDocuments';
import type { SettlementStatus } from '@/lib/employeeSeparation';
import {
  EMPLOYMENT_STATUS_LABEL,
  EMPLOYMENT_TYPES,
  STATUS_TONE,
  effectiveStatus,
  employmentTypeLabel,
  withKnownColumns,
} from '@/lib/employeeProfile';

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
  employment_type: '',
  contract_start: '',
  contract_end: '',
  reporting_to: '',
  official_phone: '',
  personal_email: '',
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
  usePageTitle('Employee Directory');
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
  // Further narrowing on top of the Department filter above. 'All' = no filter.
  const [branchFilter, setBranchFilter] = useState('All');
  const [designationFilter, setDesignationFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [companyName, setCompanyName] = useState('');
  // Where each leaver (or person serving notice) stands on their final settlement.
  const [separations, setSeparations] = useState<Record<string, SettlementStatus>>({});
  const [exportingPdf, setExportingPdf] = useState(false);
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

  // Bio Enrollment badge edits its own row too, same immediate Save/Cancel
  // pattern as username — this is the manual override for devices that
  // never reported an enrollment back (or reported a stale one), so an
  // admin can set/clear the fingerprint_id directly instead of waiting on
  // the device.
  const [editingFingerprintId, setEditingFingerprintId] = useState<string | null>(null);
  const [fingerprintDraft, setFingerprintDraft] = useState('');
  const [savingFingerprint, setSavingFingerprint] = useState(false);

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

  // Marking someone resigned (or, for someone already resigned, correcting
  // the date) needs a date field — the old flow just stamped "today", which
  // is wrong whenever the resignation is being entered after the fact.
  const [resignEmployee, setResignEmployee] = useState<Employee | null>(null);
  const [resignDate, setResignDate] = useState('');
  const [resignReason, setResignReason] = useState<'resigned' | 'terminated'>('resigned');
  const [resigning, setResigning] = useState(false);
  const [resignError, setResignError] = useState<string | null>(null);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function reload() {
    supabase.from('employees').select('*').order('created_at', { ascending: false }).then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    // Whole table, no date filter — a company with enough roster history
    // passes PostgREST's default 1000-row cap on a plain select(), which
    // silently truncates rather than erroring, so this "Custom shift" badge
    // could quietly stop showing for real employees. fetchAll pages through
    // every row instead.
    fetchAll<{ employee_id: string }>((a, b) => supabase.from('employee_daily_shifts').select('employee_id').range(a, b)).then(rows =>
      setRosterEmployeeIds(new Set(rows.map(r => r.employee_id)))
    );
    supabase.from('profiles').select('id, employee_id, role').then(({ data }) => setProfiles(data ?? []));
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartmentOptions(data ?? []));
    // Heads the Excel / PDF export. An admin sees only their own company.
    supabase.from('companies').select('name').limit(1).then(({ data }) => setCompanyName(data?.[0]?.name ?? ''));
    // Empty (not an error) until the separation migration has been run.
    supabase
      .from('employee_separations')
      .select('employee_id, settlement_status')
      .then(({ data }) =>
        setSeparations(Object.fromEntries((data ?? []).map(r => [r.employee_id as string, r.settlement_status as SettlementStatus])))
      );
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

  function startEditFingerprint(emp: Employee) {
    setEditingFingerprintId(emp.id);
    setFingerprintDraft(emp.fingerprint_id ?? '');
  }

  function cancelEditFingerprint() {
    setEditingFingerprintId(null);
    setFingerprintDraft('');
  }

  async function saveFingerprint(emp: Employee) {
    const value = fingerprintDraft.trim() || null;
    if (value === (emp.fingerprint_id ?? null)) {
      setEditingFingerprintId(null);
      return;
    }
    setSavingFingerprint(true);
    const { error } = await supabase.from('employees').update({ fingerprint_id: value }).eq('id', emp.id);
    setSavingFingerprint(false);
    if (error) {
      alert(
        error.code === '23505'
          ? 'That biometric ID is already assigned to another employee.'
          : `Could not update biometric enrollment: ${error.message}`
      );
      return;
    }
    setEditingFingerprintId(null);
    reload();
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
  // The top bar's search box lands here as /employees?search=…
  const searchParam = searchParams.get('search');
  useEffect(() => {
    if (searchParam) setSearch(searchParam);
  }, [searchParam]);

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
    // The Status filter offers Active / Probation / Suspended among current
    // staff and Resigned / Terminated among former staff, so a value is
    // always one that makes sense for the list it is applied to.
    if (statusFilter === 'settlement_pending') {
      // Leavers whose final settlement isn't finished. Someone with no
      // separation record isn't tracked, so isn't "pending".
      list = list.filter(e => !!separations[e.id] && separations[e.id] !== 'completed');
    } else if (statusFilter !== 'All') {
      list = list.filter(e => effectiveStatus(e) === statusFilter);
    }
    if (branchFilter !== 'All') list = list.filter(e => (branchFilter === 'none' ? !e.branch_id : e.branch_id === branchFilter));
    if (designationFilter !== 'All') list = list.filter(e => (e.designation ?? '').trim() === designationFilter);
    if (typeFilter !== 'All') list = list.filter(e => (typeFilter === 'none' ? !e.employment_type : e.employment_type === typeFilter));

    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(e => {
        const shift = resolveShift(e, shifts);
        return [e.name, e.employee_code, e.phone, e.official_phone, e.email, e.personal_email, e.department, e.designation, e.fingerprint_id, shift.name, formatShiftHours(shift)]
          .filter(Boolean)
          .some(v => (v as string).toLowerCase().includes(term));
      });
    }
    // By employee code, so the list stays in a stable, predictable sequence
    // instead of a just-added (often not-yet-enrolled) employee jumping to
    // the top and reshuffling everyone else.
    return [...list].sort((a, b) => a.employee_code.localeCompare(b.employee_code, undefined, { numeric: true }));
  }, [employees, shifts, filter, search, statusFilter, branchFilter, designationFilter, typeFilter, separations]);

  const designations = useMemo(
    () =>
      Array.from(new Set(employees.map(e => (e.designation ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [employees]
  );

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
    if (form.employment_type === 'contract' && form.contract_start && form.contract_end && form.contract_end < form.contract_start) {
      setFormError('The contract end date is before the contract start date.');
      return;
    }
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
      // Only the HR-profile fields that were filled in are sent, so adding an
      // employee keeps working before the HR-profile migration has been run.
      ...withKnownColumns(null, {
        employment_type: form.employment_type || null,
        contract_start: form.employment_type === 'contract' ? form.contract_start || null : null,
        contract_end: form.employment_type === 'contract' ? form.contract_end || null : null,
        reporting_to: form.reporting_to || null,
        official_phone: form.official_phone || null,
        personal_email: form.personal_email || null,
      }),
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

  // The stored files an employee's documents point to. They sit in private
  // storage, which deleting database rows can't reach, so whoever deletes the
  // employee has to remove the files too. Empty (not an error) until the
  // documents migration has been run.
  async function documentPaths(employeeId: string): Promise<string[]> {
    const { data } = await supabase.from('employee_documents').select('file_path').eq('employee_id', employeeId);
    return (data ?? []).map(d => d.file_path as string);
  }

  async function removeDocumentFiles(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
    if (error) {
      alert(`The employee was deleted, but ${paths.length} stored document file(s) could not be removed: ${error.message}`);
    }
  }

  async function handleDelete(id: string) {
    const paths = await documentPaths(id);
    const message =
      paths.length > 0
        ? `Remove this employee? Their ${paths.length} uploaded document${paths.length === 1 ? '' : 's'} will be permanently deleted too.`
        : 'Remove this employee?';
    if (!(await confirm(message, { title: 'Remove employee?', confirmLabel: 'Remove', tone: 'danger' }))) return;
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
    await removeDocumentFiles(paths);
    reload();
  }

  function openResignModal(emp: Employee) {
    setResignEmployee(emp);
    setResignDate(emp.resigned_at ?? new Date().toISOString().slice(0, 10));
    setResignReason(effectiveStatus(emp) === 'terminated' ? 'terminated' : 'resigned');
    setResignError(null);
  }

  async function handleConfirmResign() {
    if (!resignEmployee || !resignDate) return;
    setResigning(true);
    setResignError(null);
    const { error } = await supabase
      .from('employees')
      .update({
        status: 'inactive',
        resigned_at: resignDate,
        // The HR label ("Resigned" or "Terminated"). Left out before the
        // HR-profile migration has been run, when there's no such column to
        // write — "Terminated" can't be recorded until then.
        ...('employment_status' in resignEmployee || resignReason === 'terminated' ? { employment_status: resignReason } : {}),
      })
      .eq('id', resignEmployee.id);
    setResigning(false);
    if (error) {
      setResignError(error.message);
      return;
    }
    // Start the exit checklist for them (or, if one is already under way, keep
    // its last working date in step with this one). Errors are ignored: until
    // the separation migration has been run there is no table, and the profile
    // page offers "Start checklist" as a fallback.
    await supabase
      .from('employee_separations')
      .upsert(
        { employee_id: resignEmployee.id, separation_type: resignReason === 'terminated' ? 'termination' : 'resignation', last_working_on: resignDate },
        { onConflict: 'employee_id', ignoreDuplicates: true }
      );
    await supabase.from('employee_separations').update({ last_working_on: resignDate }).eq('employee_id', resignEmployee.id);
    setResignEmployee(null);
    reload();
  }

  async function handleRestore(emp: Employee) {
    if (!(await confirm(`Restore ${emp.name} to active? They'll show up in active views again.`, { title: 'Restore employee?', confirmLabel: 'Restore' }))) return;
    const { error } = await supabase
      .from('employees')
      .update({ status: 'active', resigned_at: null, ...('employment_status' in emp ? { employment_status: 'active' } : {}) })
      .eq('id', emp.id);
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
    // Looked up first: once the employee is gone there is nothing left to find them by.
    const paths = await documentPaths(forceDeleteEmployee.id);
    const { error } = await supabase.rpc('admin_force_delete_employee', { p_employee_id: forceDeleteEmployee.id });
    if (error) {
      setForceDeleting(false);
      setForceDeleteError(error.message);
      return;
    }
    await removeDocumentFiles(paths);
    setForceDeleting(false);
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

  // One labelled text box on the Add Employee form.
  function textField(key: keyof typeof EMPTY_FORM, label: string, required = false) {
    return (
      <div key={key}>
        <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
        <input
          required={required}
          value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>
    );
  }

  // Quiet by default: nothing is shown for an ordinary active permanent
  // employee, so the badges only appear when there is something to flag.
  function renderEmploymentBadges(emp: Employee) {
    const status = effectiveStatus(emp);
    const settlement = separations[emp.id];
    return (
      <>
        {status !== 'active' && <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>}
        {/* Someone still working who has a separation record is serving notice. */}
        {emp.status === 'active' && settlement && <Badge tone="warning">Notice period</Badge>}
        {emp.status !== 'active' && settlement === 'pending' && <Badge tone="warning">Settlement pending</Badge>}
        {emp.status !== 'active' && settlement === 'processed' && <Badge tone="info">Settlement processed</Badge>}
        {emp.employment_type && emp.employment_type !== 'permanent' && <Badge tone="neutral">{employmentTypeLabel(emp.employment_type)}</Badge>}
      </>
    );
  }

  // --- Directory export: everything the current filters match, not just the
  // page of 10 on screen. -----------------------------------------------------
  function directoryRows() {
    const nameById = new Map(employees.map(e => [e.id, e.name]));
    const branchById = new Map(branches.map(b => [b.id, b.name]));
    const date = (value: string | null | undefined) => (value ? formatAdDate(value, system) : '');
    return filtered.map((e, i) => ({
      sn: i + 1,
      code: e.employee_code,
      biometric: e.fingerprint_id ?? '',
      name: e.name,
      designation: e.designation ?? '',
      department: e.department ?? '',
      outlet: (e.branch_id && branchById.get(e.branch_id)) || '',
      type: employmentTypeLabel(e.employment_type),
      joined: date(e.date_of_joining),
      contractStart: date(e.employment_type === 'contract' ? e.contract_start : null),
      contractEnd: date(e.employment_type === 'contract' ? e.contract_end : null),
      reportsTo: (e.reporting_to && nameById.get(e.reporting_to)) || '',
      phone: e.phone ?? '',
      officialPhone: e.official_phone ?? '',
      email: e.email ?? '',
      personalEmail: e.personal_email ?? '',
      status: EMPLOYMENT_STATUS_LABEL[effectiveStatus(e)],
      lastDay: date(e.resigned_at),
    }));
  }

  async function handleExportExcel() {
    const rows = directoryRows();
    await downloadExcel(
      'employee-directory',
      [
        'S.N.',
        'Employee ID',
        'Biometric ID',
        'Full name',
        'Company',
        'Designation',
        'Department',
        'Outlet',
        'Employment type',
        'Date of joining',
        'Contract start',
        'Contract end',
        'Reporting to',
        'Phone (personal)',
        'Phone (official)',
        'Email (official)',
        'Email (personal)',
        'Status',
        'Last working date',
      ],
      rows.map(r => [
        r.sn,
        r.code,
        r.biometric,
        r.name,
        companyName,
        r.designation,
        r.department,
        r.outlet,
        r.type,
        r.joined,
        r.contractStart,
        r.contractEnd,
        r.reportsTo,
        r.phone,
        r.officialPhone,
        r.email,
        r.personalEmail,
        r.status,
        r.lastDay,
      ])
    );
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const rows = directoryRows();
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const marginX = 10;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const rowHeight = 7;

      // Widths add up to the 277 mm between the margins.
      const columns: { title: string; width: number; value: (r: (typeof rows)[number]) => string }[] = [
        { title: 'S.N.', width: 9, value: r => String(r.sn) },
        { title: 'Employee ID', width: 19, value: r => r.code },
        { title: 'Full name', width: 43, value: r => r.name },
        { title: 'Designation', width: 34, value: r => r.designation },
        { title: 'Department', width: 28, value: r => r.department },
        { title: 'Outlet', width: 28, value: r => r.outlet },
        { title: 'Type', width: 17, value: r => r.type },
        { title: 'Joined', width: 24, value: r => r.joined },
        { title: 'Reports to', width: 31, value: r => r.reportsTo },
        { title: 'Status', width: 20, value: r => r.status },
        { title: 'Phone', width: 24, value: r => r.phone },
      ];

      function fit(text: string, width: number) {
        const room = width - 2;
        if (doc.getTextWidth(text) <= room) return text;
        let out = text;
        while (out.length > 1 && doc.getTextWidth(out + '...') > room) out = out.slice(0, -1);
        return out + '...';
      }

      let y = 0;
      function startPage() {
        y = 14;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(`${companyName ? companyName + ' — ' : ''}Employee Directory`, marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`${rows.length} employee${rows.length === 1 ? '' : 's'}  ·  ${new Date().toLocaleDateString()}`, marginX, y + 5);
        doc.setTextColor(0);
        y += 10;
        doc.setFillColor(241, 245, 249);
        doc.rect(marginX, y, pageWidth - marginX * 2, rowHeight, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        let x = marginX;
        for (const col of columns) {
          doc.text(fit(col.title, col.width), x + 1, y + 4.7);
          x += col.width;
        }
        doc.setFont('helvetica', 'normal');
        y += rowHeight;
      }

      startPage();
      doc.setDrawColor(226, 232, 240);
      for (const r of rows) {
        if (y + rowHeight > pageHeight - 12) {
          doc.addPage();
          startPage();
          doc.setDrawColor(226, 232, 240);
        }
        doc.setFontSize(8);
        let x = marginX;
        for (const col of columns) {
          doc.text(fit(col.value(r) || '—', col.width), x + 1, y + 4.7);
          x += col.width;
        }
        doc.line(marginX, y + rowHeight, pageWidth - marginX, y + rowHeight);
        y += rowHeight;
      }

      const pages = doc.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(`Page ${p} of ${pages}`, pageWidth - marginX, pageHeight - 6, { align: 'right' });
      }
      doc.save('employee-directory.pdf');
    } finally {
      setExportingPdf(false);
    }
  }

  // Shared by the mobile card and desktop table — the badge is clickable in
  // both so a bugged device (one that never reported an enrollment back, or
  // reported a stale one) doesn't leave an admin stuck: clicking it opens a
  // direct editor for the underlying fingerprint_id, the same field a
  // device push normally sets.
  function renderBioEnrollment(emp: Employee) {
    if (editingFingerprintId === emp.id) {
      return (
        <div className="flex flex-col items-start gap-1.5" onClick={e => e.stopPropagation()}>
          <input
            type="text"
            autoFocus
            value={fingerprintDraft}
            onChange={e => setFingerprintDraft(e.target.value)}
            placeholder="Biometric ID"
            className="w-28 rounded-md border border-slate-200 px-1.5 py-1 text-xs font-semibold text-ink"
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => saveFingerprint(emp)}
              disabled={savingFingerprint}
              className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
            >
              {savingFingerprint ? 'Saving…' : 'Save'}
            </button>
            {fingerprintDraft && (
              <button
                type="button"
                onClick={() => setFingerprintDraft('')}
                className="text-xs font-medium text-warning-text hover:underline"
              >
                Clear
              </button>
            )}
            <button type="button" onClick={cancelEditFingerprint} className="text-xs font-medium text-slate-400 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => startEditFingerprint(emp)}
        title="Click to set or clear this employee's biometric enrollment — use this if a device never reported an enrollment back"
        className="cursor-pointer rounded-md transition hover:opacity-80"
      >
        <Badge tone={emp.fingerprint_id ? 'good' : 'neutral'}>{emp.fingerprint_id ? 'Bio Enrolled' : 'Not Enrolled'}</Badge>
      </button>
    );
  }

  return (
    <>
      {/* Deliberately no z-index — see AttendanceReportTable.tsx's own copy of
          this comment (5be39b2). This used to be `relative z-50`, which lifted
          a plain in-flow bar above the app's own menus: it painted over the
          account menu (z-30), over the dimmed overlay behind the phone nav
          drawer (z-20) and over the Edit Profile / Change Password dialogs
          (z-40). Nothing in here needs it — the Search box's suggestions
          dropdown anchors to its own immediate `relative` wrapper a level
          down (searchBoxRef), not to this outer one. */}
      <div className="mb-5 rounded-2xl border border-slate-100/80 bg-white/60 backdrop-blur-xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-4">
          <div className="group">
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500 transition-colors group-hover:text-accent">Department</label>
            <div className="relative">
              <FilterIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent/70 transition-colors group-hover:text-accent" />
              <select
                value={filter}
                onChange={e => {
                  setFilter(e.target.value);
                  // Switching between current and former staff changes which
                  // statuses exist, so a leftover one would match nobody.
                  setStatusFilter('All');
                  setPage(1);
                }}
                className="min-w-[13rem] appearance-none rounded-xl border border-slate-200/80 bg-white/80 py-2.5 pl-9 pr-8 text-sm font-medium text-ink shadow-sm backdrop-blur-sm transition-all duration-200 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 hover:border-accent/40"
              >
                {['All', ...departments, 'Unenrolled', 'Resigned'].map(f => (
                  <option key={f} value={f}>
                    {f === 'All' ? 'All Departments' : f === 'Unenrolled' ? 'Biometric Unenrolled' : f === 'Resigned' ? 'Resigned Employees' : f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="group">
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500 transition-colors group-hover:text-accent">Search</label>
            <div
              ref={searchBoxRef}
              tabIndex={-1}
              onBlur={e => {
                if (!searchBoxRef.current?.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
              }}
              className="relative"
            >
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-hover:text-accent" />
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
                className="w-56 appearance-none rounded-xl border border-slate-200/80 bg-white/80 py-2.5 pl-9 pr-4 text-sm text-ink shadow-sm backdrop-blur-sm transition-all duration-200 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 hover:border-accent/40"
              />
              {suggestionsOpen && searchSuggestions.length > 0 && (
                <div className="absolute left-0 top-full z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-100 bg-white/95 py-1 shadow-xl backdrop-blur-sm">
                  {searchSuggestions.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSearch(s);
                        setPage(1);
                        setSuggestionsOpen(false);
                      }}
                      className="block w-full truncate px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-accent/5 hover:text-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ml-auto flex gap-2">
            <button
              onClick={handleExportExcel}
              disabled={filtered.length === 0}
              title="Download everything the current filters show as an Excel file"
              className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-accent/40 hover:bg-white hover:shadow-md disabled:opacity-50"
            >
              ⭳ Excel
            </button>
            <button
              onClick={handleExportPdf}
              disabled={filtered.length === 0 || exportingPdf}
              title="Download everything the current filters show as a PDF"
              className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-accent/40 hover:bg-white hover:shadow-md disabled:opacity-50"
            >
              {exportingPdf ? 'Preparing…' : '⭳ PDF'}
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvSelected} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-accent/40 hover:bg-white hover:shadow-md disabled:opacity-60"
            >
              {importing ? 'Importing…' : '⭱ Import CSV'}
            </button>
            {filter !== 'Resigned' && (
              <button
                onClick={() => setShowForm(true)}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-accent/90 hover:shadow-md"
              >
                + Add Employee
              </button>
            )}
          </div>

          <div className="flex w-full flex-wrap items-end gap-x-4 gap-y-3 border-t border-slate-100 pt-4">
            <FilterSelect
              label="Outlet / branch"
              value={branchFilter}
              onChange={v => {
                setBranchFilter(v);
                setPage(1);
              }}
            >
              <option value="All">All outlets</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="none">Unassigned</option>
            </FilterSelect>
            <FilterSelect
              label="Designation"
              value={designationFilter}
              onChange={v => {
                setDesignationFilter(v);
                setPage(1);
              }}
            >
              <option value="All">All designations</option>
              {designations.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Employment type"
              value={typeFilter}
              onChange={v => {
                setTypeFilter(v);
                setPage(1);
              }}
            >
              <option value="All">All types</option>
              {EMPLOYMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              <option value="none">Not set</option>
            </FilterSelect>
            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={v => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <option value="All">{filter === 'Resigned' ? 'Resigned & terminated' : 'Active, probation & suspended'}</option>
              {(filter === 'Resigned' ? (['resigned', 'terminated'] as const) : (['active', 'probation', 'suspended'] as const)).map(s => (
                <option key={s} value={s}>
                  {EMPLOYMENT_STATUS_LABEL[s]}
                </option>
              ))}
              {filter === 'Resigned' && <option value="settlement_pending">Settlement not completed</option>}
            </FilterSelect>
            {(branchFilter !== 'All' || designationFilter !== 'All' || typeFilter !== 'All' || statusFilter !== 'All') && (
              <button
                type="button"
                onClick={() => {
                  setBranchFilter('All');
                  setDesignationFilter('All');
                  setTypeFilter('All');
                  setStatusFilter('All');
                  setPage(1);
                }}
                className="pb-2.5 text-xs font-medium text-accent hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
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

      <div className="rounded-2xl border border-slate-100 bg-white/70 backdrop-blur-sm shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500">
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
                    {renderBioEnrollment(emp)}
                    {linkedEmployeeIds.has(emp.id) && <Badge tone="good">Login Active</Badge>}
                    {renderEmploymentBadges(emp)}
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
                      onClick={() => openResignModal(emp)}
                    />
                  )}
                  <ActionTile icon={<TrashIcon className="h-4 w-4" />} label="Remove" tone="critical" onClick={() => handleDelete(emp.id)} />
                  {emp.status !== 'active' && (
                    <>
                      <ActionTile
                        icon={<PencilIcon className="h-4 w-4" />}
                        label="Edit Date"
                        tone="warning"
                        onClick={() => openResignModal(emp)}
                      />
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
        <div ref={tableScrollRef} className="hidden overflow-x-auto overflow-y-visible md:block pb-24 -mb-24">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur-sm text-[11px] uppercase tracking-wider text-slate-500">
                <th className="w-px whitespace-nowrap px-4 py-3.5 font-bold text-left rounded-tl-2xl">S.N.</th>
                <th className="w-px whitespace-nowrap px-4 py-3.5 font-bold text-left">ID</th>
                <th className="whitespace-nowrap px-4 py-3.5 font-bold text-left">Employee Name</th>
                <th className="whitespace-nowrap px-4 py-3.5 font-bold text-left">Username</th>
                <th className="w-32 whitespace-nowrap px-4 py-3.5 font-bold text-left">Date of Joining</th>
                <th className="w-28 whitespace-nowrap px-4 py-3.5 font-bold text-left">Branch</th>
                <th className="w-32 whitespace-nowrap px-4 py-3.5 font-bold text-left">Department</th>
                <th className="w-28 whitespace-nowrap px-4 py-3.5 font-bold text-left">Designation</th>
                <th className="w-32 whitespace-nowrap px-4 py-3.5 font-bold text-left">Shift</th>
                <th className="whitespace-nowrap px-4 py-3.5 font-bold text-left">Bio Enrollment</th>
                <th className="whitespace-nowrap px-4 py-3.5 font-bold text-left rounded-tr-2xl">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(emp => {
                const shift = resolveShift(emp, shifts);
                return (
                  <tr key={emp.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                    <td className="w-px whitespace-nowrap px-4 py-3.5 tabular-nums text-slate-500 font-medium">{pageItems.indexOf(emp) + 1 + (page - 1) * PAGE_SIZE}</td>
                    <td className="w-px whitespace-nowrap px-4 py-3.5 text-sm font-semibold text-ink text-left">{emp.fingerprint_id ?? '—'}</td>
                    <td className="px-4 py-3.5">
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
                            {renderEmploymentBadges(emp)}
                            {emp.attendance_exempt && <Badge tone="neutral">Excused</Badge>}
                          </div>
                          <div className="truncate text-xs text-slate-400">{emp.phone ?? '—'}</div>
                          {emp.email && <div className="truncate text-xs text-slate-400">{emp.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
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
                    <td className="w-32 px-4 py-3.5 text-left text-xs text-slate-500">
                      {emp.date_of_joining ? formatAdDate(emp.date_of_joining, system) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="w-28 px-4 py-3.5">
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
                    <td className="w-32 px-4 py-3.5">
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
                    <td className="w-28 px-4 py-3.5">
                      <input
                        type="text"
                        placeholder="—"
                        value={pendingDesignation[emp.id] ?? (emp.designation ?? '')}
                        onChange={e => setPendingDesignation(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full max-w-[7rem] rounded-md border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
                      />
                    </td>
                    <td className="w-32 px-4 py-3.5 text-left">
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
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        {renderBioEnrollment(emp)}
                        {linkedEmployeeIds.has(emp.id) && <Badge tone="good">Login Active</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(activeMenuId === emp.id ? null : emp.id);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/60 bg-white text-slate-400 shadow-sm transition-colors hover:border-accent hover:bg-accent/5 hover:text-accent"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>

                      {activeMenuId === emp.id && (
                        <div
                          ref={actionMenuRef}
                          className="absolute right-8 top-10 z-50 w-48 overflow-hidden rounded-xl border border-slate-100 bg-white/95 p-1.5 shadow-xl backdrop-blur-sm"
                        >
                          {linkedEmployeeIds.has(emp.id) ? (
                            <button
                              type="button"
                              onClick={() => {
                                openResetModal(emp);
                                setActiveMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-accent/5 hover:text-accent"
                            >
                              <KeyIcon className="h-4 w-4" />
                              Reset Password
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                openLoginModal(emp);
                                setActiveMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-accent/5 hover:text-accent"
                            >
                              <KeyIcon className="h-4 w-4" />
                              Create Login
                            </button>
                          )}

                          {emp.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => {
                                openResignModal(emp);
                                setActiveMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-warning/10 hover:text-warning-text"
                            >
                              <UserMinusIcon className="h-4 w-4" />
                              Mark Resigned
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              handleDelete(emp.id);
                              setActiveMenuId(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-critical transition-colors hover:bg-critical/10"
                          >
                            <TrashIcon className="h-4 w-4" />
                            Remove
                          </button>

                          {emp.status !== 'active' && (
                            <>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                type="button"
                                onClick={() => {
                                  openResignModal(emp);
                                  setActiveMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-warning/10 hover:text-warning-text"
                              >
                                <PencilIcon className="h-4 w-4" />
                                Edit Date
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleRestore(emp);
                                  setActiveMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-accent/5 hover:text-accent"
                              >
                                <RestoreIcon className="h-4 w-4" />
                                Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  openForceDelete(emp);
                                  setActiveMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-critical transition-colors hover:bg-critical/10"
                              >
                                <TrashIcon className="h-4 w-4" />
                                Delete Forever
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center text-[13px] text-slate-500 italic">
                    No employees match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100/80 bg-slate-50/50 px-5 py-3.5 text-sm rounded-b-2xl">
          <span className="text-slate-500 text-[12px]">
            Showing <span className="font-semibold text-ink">{pageItems.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}</span> to <span className="font-semibold text-ink">{(page - 1) * PAGE_SIZE + pageItems.length}</span> of{' '}
            <span className="font-semibold text-ink">{filtered.length}</span> employees
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-xl border border-slate-200/80 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:border-accent/40 hover:shadow-md disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="flex items-center px-2 text-xs font-semibold text-slate-500">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-xl border border-slate-200/80 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:border-accent/40 hover:shadow-md disabled:opacity-40"
            >
              Next →
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
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Basic details</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {textField('employee_code', 'Employee code', true)}
                {textField('name', 'Full name', true)}
                {textField('username', 'Username')}
                {textField('fingerprint_id', 'Fingerprint / Biometric ID')}
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
              </div>

              <h4 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Employment
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {textField('designation', 'Designation')}
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
                  <label className="mb-1 block text-xs font-medium text-slate-600">Outlet / branch</label>
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
                  <label className="mb-1 block text-xs font-medium text-slate-600">Employment type</label>
                  <select
                    value={form.employment_type}
                    onChange={e => setForm(f => ({ ...f, employment_type: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">Not set</option>
                    {EMPLOYMENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                {form.employment_type === 'contract' && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Contract start date</label>
                      <DatePicker value={form.contract_start} onChange={v => setForm(f => ({ ...f, contract_start: v }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Contract end date</label>
                      <DatePicker value={form.contract_end} onChange={v => setForm(f => ({ ...f, contract_end: v }))} />
                    </div>
                  </>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Reporting to</label>
                  <select
                    value={form.reporting_to}
                    onChange={e => setForm(f => ({ ...f, reporting_to: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">No one</option>
                    {employees
                      .filter(p => p.status === 'active')
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.employee_code})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Date of joining</label>
                  <DatePicker value={form.date_of_joining} onChange={v => setForm(f => ({ ...f, date_of_joining: v }))} />
                </div>
              </div>

              <h4 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Contact
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {textField('phone', 'Phone (personal)')}
                {textField('official_phone', 'Phone (official)')}
                {textField('email', 'Email (official)')}
                {textField('personal_email', 'Email (personal)')}
                <div className="sm:col-span-2">{textField('address', 'Address')}</div>
              </div>

              <h4 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Statutory
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {textField('pan_no', 'PAN No.')}
                {textField('ssf_no', 'SSF No.')}
              </div>

              <h4 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Emergency Contact
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                {textField('emergency_contact_name', 'Name')}
                {textField('emergency_contact_relationship', 'Relationship')}
                {textField('emergency_contact_phone', 'Phone')}
              </div>
              <p className="mt-4 text-xs text-slate-400">
                Date of birth, permanent and temporary address, family, education and training can be added from the
                employee&apos;s profile after saving.
              </p>
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
              This erases their attendance logs, payroll history, tasks, leave requests, corrections, CV entries, and
              uploaded documents — everything, not just their profile. <span className="font-semibold text-critical">There is no undo.</span>{' '}
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

      {resignEmployee && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setResignEmployee(null)}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-ink">
              {resignEmployee.status === 'active' ? `Mark ${resignEmployee.name} as leaving?` : `Last working date for ${resignEmployee.name}`}
            </h3>
            <p className="mb-4 text-sm text-slate-600">
              {resignEmployee.status === 'active'
                ? "They'll be removed from active views but their history is kept."
                : 'Update the date their employment ended.'}
            </p>
            {resignEmployee.status === 'active' && (
              <>
                <label className="mb-1 block text-xs font-medium text-slate-600">Reason for leaving</label>
                <select
                  value={resignReason}
                  onChange={e => setResignReason(e.target.value as 'resigned' | 'terminated')}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </>
            )}
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {resignReason === 'terminated' ? 'Last working date' : 'Resignation date'}
            </label>
            <DatePicker value={resignDate} onChange={setResignDate} />
            {resignError && <p className="mt-3 text-sm text-critical">{resignError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResignEmployee(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmResign}
                disabled={resigning || !resignDate}
                className="rounded-lg bg-critical px-4 py-2 text-sm font-semibold text-white hover:bg-critical/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resigning ? 'Saving…' : resignEmployee.status === 'active' ? (resignReason === 'terminated' ? 'Mark terminated' : 'Mark resigned') : 'Save date'}
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
    </>
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

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group">
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500 transition-colors group-hover:text-accent">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-[10rem] rounded-xl border border-slate-200/80 bg-white/80 py-2.5 pl-3 pr-3 text-sm font-medium text-ink shadow-sm backdrop-blur-sm transition-all duration-200 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 hover:border-accent/40"
      >
        {children}
      </select>
    </div>
  );
}
