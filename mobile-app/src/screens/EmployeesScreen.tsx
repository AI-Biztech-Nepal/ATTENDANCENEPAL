import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Modal, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressPhoto } from '../lib/compressPhoto';
import { supabase } from '../lib/supabase';
import type { Branch, Department, Employee, Gender, Profile, Shift } from '../types';
import { resolveShift, formatShiftHours } from '../lib/shift';
import { fetchAll } from '../lib/leaveBalance';
import { useCompanyName } from '../lib/useCompanyName';
import { useToast } from '../components/Toast';
import { colors } from '../theme';
import Badge from '../components/Badge';
import DatePicker from '../components/DatePicker';
import { ChevronIcon, EditIcon, KeyIcon } from '../components/icons';
import { createLogin, fetchAccounts, resetPassword, updateLoginEmail } from '../lib/accountsApi';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { fetchCompanyName } from '../lib/payrollFormat';
import { EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_TYPES, STATUS_TONE, effectiveStatus, employmentTypeLabel, withKnownColumns, type EmploymentStatus } from '../lib/employeeProfile';
import { DOCUMENTS_BUCKET } from '../lib/employeeDocuments';
import type { SettlementStatus } from '../lib/employeeSeparation';
import { directoryCsv, directoryHtml, directoryRows, shareTextFile, sharePdf } from '../lib/directoryExport';
import { Button, Choice, Sheet, confirmAsync, notify } from '../components/hr/HrKit';

const EMPTY_ADD_FORM = {
  employee_code: '',
  name: '',
  phone: '',
  email: '',
  address: '',
  designation: '',
  fingerprint_id: '',
  date_of_joining: '',
  employment_type: '',
  contract_start: '',
  contract_end: '',
  official_phone: '',
  personal_email: '',
};

/** The extra directory filters, besides the department / view list. */
const NO_FILTERS = { branch: 'All', designation: 'All', type: 'All', status: 'All' };
const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  return out;
}

