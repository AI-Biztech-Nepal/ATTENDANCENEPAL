import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Image, Linking, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { formatAdDate } from '../lib/calendar';
import {
  BLOOD_GROUPS,
  EMPLOYMENT_STATUS_LABEL,
  EMPLOYMENT_TYPES,
  MARITAL_STATUSES,
  NEPAL_PROVINCES,
  PROFILE_COLUMNS,
  STATUS_TONE,
  WORKING_STATUSES,
  contractLabel,
  effectiveStatus,
  employmentTypeLabel,
  formatAddress,
  formatDuration,
  withKnownColumns,
} from '../lib/employeeProfile';
import { DOCUMENT_TYPES } from '../lib/employeeDocuments';
import { contractAlerts, startOfToday } from '../lib/hrAlerts';
import type { Branch, Department, Employee } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import DocumentRing from '../components/DocumentRing';
import { Choice, CollapsibleCard, DateField, Field, InfoRow, LinkText, Notice, Sheet, SubHeading, confirmAsync } from '../components/hr/HrKit';
import HistoryCard from '../components/hr/HistoryCard';
import SeparationCard from '../components/hr/SeparationCard';
import { EducationCard, ExperienceCard, TrainingCard } from '../components/hr/CvCards';
import PerformanceCard from '../components/hr/PerformanceCard';
import ConductCard from '../components/hr/ConductCard';
import DocumentsCard from '../components/hr/DocumentsCard';

// Every field on the form is held as a string. The first group are the columns this
// screen has always edited; PROFILE_COLUMNS are the HR-profile ones added by
// 20261101120000_employee_hr_profile.sql.
const LEGACY_KEYS = [
  'name',
  'email',
  'phone',
  'gender',
  'department',
  'designation',
  'branch_id',
  'date_of_joining',
  'address',
  'fingerprint_id',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
  'pan_no',
  'ssf_no',
  'salary',
  'allowance',
] as const;
const FORM_KEYS = [...LEGACY_KEYS, ...PROFILE_COLUMNS] as const;
type FormKey = (typeof FORM_KEYS)[number];
type FormState = Record<FormKey, string>;

const EMPTY_FORM = Object.fromEntries(FORM_KEYS.map(k => [k, ''])) as FormState;

function formFromEmployee(row: Record<string, unknown>): FormState {
  const form = { ...EMPTY_FORM };
  for (const key of FORM_KEYS) {
    const value = row[key];
    form[key] = value == null ? '' : String(value);
  }
  if (!form.employment_status) form.employment_status = 'active';
  return form;
}

// Human names for every field, so the unsaved-changes bar can say what was touched.
const FIELD_LABELS: Record<FormKey, string> = {
  name: 'Full name',
  email: 'Email (official)',
  phone: 'Phone (personal)',
  gender: 'Gender',
  department: 'Department',
  designation: 'Designation',
  branch_id: 'Outlet / branch',
  date_of_joining: 'Date of joining',
  address: 'Other address note',
  fingerprint_id: 'Biometric ID',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_relationship: 'Emergency contact relationship',
  emergency_contact_phone: 'Emergency contact mobile',
  pan_no: 'PAN No.',
  ssf_no: 'SSF No.',
  salary: 'Salary',
  allowance: 'Allowance',
  employment_type: 'Employment type',
  employment_status: 'Employment status',
  contract_start: 'Contract start date',
  contract_end: 'Contract end date',
  reporting_to: 'Reporting to',
  official_phone: 'Phone (official)',
  personal_email: 'Email (personal)',
  date_of_birth: 'Date of birth',
  nationality: 'Nationality',
  marital_status: 'Marital status',
  blood_group: 'Blood group',
  citizenship_no: 'Citizenship no.',
  citizenship_issued_district: 'Citizenship issued district',
  citizenship_issue_date: 'Citizenship issue date',
  permanent_province: 'Permanent province',
  permanent_district: 'Permanent district',
  permanent_municipality: 'Permanent municipality',
  permanent_ward: 'Permanent ward',
  permanent_tole: 'Permanent tole',
  temporary_province: 'Temporary province',
  temporary_district: 'Temporary district',
  temporary_municipality: 'Temporary municipality',
  temporary_ward: 'Temporary ward',
  temporary_tole: 'Temporary tole',
  father_name: "Father's name",
  mother_name: "Mother's name",
  grandfather_name: "Grandfather's name",
  spouse_name: "Spouse's name",
  emergency_contact_address: 'Emergency contact address',
};

