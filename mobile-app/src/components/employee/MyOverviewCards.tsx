import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate } from '../../lib/calendar';
import { DOCUMENT_TYPES, type EmployeeDocument } from '../../lib/employeeDocuments';
import {
  ADDRESS_PARTS,
  BLOOD_GROUPS,
  EMPLOYMENT_STATUS_LABEL,
  MARITAL_STATUSES,
  NEPAL_PROVINCES,
  contractLabel,
  daysCovered,
  effectiveStatus,
  employmentTypeLabel,
  formatAddress,
  formatDuration,
} from '../../lib/employeeProfile';
import type { EmployeeSeparation } from '../../lib/employeeSeparation';
import { contractAlerts, startOfToday } from '../../lib/hrAlerts';
import type { Employee } from '../../types';
import { colors } from '../../theme';
import { Choice, CollapsibleCard, DateField, Field, InfoRow, LinkText, Sheet, SubHeading, confirmAsync } from '../hr/HrKit';

export type OverviewTab = 'records' | 'documents' | 'exit';

type SectionId = 'personal' | 'contact' | 'family' | 'emergency';
const ADDRESS_KEYS = (['permanent', 'temporary'] as const).flatMap(kind => ADDRESS_PARTS.map(p => `${kind}_${p}`));

/** Saved through update_my_profile(); everything else here goes through update_my_hr_profile(). */
const PROFILE_KEYS = new Set(['name', 'email', 'phone', 'address', 'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone']);

// One bottom sheet per card, the same sections the website's pop-ups use. `fields` is everything the
// sheet edits — and the only values a save sends.
const SECTIONS: Record<SectionId, { title: string; hint?: string; fields: string[] }> = {
  personal: {
    title: 'Personal',
    hint: 'Your name and the identity details used on your CV and for government records.',
    fields: ['name', 'gender', 'date_of_birth', 'nationality', 'marital_status', 'blood_group', 'citizenship_no', 'citizenship_issued_district', 'citizenship_issue_date'],
  },
  contact: { title: 'Contact & address', fields: ['phone', 'email', 'personal_email', ...ADDRESS_KEYS, 'address'] },
  family: { title: 'Family', fields: ['father_name', 'mother_name', 'grandfather_name', 'spouse_name'] },
  emergency: {
    title: 'Emergency contact',
    hint: 'Who to call first. Shown on your profile next to your blood group.',
    fields: ['emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone', 'emergency_contact_address'],
  },
};

const LABEL: Record<string, string> = {
  name: 'Full name',
  gender: 'Gender',
  date_of_birth: 'Date of birth',
  nationality: 'Nationality',
  marital_status: 'Marital status',
  blood_group: 'Blood group',
  citizenship_no: 'Citizenship no.',
  citizenship_issued_district: 'Citizenship issued district',
  citizenship_issue_date: 'Citizenship issue date',
  phone: 'Phone (personal)',
  email: 'Email (official)',
  personal_email: 'Email (personal)',
  address: 'Address note',
  father_name: "Father's name",
  mother_name: "Mother's name",
  grandfather_name: "Grandfather's name",
  spouse_name: "Spouse's name",
  emergency_contact_name: 'Emergency name',
  emergency_contact_relationship: 'Emergency relationship',
  emergency_contact_phone: 'Emergency mobile no.',
  emergency_contact_address: 'Emergency address',
  ...Object.fromEntries((['permanent', 'temporary'] as const).flatMap(kind => ADDRESS_PARTS.map(p => [`${kind}_${p}`, `${kind === 'permanent' ? 'Permanent' : 'Temporary'} ${p}`] as const))),
};

const capitalised = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

/** The Overview tab of the employee's own profile: blood group + emergency contact, the facts at a
 * glance, what needs attention, and the cards. Employment and pay are set by HR (a lock note, no Edit);
 * personal, contact & address, family and the emergency contact are the employee's own, each edited in
 * its own sheet. */
