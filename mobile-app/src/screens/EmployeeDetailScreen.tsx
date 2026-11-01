import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  effectiveStatus,
  employmentTypeLabel,
  formatDuration,
  withKnownColumns,
} from '../lib/employeeProfile';
import { DOCUMENT_TYPES } from '../lib/employeeDocuments';
import { contractAlerts, startOfToday } from '../lib/hrAlerts';
import type { Branch, Department, Employee } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { Button, Choice, CollapsibleCard, DateField, Field, InfoRow, LinkText, Notice, Sheet, SubHeading } from '../components/hr/HrKit';
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

/** "Contract ends in 10 days" / "Contract ended 3 days ago". */
function contractLabel(daysLeft: number) {
  if (daysLeft < 0) return `Contract ended ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`;
  if (daysLeft === 0) return 'Contract ends today';
  if (daysLeft === 1) return 'Contract ends tomorrow';
  return `Contract ends in ${daysLeft} days`;
}

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
  const scrollRef = useRef<ScrollView>(null);
  const yRef = useRef({ overview: 0, employment: 0 });

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

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

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
    if (!employee) return;
    setError(null);
    setSaved(false);
    if (!form.name.trim()) return setError('The name can’t be empty.');
    const isContract = form.employment_type === 'contract';
    if (isContract && form.contract_start && form.contract_end && form.contract_end < form.contract_start) {
      return setError('The contract end date is before the contract start date.');
    }
    for (const key of ['salary', 'allowance'] as const) {
      if (form[key].trim() && (Number.isNaN(Number(form[key])) || Number(form[key]) < 0)) {
        return setError(`${key === 'salary' ? 'Salary' : 'Allowance'} must be a number, zero or more.`);
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

    setSaving(true);
    const { error: updateError } = await supabase.from('employees').update(payload).eq('id', employeeId);
    setSaving(false);
    if (updateError) return setError(`Could not save: ${updateError.message}`);
    setSaved(true);
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

  const departmentOptions = departments.map(d => ({ label: d.name, value: d.name }));
  if (form.department && !departments.some(d => d.name === form.department)) departmentOptions.unshift({ label: form.department, value: form.department });

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          {employee.profile_photo_url && !photoFailed ? (
            <TouchableOpacity onPress={() => setPhotoOpen(true)} accessibilityRole="button" accessibilityLabel={`View photo of ${employee.name}`}>
              <Image source={{ uri: employee.profile_photo_url }} style={styles.avatar} onError={() => setPhotoFailed(true)} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
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
                // The other tabs are hidden, so the Overview has no height until it is shown again — scroll after it has been.
                setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, yRef.current.overview + yRef.current.employment - 8), animated: true }), 120);
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

      <View style={tab === 'overview' ? undefined : styles.hidden} onLayout={e => { yRef.current.overview = e.nativeEvent.layout.y; }}>
      <View style={[styles.emergency, !hasEmergency && !employee.blood_group && { borderColor: colors.slate200 }]}>
        <View style={[styles.bloodTile, !employee.blood_group && styles.bloodTileEmpty]}>
          <Text style={[styles.bloodText, !employee.blood_group && { color: colors.slate500 }]}>{employee.blood_group || '—'}</Text>
          <Text style={[styles.bloodLabel, !employee.blood_group && { color: colors.slate500 }]}>Blood</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.emergencyKicker}>EMERGENCY CONTACT</Text>
          {hasEmergency ? (
            <>
              {!!employee.emergency_contact_name && <Text style={styles.emergencyName}>{employee.emergency_contact_name}</Text>}
              <Text style={styles.emergencySub}>{[employee.emergency_contact_relationship, employee.emergency_contact_phone].filter(Boolean).join(' · ')}</Text>
            </>
          ) : (
            <Text style={styles.emergencySub}>None on file yet. Add one under Family &amp; emergency contact.</Text>
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

      <View onLayout={e => { yRef.current.employment = e.nativeEvent.layout.y; }}>
      <CollapsibleCard title="Employment" summary={[employmentTypeLabel(form.employment_type), form.designation, manager ? `Reports to ${manager.name}` : ''].filter(Boolean).join(' · ') || undefined} defaultOpen>
        <Field label="Full name" value={form.name} onChangeText={set('name')} />
        <Choice
          label="Employment type"
          options={EMPLOYMENT_TYPES.map(t => ({ label: t.label, value: t.value }))}
          value={form.employment_type}
          onChange={v => set('employment_type')(v ?? '')}
          allowNone
        />
        {stillWorking ? (
          <Choice
            label="Employment status"
            options={WORKING_STATUSES.map(s => ({ label: EMPLOYMENT_STATUS_LABEL[s], value: s }))}
            value={form.employment_status}
            onChange={v => v && set('employment_status')(v)}
          />
        ) : (
          <InfoRow label="Employment status" value={EMPLOYMENT_STATUS_LABEL[status]} />
        )}
        {!stillWorking && <Text style={styles.hint}>Restore the employee from the directory to change this.</Text>}
        {form.employment_type === 'contract' && (
          <>
            <DateField label="Contract start date" value={form.contract_start} onChange={set('contract_start')} />
            <DateField label="Contract end date" value={form.contract_end} onChange={set('contract_end')} />
          </>
        )}
        <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>Reporting to</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={() => { setManagerSearch(''); setPickingManager(true); }} accessibilityRole="button" accessibilityLabel="Reporting to">
            <Text style={[styles.pickerText, !manager && { color: colors.slate400, fontWeight: '400' }]}>{manager ? `${manager.name} (${manager.employee_code})` : 'No one'}</Text>
            <Text style={styles.chevron}>▾</Text>
          </TouchableOpacity>
        </View>
        <Choice label="Department" options={departmentOptions} value={form.department} onChange={v => set('department')(v ?? '')} allowNone noneLabel="Unassigned" />
        <Field label="Designation" value={form.designation} onChangeText={set('designation')} />
        <Choice label="Outlet / branch" options={branches.map(b => ({ label: b.name, value: b.id }))} value={form.branch_id} onChange={v => set('branch_id')(v ?? '')} allowNone noneLabel="Unassigned" />
        <Field label="Fingerprint / Biometric ID" value={form.fingerprint_id} onChangeText={set('fingerprint_id')} />
        <DateField label="Date of joining" value={form.date_of_joining} onChange={set('date_of_joining')} />
      </CollapsibleCard>
      </View>

      <CollapsibleCard title="Personal">
        <Choice label="Gender" options={[{ label: 'Female', value: 'female' }, { label: 'Male', value: 'male' }]} value={form.gender} onChange={v => set('gender')(v ?? '')} allowNone />
        <DateField label="Date of birth" value={form.date_of_birth} onChange={set('date_of_birth')} />
        <Field label="Nationality" value={form.nationality} onChangeText={set('nationality')} placeholder="Nepali" />
        <Choice label="Marital status" options={MARITAL_STATUSES.map(m => ({ label: m.label, value: m.value }))} value={form.marital_status} onChange={v => set('marital_status')(v ?? '')} allowNone />
        <Choice label="Blood group" options={BLOOD_GROUPS.map(b => ({ label: b, value: b }))} value={form.blood_group} onChange={v => set('blood_group')(v ?? '')} allowNone />
        <Field label="Citizenship no." value={form.citizenship_no} onChangeText={set('citizenship_no')} />
        <Field label="Citizenship issued district" value={form.citizenship_issued_district} onChangeText={set('citizenship_issued_district')} />
        <DateField label="Citizenship issue date" value={form.citizenship_issue_date} onChange={set('citizenship_issue_date')} />
      </CollapsibleCard>

      <CollapsibleCard title="Contact">
        <Field label="Phone (personal)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Phone (official)" value={form.official_phone} onChangeText={set('official_phone')} keyboardType="phone-pad" />
        <Field label="Email (official)" value={form.email} onChangeText={set('email')} keyboardType="email-address" hint="Also the email this person's login is linked to." />
        <Field label="Email (personal)" value={form.personal_email} onChangeText={set('personal_email')} keyboardType="email-address" />
      </CollapsibleCard>

      <CollapsibleCard title="Address">
        <SubHeading title="Permanent address" />
        <AddressFields kind="permanent" form={form} set={set} />
        <SubHeading title="Temporary address" action={<LinkText label="Same as permanent" onPress={copyPermanentToTemporary} />} />
        <AddressFields kind="temporary" form={form} set={set} />
        <SubHeading title="Other address note" />
        <Field label="Note" value={form.address} onChangeText={set('address')} multiline placeholder="Anything that doesn't fit above (landmark, current rented room…)" />
      </CollapsibleCard>

      <CollapsibleCard title="Family & emergency contact">
        <Field label="Father's name" value={form.father_name} onChangeText={set('father_name')} />
        <Field label="Mother's name" value={form.mother_name} onChangeText={set('mother_name')} />
        <Field label="Grandfather's name" value={form.grandfather_name} onChangeText={set('grandfather_name')} />
        <Field label="Spouse's name" value={form.spouse_name} onChangeText={set('spouse_name')} />
        <SubHeading title="Emergency contact" />
        <Field label="Name" value={form.emergency_contact_name} onChangeText={set('emergency_contact_name')} />
        <Field label="Relationship" value={form.emergency_contact_relationship} onChangeText={set('emergency_contact_relationship')} />
        <Field label="Mobile no." value={form.emergency_contact_phone} onChangeText={set('emergency_contact_phone')} keyboardType="phone-pad" />
        <Field label="Address" value={form.emergency_contact_address} onChangeText={set('emergency_contact_address')} />
      </CollapsibleCard>

      <CollapsibleCard title="Pay & statutory">
        <Field label="Salary" value={form.salary} onChangeText={set('salary')} keyboardType="numeric" />
        <Field label="Allowance" value={form.allowance} onChangeText={set('allowance')} keyboardType="numeric" />
        <Field label="PAN No." value={form.pan_no} onChangeText={set('pan_no')} />
        <Field label="SSF No." value={form.ssf_no} onChangeText={set('ssf_no')} />
      </CollapsibleCard>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && !dirty && <Notice tone="ok">Saved.</Notice>}
      <View style={styles.saveRow}>
        <Button label={saving ? 'Saving…' : 'Save changes'} onPress={handleSave} disabled={saving || !dirty} />
        {dirty && <Button label="Discard changes" tone="ghost" onPress={() => { setForm(baseline); setError(null); }} disabled={saving} />}
      </View>

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
    </ScrollView>
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

function AddressFields({ kind, form, set }: { kind: 'permanent' | 'temporary'; form: FormState; set: (key: FormKey) => (value: string) => void }) {
  const provinceKey = `${kind}_province` as FormKey;
  const province = form[provinceKey];
  const options: { label: string; value: string }[] = NEPAL_PROVINCES.map(p => ({ label: p, value: p }));
  if (province && !(NEPAL_PROVINCES as readonly string[]).includes(province)) options.unshift({ label: province, value: province });
  return (
    <>
      <Choice label="Province" options={options} value={province} onChange={v => set(provinceKey)(v ?? '')} allowNone />
      <Field label="District" value={form[`${kind}_district` as FormKey]} onChangeText={set(`${kind}_district` as FormKey)} />
      <Field label="Municipality" value={form[`${kind}_municipality` as FormKey]} onChangeText={set(`${kind}_municipality` as FormKey)} />
      <Field label="Ward no." value={form[`${kind}_ward` as FormKey]} onChangeText={set(`${kind}_ward` as FormKey)} keyboardType="number-pad" />
      <Field label="Tole" value={form[`${kind}_tole` as FormKey]} onChangeText={set(`${kind}_tole` as FormKey)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  headerCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  hidden: { display: 'none' },
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