export default function EmployeesScreen({ route, navigation }: any) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterEmployeeIds, setRosterEmployeeIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'employee_id' | 'role'>[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [loginEmailByEmployee, setLoginEmailByEmployee] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(route?.params?.filter ?? 'All');
  const [filterOpen, setFilterOpen] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addDepartment, setAddDepartment] = useState<string | null>(null);
  const [addBranchId, setAddBranchId] = useState<string | null>(null);
  const [addGender, setAddGender] = useState<Gender | null>(null);
  const [addManagerId, setAddManagerId] = useState<string | null>(null);
  const [pickingManager, setPickingManager] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [branchPickerFor, setBranchPickerFor] = useState<Employee | null>(null);
  const [editingUsernameId, setEditingUsernameId] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  const [loginModalEmployee, setLoginModalEmployee] = useState<Employee | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginResult, setLoginResult] = useState<{ email: string; password: string } | null>(null);

  const [resetModalEmployee, setResetModalEmployee] = useState<Employee | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);

  const [forceDeleteEmployee, setForceDeleteEmployee] = useState<Employee | null>(null);
  // Why the confirmation opened, when it was not a former employee being removed (see handleRemove).
  const [forceDeleteNote, setForceDeleteNote] = useState<string | null>(null);
  const [forceDeleteConfirmText, setForceDeleteConfirmText] = useState('');
  const [forceDeleting, setForceDeleting] = useState(false);
  const [forceDeleteError, setForceDeleteError] = useState<string | null>(null);

  const [resignEmployee, setResignEmployee] = useState<Employee | null>(null);
  const [resignDate, setResignDate] = useState('');
  const [resignReason, setResignReason] = useState<'resigned' | 'terminated'>('resigned');
  const [resigning, setResigning] = useState(false);
  const [resignError, setResignError] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState<Set<string>>(new Set());
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);

  const { system } = useCalendarSystem();
  const companyName = useCompanyName();
  const toast = useToast();
  const [moreFilters, setMoreFilters] = useState(NO_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  // Where each leaver (or person serving notice) stands on their final settlement.
  const [separations, setSeparations] = useState<Record<string, SettlementStatus>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  function reload() {
    supabase
      .from('employees')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEmployees((data as Employee[]) ?? []);
        setLoading(false);
      });
    // Empty (not an error) until the separation migration has been run.
    supabase
      .from('employee_separations')
      .select('employee_id, settlement_status')
      .then(({ data }) => setSeparations(Object.fromEntries((data ?? []).map(r => [r.employee_id as string, r.settlement_status as SettlementStatus]))));
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    // Whole table, no date filter — a company with enough roster history
    // passes PostgREST's default 1000-row cap on a plain select(), which
    // silently truncates rather than erroring, so this "Custom shift" badge
    // could quietly stop showing for real employees. fetchAll pages through
    // every row instead.
    fetchAll<{ employee_id: string }>((a, b) => supabase.from('employee_daily_shifts').select('employee_id').range(a, b)).then(rows =>
      setRosterEmployeeIds(new Set(rows.map(r => r.employee_id)))
    );
    supabase
      .from('profiles')
      .select('id, employee_id, role')
      .then(({ data }) => setProfiles((data as any) ?? []));
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartmentOptions((data as Department[]) ?? []));
    fetchAccounts().then(setLoginEmailByEmployee);
  }

  useEffect(reload, []);
  useEffect(() => {
    if (route?.params?.filter) {
      setFilter(route.params.filter);
      setMoreFilters(m => ({ ...m, status: 'All' }));
    }
  }, [route?.params?.filter]);

  const linkedEmployeeIds = useMemo(
    () => new Set(profiles.map(p => p.employee_id).filter((id): id is string => Boolean(id))),
    [profiles]
  );
  const departments = useMemo(() => Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[], [employees]);
  const filterOptions = ['All', ...departments, 'Unenrolled', 'Resigned'];
  const designations = useMemo(() => Array.from(new Set(employees.map(e => (e.designation ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [employees]);
  const moreFilterCount = (Object.values(moreFilters) as string[]).filter(v => v !== 'All').length;

  const filtered = useMemo(() => {
    let list = employees;
    if (filter === 'Resigned') {
      list = list.filter(e => e.status !== 'active');
    } else {
      list = list.filter(e => e.status === 'active');
      if (filter === 'Unenrolled') list = list.filter(e => !e.fingerprint_id);
      else if (filter !== 'All') list = list.filter(e => e.department === filter);
    }
    // Status offers Active / Probation / Suspended among current staff and
    // Resigned / Terminated among former staff (plus "settlement not completed").
    if (moreFilters.status === 'settlement_pending') {
      // Someone with no separation record isn't tracked, so isn't "pending".
      list = list.filter(e => !!separations[e.id] && separations[e.id] !== 'completed');
    } else if (moreFilters.status !== 'All') {
      list = list.filter(e => effectiveStatus(e) === moreFilters.status);
    }
    if (moreFilters.branch !== 'All') list = list.filter(e => (moreFilters.branch === 'none' ? !e.branch_id : e.branch_id === moreFilters.branch));
    if (moreFilters.designation !== 'All') list = list.filter(e => (e.designation ?? '').trim() === moreFilters.designation);
    if (moreFilters.type !== 'All') list = list.filter(e => (moreFilters.type === 'none' ? !e.employment_type : e.employment_type === moreFilters.type));
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(e =>
        [e.name, e.employee_code, e.phone, e.official_phone, e.email, e.personal_email, e.department, e.designation, e.fingerprint_id]
          .filter(Boolean)
          .some(v => (v as string).toLowerCase().includes(term))
      );
    }
    return [...list].sort((a, b) => (b as any).created_at?.localeCompare((a as any).created_at ?? '') ?? 0);
  }, [employees, filter, search, moreFilters, separations]);

  // Who a new employee can report to: people still working here, matching the picker's search.
  const addManager = employees.find(e => e.id === addManagerId);
  const managerChoices = useMemo(() => {
    const q = managerSearch.trim().toLowerCase();
    return employees
      .filter(e => e.status === 'active' && (!q || e.name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, managerSearch]);

  /** Switching between current and former staff changes which statuses make sense, so that filter starts over. */
  function chooseFilter(next: string) {
    if ((next === 'Resigned') !== (filter === 'Resigned')) setMoreFilters(m => ({ ...m, status: 'All' }));
    setFilter(next);
  }

  // Quiet by default: nothing is shown for an ordinary active permanent employee, so these
  // badges only appear when there is something to flag.
  function renderEmploymentBadges(emp: Employee) {
    const status = effectiveStatus(emp);
    const settlement = separations[emp.id];
    return (
      <>
        {status !== 'active' && <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>}
        {/* Someone still working who has a separation record is serving notice. */}
        {emp.status === 'active' && !!settlement && <Badge tone="warning">Notice period</Badge>}
        {emp.status !== 'active' && settlement === 'pending' && <Badge tone="warning">Settlement pending</Badge>}
        {emp.status !== 'active' && settlement === 'processed' && <Badge tone="info">Settlement processed</Badge>}
        {!!emp.employment_type && emp.employment_type !== 'permanent' && <Badge tone="neutral">{employmentTypeLabel(emp.employment_type)}</Badge>}
      </>
    );
  }

  async function runExport(kind: 'csv' | 'pdf') {
    setExporting(true);
    try {
      const company = await fetchCompanyName();
      const rows = directoryRows(filtered, employees, branches, system);
      if (kind === 'csv') await shareTextFile('employee-directory.csv', 'text/csv', directoryCsv(rows, company));
      else await sharePdf(directoryHtml(rows, company), 'Employee directory');
      setExportOpen(false);
    } catch (e) {
      notify('Could not export', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setExporting(false);
    }
  }

  async function handleAddEmployee() {
    if (!addForm.employee_code.trim() || !addForm.name.trim()) {
      setAddError('Employee code and name are required.');
      return;
    }
    const isContract = addForm.employment_type === 'contract';
    if (isContract && addForm.contract_start && addForm.contract_end && addForm.contract_end < addForm.contract_start) {
      setAddError('The contract end date is before the contract start date.');
      return;
    }
    setSaving(true);
    setAddError(null);
    const { error } = await supabase.from('employees').insert({
      employee_code: addForm.employee_code.trim(),
      name: addForm.name.trim(),
      phone: addForm.phone || null,
      email: addForm.email || null,
      address: addForm.address || null,
      department: addDepartment,
      designation: addForm.designation || null,
      fingerprint_id: addForm.fingerprint_id || null,
      branch_id: addBranchId,
      gender: addGender,
      date_of_joining: addForm.date_of_joining || null,
      // Only the HR-profile fields that were filled in are sent, so adding an
      // employee keeps working before the HR-profile migration has been run.
      ...withKnownColumns(null, {
        employment_type: addForm.employment_type || null,
        contract_start: isContract ? addForm.contract_start || null : null,
        contract_end: isContract ? addForm.contract_end || null : null,
        reporting_to: addManagerId,
        official_phone: addForm.official_phone || null,
        personal_email: addForm.personal_email || null,
      }),
      status: 'active',
    });
    setSaving(false);
    if (error) {
      setAddError(
        error.code === '23505'
          ? error.message.includes('email')
            ? 'That email is already used by another employee.'
            : 'That Employee ID is already in use.'
          : error.message
      );
      return;
    }
    setAddForm(EMPTY_ADD_FORM);
    setAddDepartment(null);
    setAddBranchId(null);
    setAddGender(null);
    setAddManagerId(null);
    setShowAddForm(false);
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
        // The HR label ("Resigned" or "Terminated"). Left out before the HR-profile
        // migration has been run, when there's no such column to write — "Terminated"
        // can't be recorded until then.
        ...('employment_status' in resignEmployee || resignReason === 'terminated' ? { employment_status: resignReason } : {}),
      })
      .eq('id', resignEmployee.id);
    setResigning(false);
    if (error) {
      setResignError(error.message);
      return;
    }
    // Start the exit checklist for them (or, if one is already under way, keep its last
    // working date in step with this one). Errors are ignored: until the separation
    // migration has been run there is no table, and the profile offers "Start checklist".
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
    if (!(await confirmAsync('Restore', `Restore ${emp.name} to active? They'll show up in active views again.`, 'Restore'))) return;
    const { error } = await supabase
      .from('employees')
      .update({ status: 'active', resigned_at: null, ...('employment_status' in emp ? { employment_status: 'active' } : {}) })
      .eq('id', emp.id);
    if (error) notify('Could not update', error.message);
    reload();
  }

  // The stored files an employee's documents point to. They sit in private storage, which
  // deleting database rows can't reach, so whoever deletes the employee has to remove the
  // files too. Empty (not an error) until the documents migration has been run.
  async function documentPaths(employeeId: string): Promise<string[]> {
    const { data } = await supabase.from('employee_documents').select('file_path').eq('employee_id', employeeId);
    return (data ?? []).map(d => d.file_path as string);
  }
  async function removeDocumentFiles(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
    if (error) notify('Some files were left behind', `The employee was deleted, but ${paths.length} stored document file(s) could not be removed: ${error.message}`);
  }

  async function handleRemove(emp: Employee) {
    // Someone who has already left: removing them means erasing everything tied to them, which a plain delete is
    // refused for whenever they have any history. So it goes straight to the type-the-name confirmation.
    if (emp.status !== 'active') {
      openForceDelete(emp);
      return;
    }
    const paths = await documentPaths(emp.id);
    const message =
      paths.length > 0
        ? `Remove ${emp.name}? Their ${paths.length} uploaded document${paths.length === 1 ? '' : 's'} will be permanently deleted too.`
        : `Remove ${emp.name}?`;
    if (!(await confirmAsync('Remove employee', message, 'Remove', true))) return;
    const { error } = await supabase.from('employees').delete().eq('id', emp.id);
    if (error) {
      if (error.code === '23503') {
        // Still working here, with history: offer to erase it all behind the same confirmation, not a dead end.
        openForceDelete(
          emp,
          `${emp.name} still works here and has attendance, tasks, shifts, leave or other records tied to them. If they have left, "Mark Resigned" keeps that history instead of erasing it.`
        );
      } else {
        notify('Could not remove', error.message);
      }
      return;
    }
    await removeDocumentFiles(paths);
    toast.show('Employee removed');
    reload();
  }

  async function applyBranchChange(employeeId: string, branchId: string | null) {
    const { error } = await supabase.from('employees').update({ branch_id: branchId }).eq('id', employeeId);
    if (error) Alert.alert('Could not update branch', error.message);
    reload();
  }

  async function pickAndUploadPhoto(emp: Employee) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required to set an employee photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingPhotoId(emp.id);
    try {
      const compressedUri = await compressPhoto(result.assets[0].uri);
      const response = await fetch(compressedUri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `employee-photos/${emp.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, arrayBuffer, { contentType: 'image/jpeg' });
      if (uploadError) {
        Alert.alert('Photo upload failed', uploadError.message);
        return;
      }
      const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
      const { error: updateError } = await supabase.from('employees').update({ profile_photo_url: publicUrl.publicUrl }).eq('id', emp.id);
      if (updateError) {
        Alert.alert('Could not save the photo', updateError.message);
        return;
      }
      setPhotoFailed(prev => {
        if (!prev.has(emp.id)) return prev;
        const next = new Set(prev);
        next.delete(emp.id);
        return next;
      });
      reload();
    } finally {
      setUploadingPhotoId(null);
    }
  }

  function startEditUsername(emp: Employee) {
    setEditingUsernameId(emp.id);
    setUsernameDraft(loginEmailByEmployee[emp.id] ?? '');
  }
  async function saveUsername(emp: Employee) {
    const email = usernameDraft.trim();
    if (!email) {
      Alert.alert('Username cannot be empty.');
      return;
    }
    if (email === (loginEmailByEmployee[emp.id] ?? '')) {
      setEditingUsernameId(null);
      return;
    }
    setSavingUsername(true);
    const result = await updateLoginEmail(emp.id, email);
    setSavingUsername(false);
    if (!result.ok) {
      Alert.alert(
        'Could not update the username',
        /already been registered|already exists|duplicate/i.test(result.error ?? '')
          ? 'That username is already used by another login — usernames must be unique.'
          : result.error
      );
      return;
    }
    setEditingUsernameId(null);
    reload();
  }

  function openLoginModal(emp: Employee) {
    setLoginEmail(emp.email ?? '');
    setLoginPassword(generatePassword());
    setLoginError(null);
    setLoginResult(null);
    setLoginModalEmployee(emp);
  }
  async function handleCreateLogin() {
    if (!loginModalEmployee) return;
    setCreatingLogin(true);
    setLoginError(null);
    const result = await createLogin(loginModalEmployee.id, loginEmail, loginPassword);
    setCreatingLogin(false);
    if (!result.ok) {
      setLoginError(result.error ?? 'Could not create the login.');
      return;
    }
    setLoginResult({ email: loginEmail, password: loginPassword });
    reload();
  }

  function openResetModal(emp: Employee) {
    setResetPasswordValue(generatePassword());
    setResetError(null);
    setResetResult(null);
    setResetModalEmployee(emp);
  }
  async function handleResetPassword() {
    if (!resetModalEmployee) return;
    setResettingPassword(true);
    setResetError(null);
    const result = await resetPassword(resetModalEmployee.id, resetPasswordValue);
    setResettingPassword(false);
    if (!result.ok) {
      setResetError(result.error ?? 'Could not reset the password.');
      return;
    }
    setResetResult(resetPasswordValue);
  }

  function openForceDelete(emp: Employee, note: string | null = null) {
    setForceDeleteEmployee(emp);
    setForceDeleteNote(note);
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
    toast.show('Employee removed');
    reload();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!!companyName && (
        <Text style={styles.companyLine} numberOfLines={1}>
          {companyName}
        </Text>
      )}
      <View style={styles.filterRow}>
        <TouchableOpacity style={[styles.filterBtn, { flex: 1 }]} onPress={() => setFilterOpen(true)}>
          <Text style={styles.filterBtnText} numberOfLines={1}>
            {filter === 'All' ? 'All Departments' : filter === 'Unenrolled' ? 'Biometric Unenrolled' : filter === 'Resigned' ? 'Resigned Employees' : filter}
          </Text>
          <ChevronIcon size={14} />
        </TouchableOpacity>
        {filter !== 'Resigned' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        )}
      </View>
      <TextInput style={styles.search} placeholder="Search employees…" placeholderTextColor={colors.slate400} value={search} onChangeText={setSearch} />
      <View style={styles.toolsRow}>
        <TouchableOpacity
          style={[styles.toolBtn, moreFilterCount > 0 && styles.toolBtnActive]}
          onPress={() => setMoreFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={moreFilterCount > 0 ? `Filters, ${moreFilterCount} applied` : 'Filters'}
        >
          <Text style={[styles.toolBtnText, moreFilterCount > 0 && { color: colors.accent }]}>{moreFilterCount > 0 ? `Filters (${moreFilterCount})` : 'Filters'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={() => setExportOpen(true)} accessibilityRole="button" accessibilityLabel="Export">
          <Text style={styles.toolBtnText}>Export</Text>
        </TouchableOpacity>
        <Text style={styles.countText}>
          {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
        </Text>
        {moreFilterCount > 0 && (
          <TouchableOpacity onPress={() => setMoreFilters(NO_FILTERS)} accessibilityRole="button" accessibilityLabel="Clear filters">
            <Text style={styles.clearLink}>Clear filters</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8, flexGrow: 1 }}
        renderItem={({ item }) => {
          const shift = resolveShift(item, shifts);
          const hasLogin = linkedEmployeeIds.has(item.id);
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.identity}>
                  <TouchableOpacity style={styles.avatar} onPress={() => pickAndUploadPhoto(item)} disabled={uploadingPhotoId === item.id}>
                    {uploadingPhotoId === item.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : item.profile_photo_url && !photoFailed.has(item.id) ? (
                      <Image
                        source={{ uri: item.profile_photo_url }}
                        style={styles.avatarImg}
                        onError={() => setPhotoFailed(prev => new Set(prev).add(item.id))}
                      />
                    ) : (
                      <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
                    )}
                    <View style={styles.avatarEditBadge}>
                      <EditIcon size={9} color={colors.white} />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.navigate('EmployeeDetail', { employeeId: item.id })}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {[item.designation, item.department].filter(Boolean).join(' · ') || 'No designation'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.cardId} accessibilityLabel={`Employee ID ${item.employee_code}`}>ID {item.employee_code}</Text>
              </View>

              <View style={styles.badgeRow}>
                <Badge tone={item.fingerprint_id ? 'good' : 'neutral'}>{item.fingerprint_id ? `Biometric ID ${item.fingerprint_id}` : 'Not Enrolled'}</Badge>
                {hasLogin && <Badge tone="good">Login Active</Badge>}
                {renderEmploymentBadges(item)}
              </View>

              <View style={styles.cardGrid}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Phone</Text>
                  <Text style={styles.gridValue} numberOfLines={1}>
                    {item.phone ?? '—'}
                  </Text>
                </View>

                <TouchableOpacity style={styles.gridItem} onPress={() => setBranchPickerFor(item)}>
                  <Text style={styles.gridLabel}>Branch</Text>
                  <View style={[styles.branchChip, !item.branch_id && styles.branchChipWarn]}>
                    <Text style={styles.branchChipText} numberOfLines={1}>
                      {branches.find(b => b.id === item.branch_id)?.name ?? 'Unassigned'}
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Shift</Text>
                  {rosterEmployeeIds.has(item.id) ? (
                    <View style={styles.shiftPill}>
                      <Text style={styles.shiftPillText}>Custom Roster</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.gridValue} numberOfLines={1}>
                        {shift.name}
                      </Text>
                      <Text style={styles.cardSub}>{formatShiftHours(shift)}</Text>
                    </>
                  )}
                </View>

                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Username</Text>
                  {hasLogin ? (
                    editingUsernameId === item.id ? (
                      <View style={{ gap: 4 }}>
                        <TextInput style={styles.usernameInput} value={usernameDraft} onChangeText={setUsernameDraft} autoFocus keyboardType="email-address" autoCapitalize="none" />
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <TouchableOpacity onPress={() => setEditingUsernameId(null)}>
                            <Text style={styles.cancelLink}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => saveUsername(item)} disabled={savingUsername}>
                            <Text style={styles.saveLink}>{savingUsername ? 'Saving…' : 'Save'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => startEditUsername(item)}>
                        <Text style={styles.gridValue} numberOfLines={1}>
                          {loginEmailByEmployee[item.id] ?? '—'}
                        </Text>
                        <Text style={styles.editHint}>tap to edit</Text>
                      </TouchableOpacity>
                    )
                  ) : (
                    <Text style={styles.dim}>—</Text>
                  )}
                </View>
              </View>

              <View style={styles.actionsRow}>
                {hasLogin ? (
                  <TouchableOpacity style={[styles.actionTile, styles.actionAccent]} onPress={() => openResetModal(item)}>
                    <KeyIcon size={12} color={colors.accent} />
                    <Text style={[styles.actionText, { color: colors.accent }]}>Reset</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.actionTile, styles.actionAccent]} onPress={() => openLoginModal(item)}>
                    <KeyIcon size={12} color={colors.accent} />
                    <Text style={[styles.actionText, { color: colors.accent }]}>Login</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'active' ? (
                  <TouchableOpacity style={[styles.actionTile, styles.actionWarning]} onPress={() => openResignModal(item)}>
                    <Text style={[styles.actionText, { color: colors.warningText }]}>Resign</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.actionTile, styles.actionAccent]} onPress={() => handleRestore(item)}>
                    <Text style={[styles.actionText, { color: colors.accent }]}>Restore</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.actionTile, styles.actionCritical]} onPress={() => handleRemove(item)}>
                  <Text style={[styles.actionText, { color: colors.criticalText }]}>Remove</Text>
                </TouchableOpacity>
                {item.status !== 'active' && (
                  <>
                    <TouchableOpacity style={[styles.actionTile, styles.actionWarning]} onPress={() => openResignModal(item)}>
                      <Text style={[styles.actionText, { color: colors.warningText }]}>Edit date</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No employees match this filter.</Text>}
      />

      {/* Add Employee modal */}
      <Modal visible={showAddForm} transparent animationType="fade" onRequestClose={() => setShowAddForm(false)}>
        <TouchableOpacity style={styles.modalBackdropCenter} activeOpacity={1} onPress={() => setShowAddForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <ScrollView>
              <View>
                <Text style={styles.formTitle}>Add Employee</Text>
                <Text style={styles.label}>Employee code</Text>
                <TextInput style={styles.input} accessibilityLabel="Employee code" value={addForm.employee_code} onChangeText={v => setAddForm(f => ({ ...f, employee_code: v }))} />
                <Text style={styles.label}>Full name</Text>
                <TextInput style={styles.input} accessibilityLabel="Full name" value={addForm.name} onChangeText={v => setAddForm(f => ({ ...f, name: v }))} />
                <Text style={styles.label}>Phone</Text>
                <TextInput style={styles.input} accessibilityLabel="Phone" value={addForm.phone} onChangeText={v => setAddForm(f => ({ ...f, phone: v }))} keyboardType="phone-pad" />
                <Text style={styles.label}>Email</Text>
                <TextInput style={styles.input} accessibilityLabel="Email" value={addForm.email} onChangeText={v => setAddForm(f => ({ ...f, email: v }))} keyboardType="email-address" />
                <Text style={styles.label}>Address</Text>
                <TextInput style={styles.input} accessibilityLabel="Address" value={addForm.address} onChangeText={v => setAddForm(f => ({ ...f, address: v }))} />
                <Text style={styles.label}>Designation</Text>
                <TextInput style={styles.input} accessibilityLabel="Designation" value={addForm.designation} onChangeText={v => setAddForm(f => ({ ...f, designation: v }))} />
                <Text style={styles.label}>Fingerprint / Biometric ID</Text>
                <TextInput style={styles.input} accessibilityLabel="Fingerprint / Biometric ID" value={addForm.fingerprint_id} onChangeText={v => setAddForm(f => ({ ...f, fingerprint_id: v }))} />
                <Text style={styles.label}>Date of joining</Text>
                <DatePicker value={addForm.date_of_joining} onChange={v => setAddForm(f => ({ ...f, date_of_joining: v }))} />

                <Text style={styles.label}>Phone (official)</Text>
                <TextInput style={styles.input} accessibilityLabel="Phone (official)" value={addForm.official_phone} onChangeText={v => setAddForm(f => ({ ...f, official_phone: v }))} keyboardType="phone-pad" />
                <Text style={styles.label}>Email (personal)</Text>
                <TextInput style={styles.input} accessibilityLabel="Email (personal)" value={addForm.personal_email} onChangeText={v => setAddForm(f => ({ ...f, personal_email: v }))} keyboardType="email-address" autoCapitalize="none" />

                <Text style={styles.label}>Employment type</Text>
                <View style={styles.chipsRow}>
                  <TouchableOpacity style={[styles.pickChip, !addForm.employment_type && styles.pickChipActive]} onPress={() => setAddForm(f => ({ ...f, employment_type: '' }))}>
                    <Text style={[styles.pickChipText, !addForm.employment_type && styles.pickChipTextActive]}>Not set</Text>
                  </TouchableOpacity>
                  {EMPLOYMENT_TYPES.map(t => (
                    <TouchableOpacity key={t.value} style={[styles.pickChip, addForm.employment_type === t.value && styles.pickChipActive]} onPress={() => setAddForm(f => ({ ...f, employment_type: t.value }))}>
                      <Text style={[styles.pickChipText, addForm.employment_type === t.value && styles.pickChipTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {addForm.employment_type === 'contract' && (
                  <>
                    <Text style={styles.label}>Contract start date</Text>
                    <DatePicker value={addForm.contract_start} onChange={v => setAddForm(f => ({ ...f, contract_start: v }))} />
                    <Text style={styles.label}>Contract end date</Text>
                    <DatePicker value={addForm.contract_end} onChange={v => setAddForm(f => ({ ...f, contract_end: v }))} />
                  </>
                )}

                <Text style={styles.label}>Reporting to</Text>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => { setManagerSearch(''); setPickingManager(true); }} accessibilityRole="button" accessibilityLabel="Reporting to">
                  <Text style={[styles.pickerText, !addManager && { color: colors.slate400, fontWeight: '400' }]} numberOfLines={1}>
                    {addManager ? `${addManager.name} (${addManager.employee_code})` : 'No one'}
                  </Text>
                  <Text style={styles.chevron}>▾</Text>
                </TouchableOpacity>

                {/* Inside this form, so the phone puts it on top of it instead of failing to present a second pop-up. */}
                <Sheet visible={pickingManager} title="Reporting to" onClose={() => setPickingManager(false)}>
                  <TextInput
                    style={styles.pickerSearch}
                    value={managerSearch}
                    onChangeText={setManagerSearch}
                    placeholder="Search by name or code"
                    placeholderTextColor={colors.slate400}
                    accessibilityLabel="Search people"
                  />
                  <PersonRow label="No one" active={!addManagerId} onPress={() => { setAddManagerId(null); setPickingManager(false); }} />
                  {managerChoices.slice(0, 60).map(p => (
                    <PersonRow
                      key={p.id}
                      label={`${p.name} (${p.employee_code})`}
                      active={addManagerId === p.id}
                      onPress={() => { setAddManagerId(p.id); setPickingManager(false); }}
                    />
                  ))}
                  {managerChoices.length > 60 && <Text style={styles.hint}>Showing the first 60 — type to narrow it down.</Text>}
                </Sheet>

                <Text style={styles.label}>Gender</Text>
                <View style={styles.chipsRow}>
                  <TouchableOpacity style={[styles.pickChip, addGender === null && styles.pickChipActive]} onPress={() => setAddGender(null)}>
                    <Text style={[styles.pickChipText, addGender === null && styles.pickChipTextActive]}>Not set</Text>
                  </TouchableOpacity>
                  {GENDER_OPTIONS.map(g => (
                    <TouchableOpacity key={g.value} style={[styles.pickChip, addGender === g.value && styles.pickChipActive]} onPress={() => setAddGender(g.value)}>
                      <Text style={[styles.pickChipText, addGender === g.value && styles.pickChipTextActive]}>{g.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hint}>Used for gender-specific holidays (e.g. Teej).</Text>

                <Text style={styles.label}>Department</Text>
                <View style={styles.chipsRow}>
                  <TouchableOpacity style={[styles.pickChip, addDepartment === null && styles.pickChipActive]} onPress={() => setAddDepartment(null)}>
                    <Text style={[styles.pickChipText, addDepartment === null && styles.pickChipTextActive]}>Unassigned</Text>
                  </TouchableOpacity>
                  {departmentOptions.map(d => (
                    <TouchableOpacity key={d.id} style={[styles.pickChip, addDepartment === d.name && styles.pickChipActive]} onPress={() => setAddDepartment(d.name)}>
                      <Text style={[styles.pickChipText, addDepartment === d.name && styles.pickChipTextActive]}>{d.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>Branch</Text>
                <View style={styles.chipsRow}>
                  <TouchableOpacity style={[styles.pickChip, addBranchId === null && styles.pickChipActive]} onPress={() => setAddBranchId(null)}>
                    <Text style={[styles.pickChipText, addBranchId === null && styles.pickChipTextActive]}>Unassigned</Text>
                  </TouchableOpacity>
                  {branches.map(b => (
                    <TouchableOpacity key={b.id} style={[styles.pickChip, addBranchId === b.id && styles.pickChipActive]} onPress={() => setAddBranchId(b.id)}>
                      <Text style={[styles.pickChipText, addBranchId === b.id && styles.pickChipTextActive]}>{b.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!addBranchId && <Text style={styles.hint}>GPS check-in won't work until set.</Text>}

                {addError && <Text style={styles.errorText}>{addError}</Text>}
                <View style={styles.formActions}>
                  <TouchableOpacity onPress={() => setShowAddForm(false)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleAddEmployee} disabled={saving} style={styles.saveModalBtn}>
                    <Text style={styles.saveModalBtnText}>{saving ? 'Saving…' : 'Save employee'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Filter modal */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setFilterOpen(false)}>
          <View style={styles.modalSheet}>
            {filterOptions.map(f => (
              <TouchableOpacity
                key={f}
                style={styles.modalOption}
                onPress={() => {
                  chooseFilter(f);
                  setFilterOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, filter === f && { color: colors.accent, fontWeight: '700' }]}>
                  {f === 'All' ? 'All Departments' : f === 'Unenrolled' ? 'Biometric Unenrolled' : f === 'Resigned' ? 'Resigned Employees' : f}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Branch picker */}
      <Modal visible={!!branchPickerFor} transparent animationType="fade" onRequestClose={() => setBranchPickerFor(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setBranchPickerFor(null)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={[{ id: '', name: 'Unassigned' } as any, ...branches]}
              keyExtractor={item => item.id || 'unassigned'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    if (branchPickerFor) applyBranchChange(branchPickerFor.id, item.id || null);
                    setBranchPickerFor(null);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Create login modal */}
      <Modal visible={!!loginModalEmployee} transparent animationType="fade" onRequestClose={() => setLoginModalEmployee(null)}>
        <TouchableOpacity style={styles.modalBackdropCenter} activeOpacity={1} onPress={() => setLoginModalEmployee(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            {loginResult ? (
              <>
                <Text style={styles.formTitle}>Login created</Text>
                <Text style={styles.hint}>Share these with {loginModalEmployee?.name} so they can sign in on the mobile app. This password won't be shown again.</Text>
                <View style={styles.resultBox}>
                  <Text style={styles.resultLabel}>Email</Text>
                  <Text style={styles.resultValue}>{loginResult.email}</Text>
                  <Text style={[styles.resultLabel, { marginTop: 8 }]}>Password</Text>
                  <Text style={styles.resultValue}>{loginResult.password}</Text>
                </View>
                <TouchableOpacity style={[styles.saveModalBtn, { alignSelf: 'flex-end' }]} onPress={() => setLoginModalEmployee(null)}>
                  <Text style={styles.saveModalBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.formTitle}>Create Login</Text>
                <Text style={styles.hint}>{loginModalEmployee?.name} will use this to sign in on the mobile app.</Text>
                <Text style={styles.label}>Email</Text>
                <TextInput style={styles.input} value={loginEmail} onChangeText={setLoginEmail} keyboardType="email-address" autoCapitalize="none" />
                <Text style={styles.label}>Temporary password</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={loginPassword} onChangeText={setLoginPassword} />
                  <TouchableOpacity style={styles.regenBtn} onPress={() => setLoginPassword(generatePassword())}>
                    <Text style={styles.regenBtnText}>Regenerate</Text>
                  </TouchableOpacity>
                </View>
                {loginError && <Text style={styles.errorText}>{loginError}</Text>}
                <View style={styles.formActions}>
                  <TouchableOpacity onPress={() => setLoginModalEmployee(null)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCreateLogin} disabled={creatingLogin} style={styles.saveModalBtn}>
                    <Text style={styles.saveModalBtnText}>{creatingLogin ? 'Creating…' : 'Create login'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Reset password modal */}
      <Modal visible={!!resetModalEmployee} transparent animationType="fade" onRequestClose={() => setResetModalEmployee(null)}>
        <TouchableOpacity style={styles.modalBackdropCenter} activeOpacity={1} onPress={() => setResetModalEmployee(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            {resetResult ? (
              <>
                <Text style={styles.formTitle}>Password reset</Text>
                <Text style={styles.hint}>Share this with {resetModalEmployee?.name}. Their old password no longer works. This won't be shown again.</Text>
                <View style={styles.resultBox}>
                  <Text style={styles.resultLabel}>New password</Text>
                  <Text style={styles.resultValue}>{resetResult}</Text>
                </View>
                <TouchableOpacity style={[styles.saveModalBtn, { alignSelf: 'flex-end' }]} onPress={() => setResetModalEmployee(null)}>
                  <Text style={styles.saveModalBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.formTitle}>Reset Password</Text>
                <Text style={styles.hint}>Sets a new password for {resetModalEmployee?.name}'s login. Their current password stops working immediately.</Text>
                <Text style={styles.label}>New password</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={resetPasswordValue} onChangeText={setResetPasswordValue} />
                  <TouchableOpacity style={styles.regenBtn} onPress={() => setResetPasswordValue(generatePassword())}>
                    <Text style={styles.regenBtnText}>Regenerate</Text>
                  </TouchableOpacity>
                </View>
                {resetError && <Text style={styles.errorText}>{resetError}</Text>}
                <View style={styles.formActions}>
                  <TouchableOpacity onPress={() => setResetModalEmployee(null)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleResetPassword} disabled={resettingPassword} style={styles.saveModalBtn}>
                    <Text style={styles.saveModalBtnText}>{resettingPassword ? 'Resetting…' : 'Reset password'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Force delete modal */}
      <Modal visible={!!forceDeleteEmployee} transparent animationType="fade" onRequestClose={() => setForceDeleteEmployee(null)}>
        <TouchableOpacity style={styles.modalBackdropCenter} activeOpacity={1} onPress={() => setForceDeleteEmployee(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.formSheet, { borderWidth: 2, borderColor: colors.criticalBg }]}>
            <Text style={[styles.formTitle, { color: colors.criticalText }]}>Permanently delete {forceDeleteEmployee?.name}?</Text>
            {!!forceDeleteNote && <Text style={[styles.hint, { color: colors.warningText, fontWeight: '600' }]}>{forceDeleteNote}</Text>}
            <Text style={styles.hint}>
              This erases their attendance logs, payroll history, tasks, leave requests, corrections, shifts and roster, CV entries, exit records and documents — everything, not just
              their profile. There is no undo. Their sign-in account (if any) is kept but unlinked, not deleted.
            </Text>
            <Text style={styles.label}>
              Type <Text style={{ fontWeight: '700', color: colors.ink }}>{forceDeleteEmployee?.name}</Text> to confirm
            </Text>
            <TextInput style={styles.input} value={forceDeleteConfirmText} onChangeText={setForceDeleteConfirmText} autoFocus />
            {forceDeleteError && <Text style={styles.errorText}>{forceDeleteError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setForceDeleteEmployee(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleForceDelete}
                disabled={forceDeleting || forceDeleteConfirmText !== forceDeleteEmployee?.name}
                style={[styles.saveModalBtn, { backgroundColor: colors.critical, opacity: forceDeleteConfirmText !== forceDeleteEmployee?.name ? 0.5 : 1 }]}
              >
                <Text style={styles.saveModalBtnText}>{forceDeleting ? 'Deleting…' : 'Permanently delete'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* More filters: outlet, designation, employment type, status */}
      <Sheet visible={moreFiltersOpen} title="Filters" subtitle="Applied on top of the department / view you picked." onClose={() => setMoreFiltersOpen(false)} closeLabel="Close" onSubmit={() => setMoreFilters(NO_FILTERS)} submitLabel="Clear all">
        <Choice
          label="Outlet / branch"
          options={[...branches.map(b => ({ label: b.name, value: b.id })), { label: 'Unassigned', value: 'none' }]}
          value={moreFilters.branch === 'All' ? null : moreFilters.branch}
          onChange={v => setMoreFilters(m => ({ ...m, branch: v ?? 'All' }))}
          allowNone
          noneLabel="All outlets"
        />
        <Choice
          label="Designation"
          options={designations.map(d => ({ label: d, value: d }))}
          value={moreFilters.designation === 'All' ? null : moreFilters.designation}
          onChange={v => setMoreFilters(m => ({ ...m, designation: v ?? 'All' }))}
          allowNone
          noneLabel="All designations"
        />
        <Choice
          label="Employment type"
          options={[...EMPLOYMENT_TYPES.map(t => ({ label: t.label, value: t.value as string })), { label: 'Not set', value: 'none' }]}
          value={moreFilters.type === 'All' ? null : moreFilters.type}
          onChange={v => setMoreFilters(m => ({ ...m, type: v ?? 'All' }))}
          allowNone
          noneLabel="All types"
        />
        <Choice
          label="Status"
          options={[
            ...((filter === 'Resigned' ? ['resigned', 'terminated'] : ['active', 'probation', 'suspended']) as EmploymentStatus[]).map(s => ({ label: EMPLOYMENT_STATUS_LABEL[s], value: s as string })),
            ...(filter === 'Resigned' ? [{ label: 'Settlement not completed', value: 'settlement_pending' }] : []),
          ]}
          value={moreFilters.status === 'All' ? null : moreFilters.status}
          onChange={v => setMoreFilters(m => ({ ...m, status: v ?? 'All' }))}
          allowNone
          noneLabel={filter === 'Resigned' ? 'Resigned & terminated' : 'Active, probation & suspended'}
        />
      </Sheet>

      <Sheet visible={exportOpen} title="Export directory" subtitle={`${filtered.length} ${filtered.length === 1 ? 'person' : 'people'} matching the current view and filters.`} onClose={() => setExportOpen(false)} saving={exporting} closeLabel="Close">
        <View style={{ gap: 10, marginTop: 12 }}>
          <Button label={exporting ? 'Preparing…' : 'Download Excel (CSV)'} onPress={() => runExport('csv')} disabled={exporting || filtered.length === 0} />
          <Button label="Download PDF" tone="ghost" onPress={() => runExport('pdf')} disabled={exporting || filtered.length === 0} />
        </View>
      </Sheet>

      <Modal visible={!!resignEmployee} transparent animationType="fade" onRequestClose={() => setResignEmployee(null)}>
        <TouchableOpacity style={styles.modalBackdropCenter} activeOpacity={1} onPress={() => setResignEmployee(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>
              {resignEmployee?.status === 'active' ? `Mark ${resignEmployee?.name} as resigned?` : `Resignation date for ${resignEmployee?.name}`}
            </Text>
            <Text style={styles.hint}>
              {resignEmployee?.status === 'active'
                ? "They'll be removed from active views but their history is kept."
                : 'Update the date their resignation takes effect.'}
            </Text>
            <Text style={styles.label}>Reason</Text>
            <View style={styles.chipsRow}>
              {(['resigned', 'terminated'] as const).map(r => (
                <TouchableOpacity key={r} style={[styles.pickChip, resignReason === r && styles.pickChipActive]} onPress={() => setResignReason(r)} accessibilityRole="button" accessibilityLabel={`Reason: ${EMPLOYMENT_STATUS_LABEL[r]}`}>
                  <Text style={[styles.pickChipText, resignReason === r && styles.pickChipTextActive]}>{EMPLOYMENT_STATUS_LABEL[r]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>{resignReason === 'terminated' ? 'Last working date' : 'Resignation date'}</Text>
            <DatePicker value={resignDate} onChange={setResignDate} />
            {resignError && <Text style={styles.errorText}>{resignError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setResignEmployee(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmResign}
                disabled={resigning || !resignDate}
                style={[styles.saveModalBtn, { backgroundColor: colors.critical, opacity: resigning || !resignDate ? 0.5 : 1 }]}
              >
                <Text style={styles.saveModalBtnText}>
                  {resigning ? 'Saving…' : resignEmployee?.status === 'active' ? 'Mark resigned' : 'Save date'}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function PersonRow({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.personRow, active && styles.personRowActive]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}>
      <Text style={[styles.personText, active && { color: colors.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  companyLine: { fontSize: 12, fontWeight: '700', color: colors.slate500, paddingHorizontal: 16, paddingTop: 12 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 16 },
  addBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  addBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.white },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  search: { marginHorizontal: 16, marginTop: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.white, color: colors.ink },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  identity: { flexDirection: 'row', gap: 10, flex: 1, alignItems: 'center' },
  cardName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  cardSub: { fontSize: 11, color: colors.slate400, marginTop: 1 },
  cardId: { fontSize: 12, fontWeight: '700', color: colors.slate400 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  toolsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  toolBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.white },
  toolBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  toolBtnText: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  countText: { fontSize: 12, color: colors.slate400, flex: 1, textAlign: 'right' },
  clearLink: { fontSize: 12, fontWeight: '700', color: colors.accent },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: colors.slate100, paddingTop: 12 },
  gridItem: { width: '50%', paddingRight: 10, marginBottom: 10 },
  gridLabel: { fontSize: 10, fontWeight: '700', color: colors.slate400, textTransform: 'uppercase', marginBottom: 3 },
  gridValue: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  dim: { fontSize: 13, color: colors.slate400 },
  avatar: { height: 40, width: 40, borderRadius: 20, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarImg: { height: '100%', width: '100%', borderRadius: 20 },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    height: 16,
    width: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  usernameInput: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, fontSize: 12, color: colors.ink },
  editHint: { fontSize: 9, color: colors.slate400 },
  cancelLink: { fontSize: 11, color: colors.slate500, fontWeight: '600' },
  saveLink: { fontSize: 11, color: colors.accent, fontWeight: '700' },
  branchChip: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  branchChipWarn: { borderColor: colors.warning },
  branchChipText: { fontSize: 11, color: colors.slate500 },
  shiftPill: { alignSelf: 'flex-start', backgroundColor: colors.accentLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  shiftPillText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  actionTile: { flexDirection: 'row', gap: 3, alignItems: 'center', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1 },
  actionAccent: { backgroundColor: colors.accentLight, borderColor: colors.accent },
  actionWarning: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  actionCritical: { backgroundColor: colors.criticalBg, borderColor: colors.critical },
  actionText: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
  modalBackdropCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20, maxHeight: '85%' },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  hint: { fontSize: 11, color: colors.slate400, marginTop: 4, marginBottom: 8, lineHeight: 16 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pickerText: { fontSize: 14, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  chevron: { fontSize: 14, color: colors.slate400 },
  pickerSearch: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink, marginTop: 10, marginBottom: 6 },
  personRow: { paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100, borderRadius: 8 },
  personRowActive: { backgroundColor: colors.accentLight },
  personText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  pickChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pickChipText: { fontSize: 11, fontWeight: '600', color: colors.slate500 },
  pickChipTextActive: { color: colors.white },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveModalBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveModalBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  regenBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center' },
  regenBtnText: { fontSize: 11, fontWeight: '600', color: colors.slate500 },
  resultBox: { backgroundColor: colors.slate50, borderRadius: 10, padding: 12, marginVertical: 8 },
  resultLabel: { fontSize: 10, color: colors.slate400, textTransform: 'uppercase' },
  resultValue: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 },
});