// Each card on the Overview has its own Edit link that opens a bottom sheet with just that
// section's fields — the same sections the website's pop-ups use. `fields` is everything the
// sheet edits (and the only columns a save sends); `required` is what is worth having filled in
// (it feeds the "N missing" chip on the card).
type SectionId = 'employment' | 'personal' | 'contact' | 'family' | 'emergency' | 'pay';
const SECTION_META: Record<SectionId, { title: string; hint?: string; fields: FormKey[]; required: FormKey[] }> = {
  employment: {
    title: 'Employment',
    hint: 'Where they work and under what terms.',
    fields: ['name', 'employment_type', 'employment_status', 'contract_start', 'contract_end', 'reporting_to', 'department', 'designation', 'branch_id', 'fingerprint_id', 'date_of_joining'],
    required: ['name', 'employment_type', 'department', 'designation', 'branch_id', 'date_of_joining'],
  },
  personal: {
    title: 'Personal',
    hint: 'Identity details used on the CV and for government records.',
    fields: ['gender', 'date_of_birth', 'nationality', 'marital_status', 'blood_group', 'citizenship_no', 'citizenship_issued_district', 'citizenship_issue_date'],
    required: ['gender', 'date_of_birth', 'nationality', 'marital_status', 'blood_group'],
  },
  contact: {
    title: 'Contact & address',
    fields: [
      'phone',
      'official_phone',
      'email',
      'personal_email',
      'permanent_province',
      'permanent_district',
      'permanent_municipality',
      'permanent_ward',
      'permanent_tole',
      'temporary_province',
      'temporary_district',
      'temporary_municipality',
      'temporary_ward',
      'temporary_tole',
      'address',
    ],
    required: ['phone', 'email', 'permanent_province', 'permanent_district', 'permanent_municipality', 'permanent_ward', 'permanent_tole'],
  },
  family: { title: 'Family', fields: ['father_name', 'mother_name', 'grandfather_name', 'spouse_name'], required: [] },
  emergency: {
    title: 'Emergency contact',
    hint: 'Who to call first. Shown on the profile next to the blood group.',
    fields: ['emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone', 'emergency_contact_address'],
    required: ['emergency_contact_name', 'emergency_contact_phone'],
  },
  pay: { title: 'Pay & statutory', fields: ['salary', 'allowance', 'pan_no', 'ssf_no'], required: [] },
};

type Tab = 'overview' | 'records' | 'docs' | 'exit';

type PersonOption = Pick<Employee, 'id' | 'name' | 'employee_code' | 'status'>;

