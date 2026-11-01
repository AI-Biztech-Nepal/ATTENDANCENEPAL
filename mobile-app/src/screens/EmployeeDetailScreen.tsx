import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
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
  withKnownColumns,
} from '../lib/employeeProfile';
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

  const departmentOptions = departments.map(d => ({ label: d.name, value: d.name }));
  if (form.department && !departments.some(d => d.name === form.department)) departmentOptions.unshift({ label: form.department, value: form.department });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.headerCard}>
        <View style={styles.headerBadges}>
          <Text style={styles.name}>{employee.name}</Text>
        </View>
        <View style={styles.headerBadges}>
          <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
          {!!employee.employment_type && <Badge tone="neutral">{employmentTypeLabel(employee.employment_type)}</Badge>}
          {!!employee.blood_group && <Badge tone="critical">Blood group {employee.blood_group}</Badge>}
          {employee.attendance_exempt && <Badge tone="neutral">Excused</Badge>}
        </View>
        <Text style={styles.subtitle}>
          {employee.designation ?? '—'}
          {employee.department ? ` · ${employee.department}` : ''}
        </Text>
        <Text style={styles.meta}>{[employee.employee_code, branchName].filter(Boolean).join('  ·  ')}</Text>
        {!!employee.resigned_at && <Text style={styles.meta}>Last working date: {formatAdDate(employee.resigned_at, system)}</Text>}
      </View>

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

      <View style={{ height: 8 }} />
      <HistoryCard employeeId={employee.id} joinedOn={employee.date_of_joining} reloadKey={historyVersion} />
      <SeparationCard employee={employee} onEmployeeChanged={() => reload(false)} />
      <EducationCard employeeId={employee.id} />
      <TrainingCard employeeId={employee.id} />
      <ExperienceCard employee={employee} />
      <PerformanceCard employeeId={employee.id} managerName={manager?.name ?? null} />
      <ConductCard employeeId={employee.id} />
      <DocumentsCard employeeId={employee.id} companyId={employee.company_id ?? null} />

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