export default function MyOverviewCards({
  employee,
  branchName,
  managerName,
  docs,
  openConduct,
  sep,
  onOpenTab,
  onSaveProfile,
  onSaved,
}: {
  employee: Employee;
  branchName: string | null;
  managerName: string | null;
  /** undefined while loading, null when it couldn't be read. */
  docs: EmployeeDocument[] | null | undefined;
  openConduct: number | null;
  sep: EmployeeSeparation | null | undefined;
  onOpenTab: (tab: OverviewTab) => void;
  /** Saves fields through update_my_profile(); resolves to an error message, or null when it worked. */
  onSaveProfile: (values: Record<string, string>) => Promise<string | null>;
  onSaved: () => void;
}) {
  const { system } = useCalendarSystem();
  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : null);
  const status = effectiveStatus(employee);
  const isContract = employee.employment_type === 'contract';
  const days = employee.date_of_joining ? daysCovered([{ start: employee.date_of_joining, end: employee.resigned_at }]) : null;

  const [editing, setEditing] = useState<SectionId | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const savedValue = (key: string) => {
    const v = (employee as unknown as Record<string, unknown>)[key];
    return v == null ? '' : String(v);
  };
  const isEdited = (key: string) => (form[key] ?? '') !== savedValue(key);
  const editedKeys = editing ? SECTIONS[editing].fields.filter(isEdited) : [];
  const set = (key: string) => (value: string) => setForm(f => ({ ...f, [key]: value }));

  function open(id: SectionId) {
    const next: Record<string, string> = {};
    for (const key of SECTIONS[id].fields) next[key] = savedValue(key);
    setForm(next);
    setError('');
    setEditing(id);
  }

  async function close() {
    if (saving) return;
    if (editedKeys.length > 0 && !(await confirmAsync('Discard changes?', `Throw away ${editedKeys.length} unsaved change${editedKeys.length === 1 ? '' : 's'}?`, 'Discard', true))) return;
    setEditing(null);
  }

  function copyPermanentToTemporary() {
    setForm(f => ({ ...f, ...Object.fromEntries(ADDRESS_PARTS.map(p => [`temporary_${p}`, f[`permanent_${p}`] ?? ''])) }));
  }

  async function save() {
    if (!editing || editedKeys.length === 0) return;
    if (editedKeys.includes('name') && !(form.name ?? '').trim()) return setError("Your name can't be empty.");
    setSaving(true);
    setError('');
    const profileValues: Record<string, string> = {};
    const hrValues: Record<string, string> = {};
    for (const key of editedKeys) (PROFILE_KEYS.has(key) ? profileValues : hrValues)[key] = form[key] ?? '';

    let profileSaved = false;
    if (Object.keys(profileValues).length > 0) {
      const message = await onSaveProfile(profileValues);
      if (message) {
        setSaving(false);
        return setError(`Could not save: ${message}`);
      }
      profileSaved = true;
    }
    if (Object.keys(hrValues).length > 0) {
      const { error: rpcError } = await supabase.rpc('update_my_hr_profile', { p_values: hrValues });
      if (rpcError) {
        setSaving(false);
        // What did save is on the page now, so the sheet marks only what is still unsaved.
        if (profileSaved) onSaved();
        return setError(`Could not save: ${rpcError.message}${profileSaved ? ' (your other changes were saved)' : ''}`);
      }
    }
    setSaving(false);
    setEditing(null);
    onSaved();
  }

  // ---- what needs attention
  const haveDocs = docs ? DOCUMENT_TYPES.filter(t => docs.some(d => d.doc_type === t.value)).length : null;
  const missingDocs = docs ? DOCUMENT_TYPES.filter(t => !docs.some(d => d.doc_type === t.value)).map(t => t.label) : null;
  const contractNotice =
    employee.status === 'active' && isContract
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
  const exitOpen = !!sep && sep.settlement_status !== 'completed';
  const attention: { key: string; title: string; detail?: string; open?: OverviewTab }[] = [];
  if (contractNotice) attention.push({ key: 'contract', title: contractLabel(contractNotice.daysLeft), detail: formatAdDate(contractNotice.endKey, system) });
  if (missingDocs && missingDocs.length > 0) {
    attention.push({
      key: 'docs',
      title: `${missingDocs.length} document${missingDocs.length === 1 ? '' : 's'} missing`,
      detail: missingDocs.slice(0, 3).join(', ') + (missingDocs.length > 3 ? ` and ${missingDocs.length - 3} more` : ''),
      open: 'documents',
    });
  }
  if (openConduct) attention.push({ key: 'conduct', title: `${openConduct} conduct record${openConduct === 1 ? '' : 's'} still open`, open: 'records' });
  if (exitOpen && sep) attention.push({ key: 'exit', title: `Exit in progress — settlement ${sep.settlement_status}`, open: 'exit' });

  const hasEmergency = !!(employee.emergency_contact_name || employee.emergency_contact_phone);
  const lock = <Text style={styles.lock}>Set by HR/Admin — not editable here.</Text>;
  const edit = (id: SectionId) => <LinkText label="Edit" accessibilityLabel={`Edit ${SECTIONS[id].title}`} onPress={() => open(id)} />;

  return (
    <>
      <View style={styles.emergency}>
        <View style={[styles.bloodTile, !employee.blood_group && styles.bloodTileEmpty]}>
          <Text style={[styles.bloodText, !employee.blood_group && { color: colors.slate500 }]}>{employee.blood_group || '—'}</Text>
          <Text style={[styles.bloodLabel, !employee.blood_group && { color: colors.slate500 }]}>Blood</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.emergencyHead}>
            <Text style={styles.emergencyKicker}>EMERGENCY CONTACT</Text>
            {edit('emergency')}
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

      {attention.length > 0 && (
        <View style={styles.attention}>
          <Text style={styles.attentionTitle}>NEEDS ATTENTION</Text>
          {attention.map(item => (
            <View key={item.key} style={styles.attentionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.attentionText}>{item.title}</Text>
                {!!item.detail && <Text style={styles.attentionDetail}>{item.detail}</Text>}
              </View>
              {item.open && <LinkText label="Open" accessibilityLabel={`Open ${item.title}`} onPress={() => onOpenTab(item.open!)} />}
            </View>
          ))}
        </View>
      )}

      <View style={styles.factsCard}>
        <Text style={styles.factsTitle}>AT A GLANCE</Text>
        <View style={styles.factsGrid}>
          <QuickFact label="Joined" value={date(employee.date_of_joining)} />
          <QuickFact label={employee.resigned_at ? 'Time with the company' : 'With the company'} value={days !== null ? formatDuration(days) : null} />
          <QuickFact label="Reports to" value={managerName} />
          {isContract ? <QuickFact label="Contract ends" value={date(employee.contract_end)} /> : <QuickFact label="Outlet / branch" value={branchName} />}
          <QuickFact label="Phone" value={employee.phone} />
          <QuickFact label="Documents" value={haveDocs !== null ? `${haveDocs} of ${DOCUMENT_TYPES.length}` : null} />
        </View>
      </View>

      <CollapsibleCard
        title="Employment"
        summary={[employee.employment_type ? employmentTypeLabel(employee.employment_type) : '', employee.designation, managerName ? `Reports to ${managerName}` : ''].filter(Boolean).join(' · ') || undefined}
        defaultOpen
      >
        <InfoRow label="Employee code" value={employee.employee_code} />
        <InfoRow label="Username" value={employee.username} />
        <InfoRow label="Biometric / Registration ID" value={employee.fingerprint_id} />
        <InfoRow label="Employment type" value={employee.employment_type ? employmentTypeLabel(employee.employment_type) : null} />
        <InfoRow label="Status" value={EMPLOYMENT_STATUS_LABEL[status]} />
        <InfoRow label="Reporting to" value={managerName} />
        <InfoRow label="Outlet / branch" value={branchName} />
        <InfoRow label="Department" value={employee.department} />
        <InfoRow label="Designation" value={employee.designation} />
        <InfoRow label="Date of joining" value={date(employee.date_of_joining)} />
        <InfoRow label={employee.resigned_at ? 'Days worked' : 'Days with company'} value={days !== null ? `${days} days` : null} />
        {!!employee.resigned_at && <InfoRow label="Last working date" value={date(employee.resigned_at)} />}
        {isContract && (
          <>
            <InfoRow label="Contract start" value={date(employee.contract_start)} />
            <InfoRow label="Contract end" value={date(employee.contract_end)} />
          </>
        )}
        {lock}
      </CollapsibleCard>

      <CollapsibleCard title="Personal" right={edit('personal')}>
        <InfoRow label="Gender" value={capitalised(employee.gender)} />
        <InfoRow label="Date of birth" value={date(employee.date_of_birth)} />
        <InfoRow label="Nationality" value={employee.nationality} />
        <InfoRow label="Marital status" value={MARITAL_STATUSES.find(m => m.value === employee.marital_status)?.label ?? capitalised(employee.marital_status)} />
        <InfoRow label="Blood group" value={employee.blood_group} />
        <InfoRow label="Citizenship no." value={employee.citizenship_no} />
        <InfoRow label="Citizenship issued district" value={employee.citizenship_issued_district} />
        <InfoRow label="Citizenship issue date" value={date(employee.citizenship_issue_date)} />
      </CollapsibleCard>

      <CollapsibleCard title="Contact & address" right={edit('contact')}>
        <InfoRow label="Phone (personal)" value={employee.phone} />
        <InfoRow label="Phone (official)" value={employee.official_phone} />
        <InfoRow label="Email (official)" value={employee.email} />
        <InfoRow label="Email (personal)" value={employee.personal_email} />
        <InfoRow label="Permanent address" value={formatAddress(employee as unknown as Record<string, unknown>, 'permanent')} />
        <InfoRow label="Temporary address" value={formatAddress(employee as unknown as Record<string, unknown>, 'temporary')} />
        {!!employee.address && <InfoRow label="Other address note" value={employee.address} />}
      </CollapsibleCard>

      <CollapsibleCard title="Family" right={edit('family')}>
        <InfoRow label="Father's name" value={employee.father_name} />
        <InfoRow label="Mother's name" value={employee.mother_name} />
        <InfoRow label="Grandfather's name" value={employee.grandfather_name} />
        <InfoRow label="Spouse's name" value={employee.spouse_name} />
      </CollapsibleCard>

      <CollapsibleCard title="Payroll & statutory">
        <InfoRow label="Basic salary" value={employee.salary != null ? employee.salary.toLocaleString() : null} />
        <InfoRow label="Allowance" value={employee.allowance != null ? employee.allowance.toLocaleString() : null} />
        <InfoRow label="PAN No." value={employee.pan_no} />
        <InfoRow label="SSF No." value={employee.ssf_no} />
        {lock}
      </CollapsibleCard>

      <Sheet
        visible={editing !== null}
        title={editing ? `Edit ${SECTIONS[editing].title}` : ''}
        subtitle={editing ? SECTIONS[editing].hint : undefined}
        onClose={close}
        onSubmit={save}
        saving={saving}
        submitLabel="Save changes"
        submitDisabled={editedKeys.length === 0}
        note={editedKeys.length ? `${editedKeys.length} unsaved change${editedKeys.length === 1 ? '' : 's'} · ${editedKeys.map(k => LABEL[k] ?? k).join(', ')}` : 'No changes yet'}
        error={error || undefined}
      >
        {editing === 'personal' && (
          <>
            <Field label="Full name" value={form.name ?? ''} onChangeText={set('name')} edited={isEdited('name')} />
            <Choice label="Gender" options={[{ label: 'Female', value: 'female' }, { label: 'Male', value: 'male' }]} value={form.gender} onChange={v => set('gender')(v ?? '')} edited={isEdited('gender')} allowNone />
            <DateField label="Date of birth" value={form.date_of_birth ?? ''} onChange={set('date_of_birth')} edited={isEdited('date_of_birth')} />
            <Field label="Nationality" value={form.nationality ?? ''} onChangeText={set('nationality')} edited={isEdited('nationality')} placeholder="Nepali" />
            <Choice label="Marital status" options={MARITAL_STATUSES.map(m => ({ label: m.label, value: m.value }))} value={form.marital_status} onChange={v => set('marital_status')(v ?? '')} edited={isEdited('marital_status')} allowNone />
            <Choice label="Blood group" options={BLOOD_GROUPS.map(b => ({ label: b, value: b }))} value={form.blood_group} onChange={v => set('blood_group')(v ?? '')} edited={isEdited('blood_group')} tone="danger" allowNone />
            <Field label="Citizenship no." value={form.citizenship_no ?? ''} onChangeText={set('citizenship_no')} edited={isEdited('citizenship_no')} />
            <Field label="Citizenship issued district" value={form.citizenship_issued_district ?? ''} onChangeText={set('citizenship_issued_district')} edited={isEdited('citizenship_issued_district')} />
            <DateField label="Citizenship issue date" value={form.citizenship_issue_date ?? ''} onChange={set('citizenship_issue_date')} edited={isEdited('citizenship_issue_date')} />
          </>
        )}

        {editing === 'contact' && (
          <>
            <Field label="Phone (personal)" value={form.phone ?? ''} onChangeText={set('phone')} edited={isEdited('phone')} keyboardType="phone-pad" hint="Your official phone is set by HR." />
            <Field label="Email (official)" value={form.email ?? ''} onChangeText={set('email')} edited={isEdited('email')} keyboardType="email-address" />
            <Field label="Email (personal)" value={form.personal_email ?? ''} onChangeText={set('personal_email')} edited={isEdited('personal_email')} keyboardType="email-address" />
            <SubHeading title="Permanent address" />
            <AddressFields kind="permanent" form={form} set={set} isEdited={isEdited} />
            <SubHeading title="Temporary address" action={<LinkText label="Same as permanent" onPress={copyPermanentToTemporary} />} />
            <AddressFields kind="temporary" form={form} set={set} isEdited={isEdited} />
            <SubHeading title="Other address note" />
            <Field label="Note" value={form.address ?? ''} onChangeText={set('address')} edited={isEdited('address')} multiline placeholder="Anything that doesn't fit above (landmark, current rented room…)" />
          </>
        )}

        {editing === 'family' && (
          <>
            <Field label="Father's name" value={form.father_name ?? ''} onChangeText={set('father_name')} edited={isEdited('father_name')} />
            <Field label="Mother's name" value={form.mother_name ?? ''} onChangeText={set('mother_name')} edited={isEdited('mother_name')} />
            <Field label="Grandfather's name" value={form.grandfather_name ?? ''} onChangeText={set('grandfather_name')} edited={isEdited('grandfather_name')} />
            <Field label="Spouse's name" value={form.spouse_name ?? ''} onChangeText={set('spouse_name')} edited={isEdited('spouse_name')} />
          </>
        )}

        {editing === 'emergency' && (
          <>
            <Field label="Name" value={form.emergency_contact_name ?? ''} onChangeText={set('emergency_contact_name')} edited={isEdited('emergency_contact_name')} />
            <Field label="Relationship" value={form.emergency_contact_relationship ?? ''} onChangeText={set('emergency_contact_relationship')} edited={isEdited('emergency_contact_relationship')} />
            <Field label="Mobile no." value={form.emergency_contact_phone ?? ''} onChangeText={set('emergency_contact_phone')} edited={isEdited('emergency_contact_phone')} keyboardType="phone-pad" />
            <Field label="Address" value={form.emergency_contact_address ?? ''} onChangeText={set('emergency_contact_address')} edited={isEdited('emergency_contact_address')} />
          </>
        )}
      </Sheet>
    </>
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