export default function EmployeeDetailScreen({ route }: any) {
  const { employeeId } = route.params as { employeeId: string };
  const { system } = useCalendarSystem();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [baseline, setBaseline] = useState<FormState>(EMPTY_FORM);
  const [pickingManager, setPickingManager] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  // Bumped after a save so the history card re-reads what the database just logged.
  const [historyVersion, setHistoryVersion] = useState(0);
  // Which section is showing, plus the small facts the tab labels and the overview need.
  const [tab, setTab] = useState<Tab>('overview');
  const [docTypes, setDocTypes] = useState<string[] | null>(null);
  const [openConduct, setOpenConduct] = useState<number | null>(null);
  const [exitStatus, setExitStatus] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Which section's sheet is open (null = none). `form` is the working copy the sheet edits;
  // while no sheet is open it is the same as `baseline` (what is saved).
  const [editing, setEditing] = useState<SectionId | null>(null);

  /** Re-read the employee. The form is only reset when `resetForm` — a change made in one of
   * the cards below shouldn't throw away what is half typed above. */
  const reload = useCallback(
    (resetForm = true) => {
      supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .single()
        .then(({ data }) => {
          setLoading(false);
          if (!data) return;
          const emp = data as Employee;
          setEmployee({ ...emp, skills: emp.skills ?? [] });
          if (resetForm) {
            const next = formFromEmployee(data as Record<string, unknown>);
            setForm(next);
            setBaseline(next);
          }
        });
    },
    [employeeId]
  );

  useEffect(() => {
    reload();
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartments((data as Department[]) ?? []));
    supabase
      .from('employees')
      .select('id, name, employee_code, status')
      .order('name')
      .then(({ data }) => setPeople((data as PersonOption[]) ?? []));
  }, [employeeId, reload]);

  const set = (key: FormKey) => (value: string) => {
    setSaved(false);
    setForm(f => ({ ...f, [key]: value }));
  };
  // Each query may fail — before its migration there is no such table — and the label then
  // just leaves that item out. Re-read when the tab changes, so edits made in another tab show.
  useEffect(() => {
    supabase
      .from('employee_documents')
      .select('doc_type')
      .eq('employee_id', employeeId)
      .then(({ data, error: e }) => setDocTypes(e ? null : (data ?? []).map((d: { doc_type: string }) => d.doc_type)));
    supabase
      .from('employee_conduct_records')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', employeeId)
      .neq('status', 'closed')
      .then(({ count, error: e }) => setOpenConduct(e ? null : (count ?? 0)));
    supabase
      .from('employee_separations')
      .select('settlement_status')
      .eq('employee_id', employeeId)
      .maybeSingle()
      .then(({ data, error: e }) => setExitStatus(e ? null : ((data as { settlement_status?: string } | null)?.settlement_status ?? 'none')));
  }, [employeeId, tab, historyVersion]);

  function openSection(id: SectionId) {
    setForm(baseline);
    setError(null);
    setSaved(false);
    setEditing(id);
  }

  /** Close the sheet; if something was changed, ask before throwing it away. */
  async function closeSection() {
    if (saving) return;
    const edited = editing ? SECTION_META[editing].fields.filter(k => form[k] !== baseline[k]) : [];
    if (edited.length > 0 && !(await confirmAsync('Discard changes?', `Throw away ${edited.length} unsaved change${edited.length === 1 ? '' : 's'}?`, 'Discard', true))) return;
    setForm(baseline);
    setError(null);
    setEditing(null);
  }

  function copyPermanentToTemporary() {
    setSaved(false);
    setForm(f => ({
      ...f,
      temporary_province: f.permanent_province,
      temporary_district: f.permanent_district,
      temporary_municipality: f.permanent_municipality,
      temporary_ward: f.permanent_ward,
      temporary_tole: f.permanent_tole,
    }));
  }

  async function handleSave() {
    if (!employee || !editing) return;
    setError(null);
    setSaved(false);
    const sectionFields: string[] = SECTION_META[editing].fields;
    const isContract = form.employment_type === 'contract';
    if (editing === 'employment') {
      if (!form.name.trim()) return setError('The name can’t be empty.');
      if (isContract && form.contract_start && form.contract_end && form.contract_end < form.contract_start) {
        return setError('The contract end date is before the contract start date.');
      }
    }
    if (editing === 'pay') {
      for (const key of ['salary', 'allowance'] as const) {
        if (form[key].trim() && (Number.isNaN(Number(form[key])) || Number(form[key]) < 0)) {
          return setError(`${key === 'salary' ? 'Salary' : 'Allowance'} must be a number, zero or more.`);
        }
      }
    }

    const payload: Record<string, unknown> = { name: form.name.trim() };
    for (const key of LEGACY_KEYS) {
      if (key === 'name' || key === 'salary' || key === 'allowance') continue;
      payload[key] = form[key].trim() || null;
    }
    payload.salary = form.salary.trim() ? Number(form.salary) : null;
    payload.allowance = form.allowance.trim() ? Number(form.allowance) : null;

    const added: Record<string, string | null> = {};
    for (const key of PROFILE_COLUMNS) {
      if (key === 'employment_status') continue;
      added[key] = form[key].trim() || null;
    }
    // Contract dates only mean something for a contract; clearing them when the type
    // changes keeps a stale end date from lingering on a permanent hire.
    if (!isContract) {
      added.contract_start = null;
      added.contract_end = null;
    }
    Object.assign(payload, withKnownColumns(employee, added));
    // Someone who has left keeps the Resigned / Terminated label that "Mark Resigned" gave
    // them; only people still working can be moved between Active, Probation and Suspended.
    if (employee.status === 'active' && ('employment_status' in employee || form.employment_status !== 'active')) {
      payload.employment_status = form.employment_status || 'active';
    }
    // Only this sheet's fields are sent — the rest of the profile is left exactly as it is.
    for (const key of Object.keys(payload)) if (!sectionFields.includes(key)) delete payload[key];

    setSaving(true);
    const { error: updateError } = await supabase.from('employees').update(payload).eq('id', employeeId);
    setSaving(false);
    if (updateError) return setError(`Could not save: ${updateError.message}`);
    setSaved(true);
    setEditing(null);
    reload();
    // The database may just have logged a transfer / promotion / pay change.
    setHistoryVersion(v => v + 1);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employee) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Employee not found.</Text>
      </View>
    );
  }

  const status = effectiveStatus(employee);
  const manager = people.find(p => p.id === form.reporting_to);
  const branchName = branches.find(b => b.id === employee.branch_id)?.name;
  const stillWorking = employee.status === 'active';
  // Reporting-to choices: people still working here, never the person themselves, plus
  // whoever is already chosen even if they have since left.
  const managerChoices = people
    .filter(p => p.id !== employee.id && (p.status === 'active' || p.id === form.reporting_to))
    .filter(p => {
      const q = managerSearch.trim().toLowerCase();
      return !q || p.name.toLowerCase().includes(q) || p.employee_code.toLowerCase().includes(q);
    });

  const savedManager = people.find(p => p.id === employee.reporting_to);
  const isContract = employee.employment_type === 'contract';
  const initials =
    employee.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || '?';
  const tenure = employee.date_of_joining
    ? Math.max(0, Math.floor(((employee.resigned_at ? new Date(employee.resigned_at).getTime() : Date.now()) - new Date(employee.date_of_joining).getTime()) / 86400000))
    : null;
  // A contract that ends within a month, or already has, for someone still working.
  const contractNotice =
    stillWorking && isContract
      ? (contractAlerts(
          [
            {
              id: employee.id,
              name: employee.name,
              designation: employee.designation,
              profile_photo_url: employee.profile_photo_url,
              employment_type: employee.employment_type ?? null,
              contract_end: employee.contract_end ?? null,
              date_of_birth: null,
            },
          ],
          startOfToday()
        )[0] ?? null)
      : null;
  const haveDocs = docTypes ? DOCUMENT_TYPES.filter(t => docTypes.includes(t.value)).length : null;
  const exitOpen = exitStatus !== null && exitStatus !== 'none' && exitStatus !== 'completed';
  const hasEmergency = !!(employee.emergency_contact_name || employee.emergency_contact_phone);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: openConduct ? `Records · ${openConduct} open` : 'Records' },
    { id: 'docs', label: haveDocs !== null ? `Docs · ${haveDocs}/${DOCUMENT_TYPES.length}` : 'Docs' },
    { id: 'exit', label: exitOpen ? 'Exit · open' : 'Exit' },
  ];

  // What has been changed in the open sheet so far — drives the "Edited" marks and the
  // "N unsaved changes" line above its buttons.
  const isEdited = (key: FormKey) => form[key] !== baseline[key];
  const sectionEdited = editing ? SECTION_META[editing].fields.filter(isEdited) : [];
  const sectionNote = sectionEdited.length
    ? `${sectionEdited.length} unsaved change${sectionEdited.length === 1 ? '' : 's'} · ${sectionEdited.map(k => FIELD_LABELS[k]).join(', ')}`
    : 'No changes yet';
  // The right-hand side of a card header: what is missing (read from what is saved) and the Edit link.
  const sectionHeaderRight = (id: SectionId) => {
    let missing = SECTION_META[id].required.filter(k => !baseline[k].trim()).length;
    if (id === 'employment' && baseline.employment_type === 'contract' && !baseline.contract_end) missing += 1;
    return (
      <View style={styles.cardRight}>
        {missing > 0 && <Badge tone="warning">{`${missing} missing`}</Badge>}
        <LinkText label="Edit" accessibilityLabel={`Edit ${SECTION_META[id].title}`} onPress={() => openSection(id)} />
      </View>
    );
  };
  // A nudge under the contract end date when it is close, or already past.
  const contractEndHint = (() => {
    if (form.employment_type !== 'contract' || !form.contract_end) return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(form.contract_end);
    if (!m) return undefined;
    const days = Math.round((new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() - startOfToday().getTime()) / 86400000);
    if (days < 0) return `Ended ${-days} day${days === -1 ? '' : 's'} ago — set a later date to renew.`;
    if (days <= 31) return `${days === 0 ? 'Ends today' : `Ends in ${days} day${days === 1 ? '' : 's'}`} — set a later date to renew.`;
    return undefined;
  })();
  // The saved values, as the read-only cards show them.
  const info = baseline;
  const when = (iso: string) => (iso ? formatAdDate(iso, system) : '');
  const capitalised = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const amount = (v: string) => (v.trim() && !Number.isNaN(Number(v)) ? Number(v).toLocaleString() : v);

  const departmentOptions = departments.map(d => ({ label: d.name, value: d.name }));
  if (form.department && !departments.some(d => d.name === form.department)) departmentOptions.unshift({ label: form.department, value: form.department });

  // The fields inside each section's sheet.
  function renderSectionFields(id: SectionId) {
    switch (id) {
      case 'employment':
        return (
          <>
            <Field label="Full name" value={form.name} onChangeText={set('name')} edited={isEdited('name')} />
            <Choice
              label="Employment type"
              options={EMPLOYMENT_TYPES.map(t => ({ label: t.label, value: t.value }))}
              value={form.employment_type}
              onChange={v => set('employment_type')(v ?? '')} edited={isEdited('employment_type')}
              allowNone
            />
            {stillWorking ? (
              <Choice
                label="Employment status"
                options={WORKING_STATUSES.map(s => ({ label: EMPLOYMENT_STATUS_LABEL[s], value: s }))}
                value={form.employment_status}
                onChange={v => v && set('employment_status')(v)} edited={isEdited('employment_status')}
              />
            ) : (
              <InfoRow label="Employment status" value={EMPLOYMENT_STATUS_LABEL[status]} />
            )}
            {!stillWorking && <Text style={styles.hint}>Restore the employee from the directory to change this.</Text>}
            {form.employment_type === 'contract' && (
              <>
                <DateField label="Contract start date" value={form.contract_start} onChange={set('contract_start')} edited={isEdited('contract_start')} />
                <DateField label="Contract end date" value={form.contract_end} onChange={set('contract_end')} edited={isEdited('contract_end')} hint={contractEndHint} hintTone="warn" />
              </>
            )}
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Reporting to</Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => { setManagerSearch(''); setPickingManager(true); }} accessibilityRole="button" accessibilityLabel="Reporting to">
                <Text style={[styles.pickerText, !manager && { color: colors.slate400, fontWeight: '400' }]}>{manager ? `${manager.name} (${manager.employee_code})` : 'No one'}</Text>
                <Text style={styles.chevron}>▾</Text>
              </TouchableOpacity>
            </View>
            <Choice label="Department" options={departmentOptions} value={form.department} onChange={v => set('department')(v ?? '')} edited={isEdited('department')} allowNone noneLabel="Unassigned" />
            <Field label="Designation" value={form.designation} onChangeText={set('designation')} edited={isEdited('designation')} />
            <Choice label="Outlet / branch" options={branches.map(b => ({ label: b.name, value: b.id }))} value={form.branch_id} onChange={v => set('branch_id')(v ?? '')} edited={isEdited('branch_id')} allowNone noneLabel="Unassigned" />
            <Field label="Fingerprint / Biometric ID" value={form.fingerprint_id} onChangeText={set('fingerprint_id')} edited={isEdited('fingerprint_id')} />
            <DateField label="Date of joining" value={form.date_of_joining} onChange={set('date_of_joining')} edited={isEdited('date_of_joining')} />

            {/* Inside this sheet, so the phone puts it on top of it instead of failing to present a second pop-up. */}
            <Sheet visible={pickingManager} title="Reporting to" onClose={() => setPickingManager(false)}>
              <TextInput
                style={styles.search}
                value={managerSearch}
                onChangeText={setManagerSearch}
                placeholder="Search by name or code"
                placeholderTextColor={colors.slate400}
                accessibilityLabel="Search people"
              />
              <PersonRow label="No one" active={!form.reporting_to} onPress={() => { set('reporting_to')(''); setPickingManager(false); }} />
              {managerChoices.slice(0, 60).map(p => (
                <PersonRow
                  key={p.id}
                  label={`${p.name} (${p.employee_code})${p.status === 'inactive' ? ' — left' : ''}`}
                  active={form.reporting_to === p.id}
                  onPress={() => { set('reporting_to')(p.id); setPickingManager(false); }}
                />
              ))}
              {managerChoices.length > 60 && <Text style={styles.hint}>Showing the first 60 — type to narrow it down.</Text>}
            </Sheet>
          </>
        );
      case 'personal':
        return (
          <>
            <Choice label="Gender" options={[{ label: 'Female', value: 'female' }, { label: 'Male', value: 'male' }]} value={form.gender} onChange={v => set('gender')(v ?? '')} edited={isEdited('gender')} allowNone />
            <DateField label="Date of birth" value={form.date_of_birth} onChange={set('date_of_birth')} edited={isEdited('date_of_birth')} />
            <Field label="Nationality" value={form.nationality} onChangeText={set('nationality')} edited={isEdited('nationality')} placeholder="Nepali" />
            <Choice label="Marital status" options={MARITAL_STATUSES.map(m => ({ label: m.label, value: m.value }))} value={form.marital_status} onChange={v => set('marital_status')(v ?? '')} edited={isEdited('marital_status')} allowNone />
            <Choice label="Blood group" options={BLOOD_GROUPS.map(b => ({ label: b, value: b }))} value={form.blood_group} onChange={v => set('blood_group')(v ?? '')} edited={isEdited('blood_group')} tone="danger" allowNone />
            <Field label="Citizenship no." value={form.citizenship_no} onChangeText={set('citizenship_no')} edited={isEdited('citizenship_no')} />
            <Field label="Citizenship issued district" value={form.citizenship_issued_district} onChangeText={set('citizenship_issued_district')} edited={isEdited('citizenship_issued_district')} />
            <DateField label="Citizenship issue date" value={form.citizenship_issue_date} onChange={set('citizenship_issue_date')} edited={isEdited('citizenship_issue_date')} />
          </>
        );
      case 'contact':
        return (
          <>
            <Field label="Phone (personal)" value={form.phone} onChangeText={set('phone')} edited={isEdited('phone')} keyboardType="phone-pad" />
            <Field label="Phone (official)" value={form.official_phone} onChangeText={set('official_phone')} edited={isEdited('official_phone')} keyboardType="phone-pad" />
            <Field label="Email (official)" value={form.email} onChangeText={set('email')} edited={isEdited('email')} keyboardType="email-address" hint="Also the email this person's login is linked to." />
            <Field label="Email (personal)" value={form.personal_email} onChangeText={set('personal_email')} edited={isEdited('personal_email')} keyboardType="email-address" />
            <SubHeading title="Permanent address" />
            <AddressFields kind="permanent" form={form} set={set} isEdited={isEdited} />
            <SubHeading title="Temporary address" action={<LinkText label="Same as permanent" onPress={copyPermanentToTemporary} />} />
            <AddressFields kind="temporary" form={form} set={set} isEdited={isEdited} />
            <SubHeading title="Other address note" />
            <Field label="Note" value={form.address} onChangeText={set('address')} edited={isEdited('address')} multiline placeholder="Anything that doesn't fit above (landmark, current rented room…)" />
          </>
        );
      case 'family':
        return (
          <>
            <Field label="Father's name" value={form.father_name} onChangeText={set('father_name')} edited={isEdited('father_name')} />
            <Field label="Mother's name" value={form.mother_name} onChangeText={set('mother_name')} edited={isEdited('mother_name')} />
            <Field label="Grandfather's name" value={form.grandfather_name} onChangeText={set('grandfather_name')} edited={isEdited('grandfather_name')} />
            <Field label="Spouse's name" value={form.spouse_name} onChangeText={set('spouse_name')} edited={isEdited('spouse_name')} />
          </>
        );
      case 'emergency':
        return (
          <>
            <Field label="Name" value={form.emergency_contact_name} onChangeText={set('emergency_contact_name')} edited={isEdited('emergency_contact_name')} />
            <Field label="Relationship" value={form.emergency_contact_relationship} onChangeText={set('emergency_contact_relationship')} edited={isEdited('emergency_contact_relationship')} />
            <Field label="Mobile no." value={form.emergency_contact_phone} onChangeText={set('emergency_contact_phone')} edited={isEdited('emergency_contact_phone')} keyboardType="phone-pad" />
            <Field label="Address" value={form.emergency_contact_address} onChangeText={set('emergency_contact_address')} edited={isEdited('emergency_contact_address')} />
          </>
        );
      case 'pay':
        return (
          <>
            <Field label="Salary" value={form.salary} onChangeText={set('salary')} edited={isEdited('salary')} keyboardType="numeric" />
            <Field label="Allowance" value={form.allowance} onChangeText={set('allowance')} edited={isEdited('allowance')} keyboardType="numeric" />
            <Field label="PAN No." value={form.pan_no} onChangeText={set('pan_no')} edited={isEdited('pan_no')} />
            <Field label="SSF No." value={form.ssf_no} onChangeText={set('ssf_no')} edited={isEdited('ssf_no')} />
          </>
        );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.slate50 }}>
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <DocumentRing have={haveDocs} total={DOCUMENT_TYPES.length} onOpen={() => setTab('docs')}>
            {employee.profile_photo_url && !photoFailed ? (
              <TouchableOpacity onPress={() => setPhotoOpen(true)} accessibilityRole="button" accessibilityLabel={`View photo of ${employee.name}`}>
                <Image source={{ uri: employee.profile_photo_url }} style={styles.avatar} onError={() => setPhotoFailed(true)} />
              </TouchableOpacity>
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
          </DocumentRing>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name}>{employee.name}</Text>
            <Text style={styles.subtitle}>
              {employee.designation ?? '—'}
              {employee.department ? ` · ${employee.department}` : ''}
            </Text>
            <Text style={styles.meta}>{[employee.employee_code, branchName].filter(Boolean).join('  ·  ')}</Text>
          </View>
        </View>
        <View style={[styles.headerBadges, { marginTop: 12, marginBottom: 0 }]}>
          <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
          {!!employee.employment_type && <Badge tone="neutral">{employmentTypeLabel(employee.employment_type)}</Badge>}
          {!!employee.blood_group && <Badge tone="critical">Blood group {employee.blood_group}</Badge>}
          {employee.attendance_exempt && <Badge tone="neutral">Excused</Badge>}
        </View>
        {!!employee.resigned_at && <Text style={[styles.meta, { marginTop: 8 }]}>Last working date: {formatAdDate(employee.resigned_at, system)}</Text>}
        {(!!employee.phone || !!employee.email) && (
          <View style={styles.actionRow}>
            {!!employee.phone && <ActionButton label="Call" onPress={() => Linking.openURL(`tel:${employee.phone}`)} />}
            {!!employee.email && <ActionButton label="Email" onPress={() => Linking.openURL(`mailto:${employee.email}`)} />}
          </View>
        )}
      </View>

      {contractNotice && (
        <View style={styles.strip} accessibilityRole="alert">
          <Text style={styles.stripText}>
            <Text style={styles.stripStrong}>{contractLabel(contractNotice.daysLeft)}</Text> · {formatAdDate(contractNotice.endKey, system)}
          </Text>
          <View style={styles.stripActions}>
            <TouchableOpacity
              style={styles.stripPrimary}
              accessibilityRole="button"
              accessibilityLabel="Renew contract"
              onPress={() => {
                setTab('overview');
                openSection('employment');
              }}
            >
              <Text style={styles.stripPrimaryText}>Renew</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stripSecondary} accessibilityRole="button" accessibilityLabel="Start exit" onPress={() => setTab('exit')}>
              <Text style={styles.stripSecondaryText}>Start exit</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.tabs}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.id}
            onPress={() => setTab(t.id)}
            accessibilityRole="button"
            accessibilityLabel={`Tab: ${t.label}`}
            accessibilityState={{ selected: tab === t.id }}
            style={[styles.tabPill, tab === t.id && styles.tabPillOn]}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={tab === 'overview' ? undefined : styles.hidden}>
      {saved && !editing && <Notice tone="ok">Saved.</Notice>}
      <View style={[styles.emergency, !hasEmergency && !employee.blood_group && { borderColor: colors.slate200 }]}>
        <View style={[styles.bloodTile, !employee.blood_group && styles.bloodTileEmpty]}>
          <Text style={[styles.bloodText, !employee.blood_group && { color: colors.slate500 }]}>{employee.blood_group || '—'}</Text>
          <Text style={[styles.bloodLabel, !employee.blood_group && { color: colors.slate500 }]}>Blood</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.emergencyHead}>
            <Text style={styles.emergencyKicker}>EMERGENCY CONTACT</Text>
            <LinkText label="Edit" accessibilityLabel="Edit Emergency contact" onPress={() => openSection('emergency')} />
          </View>
          {hasEmergency ? (
            <>
              {!!employee.emergency_contact_name && <Text style={styles.emergencyName}>{employee.emergency_contact_name}</Text>}
              <Text style={styles.emergencySub}>{[employee.emergency_contact_relationship, employee.emergency_contact_phone].filter(Boolean).join(' · ')}</Text>
            </>
          ) : (
            <Text style={styles.emergencySub}>None on file yet. Tap Edit to add one.</Text>
          )}
        </View>
        {!!employee.emergency_contact_phone && (
          <TouchableOpacity
            style={styles.callBtn}
            accessibilityRole="button"
            accessibilityLabel={`Call ${employee.emergency_contact_name || 'emergency contact'}`}
            onPress={() => Linking.openURL(`tel:${employee.emergency_contact_phone}`)}
          >
            <Text style={styles.callBtnText}>Call</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.factsCard}>
        <Text style={styles.factsTitle}>AT A GLANCE</Text>
        <View style={styles.factsGrid}>
          <QuickFact label="Joined" value={employee.date_of_joining ? formatAdDate(employee.date_of_joining, system) : null} />
          <QuickFact label={employee.resigned_at ? 'Time with the company' : 'With the company'} value={tenure !== null ? formatDuration(tenure) : null} />
          <QuickFact label="Reports to" value={savedManager?.name ?? null} />
          {isContract ? (
            <QuickFact label="Contract ends" value={employee.contract_end ? formatAdDate(employee.contract_end, system) : null} />
          ) : (
            <QuickFact label="Outlet / branch" value={branchName ?? null} />
          )}
          <QuickFact label="Phone" value={employee.phone} />
          <QuickFact label="Documents" value={haveDocs !== null ? `${haveDocs} of ${DOCUMENT_TYPES.length}` : null} />
        </View>
      </View>

      <CollapsibleCard
        title="Employment"
        right={sectionHeaderRight('employment')}
        summary={[info.employment_type ? employmentTypeLabel(info.employment_type) : '', info.designation, savedManager ? `Reports to ${savedManager.name}` : ''].filter(Boolean).join(' · ') || undefined}
        defaultOpen
      >
        <InfoRow label="Employee code" value={employee.employee_code} />
        <InfoRow label="Full name" value={employee.name} />
        <InfoRow label="Employment type" value={info.employment_type ? employmentTypeLabel(info.employment_type) : ''} />
        <InfoRow label="Employment status" value={EMPLOYMENT_STATUS_LABEL[status]} />
        {info.employment_type === 'contract' && (
          <>
            <InfoRow label="Contract start date" value={when(info.contract_start)} />
            <InfoRow label="Contract end date" value={when(info.contract_end)} />
          </>
        )}
        <InfoRow label="Reporting to" value={savedManager?.name} />
        <InfoRow label="Department" value={info.department} />
        <InfoRow label="Designation" value={info.designation} />
        <InfoRow label="Outlet / branch" value={branchName} />
        <InfoRow label="Biometric ID" value={info.fingerprint_id} />
        <InfoRow label="Date of joining" value={when(info.date_of_joining)} />
      </CollapsibleCard>

      <CollapsibleCard title="Personal" right={sectionHeaderRight('personal')}>
        <InfoRow label="Gender" value={capitalised(info.gender)} />
        <InfoRow label="Date of birth" value={when(info.date_of_birth)} />
        <InfoRow label="Nationality" value={info.nationality} />
        <InfoRow label="Marital status" value={MARITAL_STATUSES.find(m => m.value === info.marital_status)?.label ?? capitalised(info.marital_status)} />
        <InfoRow label="Blood group" value={info.blood_group} />
        <InfoRow label="Citizenship no." value={info.citizenship_no} />
        <InfoRow label="Citizenship issued district" value={info.citizenship_issued_district} />
        <InfoRow label="Citizenship issue date" value={when(info.citizenship_issue_date)} />
      </CollapsibleCard>

      <CollapsibleCard title="Contact & address" right={sectionHeaderRight('contact')}>
        <InfoRow label="Phone (personal)" value={info.phone} />
        <InfoRow label="Phone (official)" value={info.official_phone} />
        <InfoRow label="Email (official)" value={info.email} />
        <InfoRow label="Email (personal)" value={info.personal_email} />
        <InfoRow label="Permanent address" value={formatAddress(info, 'permanent')} />
        <InfoRow label="Temporary address" value={formatAddress(info, 'temporary')} />
        {!!info.address && <InfoRow label="Other address note" value={info.address} />}
      </CollapsibleCard>

      <CollapsibleCard title="Family" right={sectionHeaderRight('family')}>
        <InfoRow label="Father's name" value={info.father_name} />
        <InfoRow label="Mother's name" value={info.mother_name} />
        <InfoRow label="Grandfather's name" value={info.grandfather_name} />
        <InfoRow label="Spouse's name" value={info.spouse_name} />
      </CollapsibleCard>

      <CollapsibleCard title="Pay & statutory" right={sectionHeaderRight('pay')}>
        <InfoRow label="Salary" value={amount(info.salary)} />
        <InfoRow label="Allowance" value={amount(info.allowance)} />
        <InfoRow label="PAN No." value={info.pan_no} />
        <InfoRow label="SSF No." value={info.ssf_no} />
      </CollapsibleCard>

      </View>

      <View style={tab === 'records' ? undefined : styles.hidden}>
        <HistoryCard employeeId={employee.id} joinedOn={employee.date_of_joining} reloadKey={historyVersion} />
        <EducationCard employeeId={employee.id} />
        <TrainingCard employeeId={employee.id} />
        <ExperienceCard employee={employee} />
        <PerformanceCard employeeId={employee.id} managerName={manager?.name ?? null} />
        <ConductCard employeeId={employee.id} />
      </View>

      <View style={tab === 'docs' ? undefined : styles.hidden}>
        <DocumentsCard employeeId={employee.id} companyId={employee.company_id ?? null} defaultOpen />
      </View>

      <View style={tab === 'exit' ? undefined : styles.hidden}>
        <SeparationCard employee={employee} onEmployeeChanged={() => reload(false)} defaultOpen />
      </View>

      <Modal visible={photoOpen && !!employee.profile_photo_url} transparent animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.photoBackdrop} onPress={() => setPhotoOpen(false)} accessibilityLabel="Close photo">
          {!!employee.profile_photo_url && <Image source={{ uri: employee.profile_photo_url }} style={styles.photoLarge} resizeMode="contain" accessibilityLabel={`Photo of ${employee.name}`} />}
          <Text style={styles.photoName}>{employee.name}</Text>
          <View style={styles.photoClose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.photoCloseText}>Close</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <Sheet
        visible={editing !== null}
        title={editing ? `Edit ${SECTION_META[editing].title}` : ''}
        subtitle={editing ? SECTION_META[editing].hint : undefined}
        onClose={closeSection}
        onSubmit={handleSave}
        saving={saving}
        submitLabel="Save changes"
        submitDisabled={sectionEdited.length === 0}
        note={sectionNote}
        error={error ?? undefined}
      >
        {editing ? renderSectionFields(editing) : null}
      </Sheet>
    </ScrollView>
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function QuickFact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.factCell}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value || '—'}</Text>
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

function AddressFields({
  kind,
  form,
  set,
  isEdited,
}: {
  kind: 'permanent' | 'temporary';
  form: FormState;
  set: (key: FormKey) => (value: string) => void;
  isEdited: (key: FormKey) => boolean;
}) {
  const provinceKey = `${kind}_province` as FormKey;
  const province = form[provinceKey];
  const options: { label: string; value: string }[] = NEPAL_PROVINCES.map(p => ({ label: p, value: p }));
  if (province && !(NEPAL_PROVINCES as readonly string[]).includes(province)) options.unshift({ label: province, value: province });
  const district = `${kind}_district` as FormKey;
  const municipality = `${kind}_municipality` as FormKey;
  const ward = `${kind}_ward` as FormKey;
  const tole = `${kind}_tole` as FormKey;
  return (
    <>
      <Choice label="Province" options={options} value={province} onChange={v => set(provinceKey)(v ?? '')} allowNone edited={isEdited(provinceKey)} />
      <Field label="District" value={form[district]} onChangeText={set(district)} edited={isEdited(district)} />
      <Field label="Municipality" value={form[municipality]} onChangeText={set(municipality)} edited={isEdited(municipality)} />
      <Field label="Ward no." value={form[ward]} onChangeText={set(ward)} keyboardType="number-pad" edited={isEdited(ward)} />
      <Field label="Tole" value={form[tole]} onChangeText={set(tole)} edited={isEdited(tole)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  headerCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  hidden: { display: 'none' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emergencyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  photoLarge: { width: '100%', aspectRatio: 1, maxHeight: '70%', borderRadius: 16, backgroundColor: colors.white },
  photoName: { color: colors.white, fontSize: 16, fontWeight: '800', marginTop: 16 },
  photoClose: { marginTop: 18, minHeight: 44, paddingHorizontal: 24, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  photoCloseText: { color: colors.white, fontSize: 14, fontWeight: '800' },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { height: 64, width: 64, borderRadius: 32 },
  avatarFallback: { backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '800', color: colors.accent },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { fontSize: 13, fontWeight: '800', color: colors.accent },
  strip: { backgroundColor: colors.warningBg, borderRadius: 14, borderWidth: 1, borderColor: '#f0d49b', padding: 12, marginBottom: 12 },
  stripText: { fontSize: 13, color: colors.warningText, fontWeight: '600' },
  stripStrong: { fontWeight: '800' },
  stripActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  stripPrimary: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#8a4b06', alignItems: 'center', justifyContent: 'center' },
  stripPrimaryText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  stripSecondary: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#d9a85a', alignItems: 'center', justifyContent: 'center' },
  stripSecondaryText: { color: colors.warningText, fontSize: 13, fontWeight: '800' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  tabPill: { minHeight: 44, paddingHorizontal: 11, borderRadius: 22, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  tabPillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '800', color: colors.slate500 },
  tabTextOn: { color: colors.white },
  emergency: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: '#f5c2c0', padding: 12, marginBottom: 12 },
  bloodTile: { height: 64, width: 64, borderRadius: 16, backgroundColor: colors.criticalBg, alignItems: 'center', justifyContent: 'center' },
  bloodTileEmpty: { backgroundColor: colors.slate100 },
  bloodText: { fontSize: 24, fontWeight: '800', color: colors.criticalText, lineHeight: 26 },
  bloodLabel: { fontSize: 11, fontWeight: '800', color: colors.criticalText, marginTop: 2 },
  emergencyKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.criticalText },
  emergencyName: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 2 },
  emergencySub: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 2 },
  callBtn: { minWidth: 56, minHeight: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  callBtnText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  factsCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  factsTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.slate500 },
  factsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, rowGap: 12 },
  factCell: { width: '50%', paddingRight: 10 },
  factLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500 },
  factValue: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 },
  headerBadges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 },
  name: { fontSize: 18, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 2 },
  meta: { fontSize: 12, color: colors.slate400, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4 },
  hint: { fontSize: 11, color: colors.slate400, marginTop: 4 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pickerText: { fontSize: 14, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  chevron: { fontSize: 14, color: colors.slate400 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 8 },
  search: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink, marginTop: 10, marginBottom: 6 },
  personRow: { paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100, borderRadius: 8 },
  personRowActive: { backgroundColor: colors.accentLight },
  personText: { fontSize: 14, fontWeight: '600', color: colors.ink },
});