function AddressFields({
  kind,
  form,
  set,
  isEdited,
}: {
  kind: 'permanent' | 'temporary';
  form: Record<string, string>;
  set: (key: string) => (value: string) => void;
  isEdited: (key: string) => boolean;
}) {
  const key = (part: string) => `${kind}_${part}`;
  const province = form[key('province')] ?? '';
  const options: { label: string; value: string }[] = NEPAL_PROVINCES.map(p => ({ label: p, value: p }));
  if (province && !(NEPAL_PROVINCES as readonly string[]).includes(province)) options.unshift({ label: province, value: province });
  return (
    <>
      <Choice label="Province" options={options} value={province} onChange={v => set(key('province'))(v ?? '')} allowNone edited={isEdited(key('province'))} />
      <Field label="District" value={form[key('district')] ?? ''} onChangeText={set(key('district'))} edited={isEdited(key('district'))} />
      <Field label="Municipality" value={form[key('municipality')] ?? ''} onChangeText={set(key('municipality'))} edited={isEdited(key('municipality'))} />
      <Field label="Ward no." value={form[key('ward')] ?? ''} onChangeText={set(key('ward'))} keyboardType="number-pad" edited={isEdited(key('ward'))} />
      <Field label="Tole" value={form[key('tole')] ?? ''} onChangeText={set(key('tole'))} edited={isEdited(key('tole'))} />
    </>
  );
}

const styles = StyleSheet.create({
  lock: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 12 },
  emergency: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: '#f5c2c0', padding: 12, marginBottom: 12 },
  emergencyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bloodTile: { height: 64, width: 64, borderRadius: 16, backgroundColor: colors.criticalBg, alignItems: 'center', justifyContent: 'center' },
  bloodTileEmpty: { backgroundColor: colors.slate100 },
  bloodText: { fontSize: 24, fontWeight: '800', color: colors.criticalText, lineHeight: 26 },
  bloodLabel: { fontSize: 11, fontWeight: '800', color: colors.criticalText, marginTop: 2 },
  emergencyKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.criticalText },
  emergencyName: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 2 },
  emergencySub: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 2 },
  callBtn: { minWidth: 56, minHeight: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  callBtnText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  attention: { backgroundColor: colors.warningBg, borderRadius: 14, borderWidth: 1, borderColor: '#f0d49b', padding: 12, marginBottom: 12 },
  attentionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.warningText },
  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  attentionText: { fontSize: 13, fontWeight: '700', color: colors.warningText },
  attentionDetail: { fontSize: 12, color: colors.warningText, marginTop: 1 },
  factsCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  factsTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.slate500 },
  factsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, rowGap: 12 },
  factCell: { width: '50%', paddingRight: 10 },
  factLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500 },
  factValue: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 },
});
