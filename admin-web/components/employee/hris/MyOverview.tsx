'use client';

import { useState } from 'react';
import Badge from '@/components/Badge';
import { useConfirm } from '@/components/ConfirmDialog';
import SectionDialog from '@/components/profile/SectionDialog';
import {
  AttentionCard,
  DocumentProgress,
  EmergencyCard,
  Fact,
  FactGrid,
  ProfileCard,
  ReportingLine,
  type AttentionItem,
} from '@/components/profile/ProfileParts';
import { supabase } from '@/lib/supabase';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { DOCUMENT_TYPES, type EmployeeDocument } from '@/lib/employeeDocuments';
import {
  BLOOD_GROUPS,
  EMPLOYMENT_STATUS_LABEL,
  MARITAL_STATUSES,
  STATUS_TONE,
  contractLabel,
  daysCovered,
  effectiveStatus,
  employmentTypeLabel,
  formatAddress,
} from '@/lib/employeeProfile';
import type { EmployeeSeparation } from '@/lib/employeeSeparation';
import { contractAlerts, startOfToday } from '@/lib/hrAlerts';
import type { Employee } from '@/lib/types';
import { AddressFields, AreaField, DateField, FieldGrid, GroupHeading, SegmentField, TextField } from './fields';

const capitalize = (v: string | null | undefined) => (v ? <span className="capitalize">{v}</span> : null);

type SectionId = 'personal' | 'contact' | 'family' | 'emergency';
const PARTS = ['province', 'district', 'municipality', 'ward', 'tole'] as const;
const ADDRESS_KEYS = (['permanent', 'temporary'] as const).flatMap(kind => PARTS.map(p => `${kind}_${p}`));

/** Saved through update_my_profile(); everything else on this page goes through update_my_hr_profile(). */
const PROFILE_KEYS = new Set(['name', 'email', 'phone', 'address', 'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone']);

// The pop-ups, one per card — the same cards the admin edits. Each lists the fields it covers, so a
// save sends only what changed in it.
const SECTIONS: Record<SectionId, { title: string; hint?: string; tone?: 'danger'; fields: string[] }> = {
  personal: {
    title: 'personal',
    hint: 'Your name and the identity details used on your CV and for government records.',
    fields: ['name', 'gender', 'date_of_birth', 'nationality', 'marital_status', 'blood_group', 'citizenship_no', 'citizenship_issued_district', 'citizenship_issue_date'],
  },
  contact: { title: 'contact & address', fields: ['phone', 'email', 'personal_email', ...ADDRESS_KEYS, 'address'] },
  family: { title: 'family', fields: ['father_name', 'mother_name', 'grandfather_name', 'spouse_name'] },
  emergency: {
    title: 'emergency contact',
    hint: 'Who to call first. Shown on your profile next to your blood group.',
    tone: 'danger',
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
  ...Object.fromEntries(
    (['permanent', 'temporary'] as const).flatMap(kind => PARTS.map(p => [`${kind}_${p}`, `${kind === 'permanent' ? 'Permanent' : 'Temporary'} ${p}`] as const))
  ),
};

function addressesMatch(f: Record<string, string>) {
  return PARTS.some(p => f[`permanent_${p}`]) && PARTS.every(p => f[`permanent_${p}`] === f[`temporary_${p}`]);
}

/** The Overview tab: the same cards, in the same places, as the admin's employee page. Employment and
 * pay are set by HR (a lock note, no Edit); personal, contact & address, family and the emergency
 * contact are the employee's own, each edited in its own pop-up. */
export default function MyOverview({
  employee,
  companyName,
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
  /** '' until it loads. */
  companyName: string;
  branchName: string | null;
  managerName: string | null;
  /** undefined while loading, null when it couldn't be read. */
  docs: EmployeeDocument[] | null | undefined;
  openConduct: number | null;
  sep: EmployeeSeparation | null | undefined;
  onOpenTab: (tab: 'records' | 'documents' | 'exit') => void;
  /** Saves fields through update_my_profile(); resolves to an error message, or null when it worked. */
  onSaveProfile: (values: Record<string, string>) => Promise<string | null>;
  onSaved: () => void;
}) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : null);
  const status = effectiveStatus(employee);
  const isContract = employee.employment_type === 'contract';
  const days = employee.date_of_joining ? daysCovered([{ start: employee.date_of_joining, end: employee.resigned_at }]) : null;

  const [editing, setEditing] = useState<SectionId | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [sameAddress, setSameAddress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const savedValue = (key: string) => {
    const v = (employee as unknown as Record<string, unknown>)[key];
    return v == null ? '' : String(v);
  };
  const isEdited = (key: string) => (form[key] ?? '') !== savedValue(key);
  const editedKeys = editing ? SECTIONS[editing].fields.filter(isEdited) : [];

  function open(id: SectionId) {
    const next: Record<string, string> = {};
    for (const key of SECTIONS[id].fields) next[key] = savedValue(key);
    setForm(next);
    setSameAddress(id === 'contact' && addressesMatch(next));
    setError('');
    setEditing(id);
  }

  async function requestClose() {
    if (editedKeys.length > 0 && !(await confirm('Discard your unsaved changes?', { title: 'Discard changes?', confirmLabel: 'Discard', tone: 'danger' }))) return;
    setEditing(null);
  }

  const setField = (key: string) => (value: string) => setForm(f => ({ ...f, [key]: value }));
  const setPermanentField = (key: string) => (value: string) =>
    setForm(f => {
      const next = { ...f, [key]: value };
      if (sameAddress) next[`temporary_${key.slice('permanent_'.length)}`] = value;
      return next;
    });
  function toggleSameAddress(on: boolean) {
    setSameAddress(on);
    if (on) setForm(f => ({ ...f, ...Object.fromEntries(PARTS.map(p => [`temporary_${p}`, f[`permanent_${p}`] ?? ''])) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || editedKeys.length === 0) return;
    if (editedKeys.includes('name') && !(form.name ?? '').trim()) {
      setError("Your name can't be empty.");
      return;
    }
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
        setError(`Could not save: ${message}`);
        return;
      }
      profileSaved = true;
    }
    if (Object.keys(hrValues).length > 0) {
      const { error: rpcError } = await supabase.rpc('update_my_hr_profile', { p_values: hrValues });
      if (rpcError) {
        setSaving(false);
        // What did save is on the page now, so the pop-up marks only what is still unsaved.
        if (profileSaved) onSaved();
        setError(`Could not save: ${rpcError.message}${profileSaved ? ' (your other changes were saved)' : ''}`);
        return;
      }
    }
    setSaving(false);
    setEditing(null);
    onSaved();
  }

  // ---- the right rail
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
  const attention: AttentionItem[] = [];
  if (contractNotice) {
    attention.push({ key: 'contract', title: contractLabel(contractNotice.daysLeft), detail: formatAdDate(contractNotice.endKey, system) });
  }
  if (missingDocs && missingDocs.length > 0) {
    attention.push({
      key: 'docs',
      title: `${missingDocs.length} document${missingDocs.length === 1 ? '' : 's'} missing`,
      detail: missingDocs.slice(0, 3).join(', ') + (missingDocs.length > 3 ? ` and ${missingDocs.length - 3} more` : ''),
      action: { label: 'Open', onClick: () => onOpenTab('documents') },
    });
  }
  if (openConduct) {
    attention.push({
      key: 'conduct',
      title: `${openConduct} conduct record${openConduct === 1 ? '' : 's'} still open`,
      action: { label: 'Open', onClick: () => onOpenTab('records') },
    });
  }
  if (exitOpen && sep) {
    attention.push({
      key: 'exit',
      title: `Exit in progress — settlement ${sep.settlement_status}`,
      action: { label: 'Open', onClick: () => onOpenTab('exit') },
    });
  }

  const lockNote = <p className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">Set by HR/Admin — not editable here.</p>;

  return (
    <>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-5">
          <ProfileCard title="Employment">
            <FactGrid>
              <Fact label="Company">{companyName}</Fact>
              <Fact label="Employee code">{employee.employee_code}</Fact>
              <Fact label="Username">{employee.username}</Fact>
              <Fact label="Biometric / Registration ID">{employee.fingerprint_id}</Fact>
              <Fact label="Employment type">{employmentTypeLabel(employee.employment_type)}</Fact>
              <Fact label="Status">
                <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
              </Fact>
              <Fact label="Reporting to">{managerName}</Fact>
              <Fact label="Outlet / branch">{branchName}</Fact>
              <Fact label="Department">{employee.department}</Fact>
              <Fact label="Designation">{employee.designation}</Fact>
              <Fact label="Date of joining">{date(employee.date_of_joining)}</Fact>
              <Fact label={employee.resigned_at ? 'Days worked' : 'Days with company'}>{days !== null ? `${days} days` : null}</Fact>
              {employee.resigned_at && <Fact label="Last working date">{date(employee.resigned_at)}</Fact>}
              {isContract && (
                <>
                  <Fact label="Contract start">{date(employee.contract_start)}</Fact>
                  <Fact label="Contract end">{date(employee.contract_end)}</Fact>
                </>
              )}
            </FactGrid>
            {lockNote}
          </ProfileCard>

          <ProfileCard title="Personal" action="Edit" onAction={() => open('personal')}>
            <FactGrid>
              <Fact label="Gender">{capitalize(employee.gender)}</Fact>
              <Fact label="Date of birth">{date(employee.date_of_birth)}</Fact>
              <Fact label="Nationality">{employee.nationality}</Fact>
              <Fact label="Marital status">{capitalize(employee.marital_status)}</Fact>
              <Fact label="Blood group">{employee.blood_group}</Fact>
              <Fact label="Citizenship no.">{employee.citizenship_no}</Fact>
              <Fact label="Citizenship issued district">{employee.citizenship_issued_district}</Fact>
              <Fact label="Citizenship issue date">{date(employee.citizenship_issue_date)}</Fact>
            </FactGrid>
          </ProfileCard>

          <ProfileCard title="Contact & address" action="Edit" onAction={() => open('contact')}>
            <FactGrid min={220}>
              <Fact label="Phone (personal)">{employee.phone}</Fact>
              <Fact label="Phone (official)">{employee.official_phone}</Fact>
              <Fact label="Email (official)">{employee.email}</Fact>
              <Fact label="Email (personal)">{employee.personal_email}</Fact>
              <Fact label="Permanent address" wide>
                {formatAddress(employee, 'permanent')}
              </Fact>
              <Fact label="Temporary address" wide>
                {formatAddress(employee, 'temporary')}
              </Fact>
              {employee.address && (
                <Fact label="Other address note" wide>
                  {employee.address}
                </Fact>
              )}
            </FactGrid>
          </ProfileCard>

          <ProfileCard title="Family" action="Edit" onAction={() => open('family')}>
            <FactGrid>
              <Fact label="Father's name">{employee.father_name}</Fact>
              <Fact label="Mother's name">{employee.mother_name}</Fact>
              <Fact label="Grandfather's name">{employee.grandfather_name}</Fact>
              <Fact label="Spouse's name">{employee.spouse_name}</Fact>
            </FactGrid>
          </ProfileCard>

          <ProfileCard title="Payroll & statutory">
            <FactGrid>
              <Fact label="Basic salary">{employee.salary != null ? employee.salary.toLocaleString() : null}</Fact>
              <Fact label="Allowance">{employee.allowance != null ? employee.allowance.toLocaleString() : null}</Fact>
              <Fact label="PAN No.">{employee.pan_no}</Fact>
              <Fact label="SSF No.">{employee.ssf_no}</Fact>
            </FactGrid>
            {lockNote}
          </ProfileCard>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <EmergencyCard
            bloodGroup={employee.blood_group}
            name={employee.emergency_contact_name}
            relationship={employee.emergency_contact_relationship}
            phone={employee.emergency_contact_phone}
            address={employee.emergency_contact_address}
            onEdit={() => open('emergency')}
          />
          <AttentionCard items={attention} />
          {haveDocs !== null && missingDocs && <DocumentProgress have={haveDocs} total={DOCUMENT_TYPES.length} missing={missingDocs} onOpen={() => onOpenTab('documents')} />}
          <ReportingLine manager={managerName ? { name: managerName } : null} directReports={null} />
        </div>
      </div>

      {editing && (
        <SectionDialog
          title={SECTIONS[editing].title}
          hint={SECTIONS[editing].hint}
          tone={SECTIONS[editing].tone}
          changed={editedKeys.length}
          changedLabels={editedKeys.map(k => LABEL[k] ?? k)}
          saving={saving}
          error={error || undefined}
          onClose={requestClose}
          onSubmit={save}
        >
          {editing === 'personal' && (
            <FieldGrid>
              <TextField label="Full name" value={form.name ?? ''} onChange={setField('name')} edited={isEdited('name')} wide />
              <SegmentField
                label="Gender"
                value={form.gender ?? ''}
                onChange={setField('gender')}
                edited={isEdited('gender')}
                options={[
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                ]}
              />
              <DateField label="Date of birth" value={form.date_of_birth ?? ''} onChange={setField('date_of_birth')} edited={isEdited('date_of_birth')} />
              <TextField label="Nationality" placeholder="Nepali" value={form.nationality ?? ''} onChange={setField('nationality')} edited={isEdited('nationality')} />
              <SegmentField
                label="Marital status"
                value={form.marital_status ?? ''}
                onChange={setField('marital_status')}
                edited={isEdited('marital_status')}
                options={MARITAL_STATUSES.map(m => ({ value: m.value, label: m.label }))}
              />
              <SegmentField
                wide
                tone="danger"
                label="Blood group"
                value={form.blood_group ?? ''}
                onChange={setField('blood_group')}
                edited={isEdited('blood_group')}
                options={BLOOD_GROUPS.map(b => ({ value: b, label: b }))}
              />
              <TextField label="Citizenship no." value={form.citizenship_no ?? ''} onChange={setField('citizenship_no')} edited={isEdited('citizenship_no')} />
              <TextField
                label="Citizenship issued district"
                value={form.citizenship_issued_district ?? ''}
                onChange={setField('citizenship_issued_district')}
                edited={isEdited('citizenship_issued_district')}
              />
              <DateField label="Citizenship issue date" value={form.citizenship_issue_date ?? ''} onChange={setField('citizenship_issue_date')} edited={isEdited('citizenship_issue_date')} />
            </FieldGrid>
          )}

          {editing === 'contact' && (
            <FieldGrid>
              <TextField label="Phone (personal)" value={form.phone ?? ''} onChange={setField('phone')} edited={isEdited('phone')} />
              <TextField label="Email (official)" type="email" value={form.email ?? ''} onChange={setField('email')} edited={isEdited('email')} />
              <TextField label="Email (personal)" type="email" value={form.personal_email ?? ''} onChange={setField('personal_email')} edited={isEdited('personal_email')} />
              <p className="col-span-full -mt-2 text-xs font-semibold text-slate-500">Your official phone is set by HR.</p>

              <GroupHeading>Permanent address</GroupHeading>
              <AddressFields kind="permanent" form={form} setField={setPermanentField} isEdited={isEdited} />

              <GroupHeading>Temporary address</GroupHeading>
              <label className="col-span-full flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <input type="checkbox" checked={sameAddress} onChange={e => toggleSameAddress(e.target.checked)} className="h-5 w-5 accent-[#047857]" />
                <span className="text-sm font-bold text-ink">Same as permanent address</span>
              </label>
              {!sameAddress && <AddressFields kind="temporary" form={form} setField={setField} isEdited={isEdited} />}

              <GroupHeading>Other note</GroupHeading>
              <AreaField
                label="Note"
                value={form.address ?? ''}
                onChange={setField('address')}
                edited={isEdited('address')}
                placeholder="Anything that doesn't fit above (landmark, current rented room…)"
              />
            </FieldGrid>
          )}

          {editing === 'family' && (
            <FieldGrid>
              <TextField label="Father's name" value={form.father_name ?? ''} onChange={setField('father_name')} edited={isEdited('father_name')} />
              <TextField label="Mother's name" value={form.mother_name ?? ''} onChange={setField('mother_name')} edited={isEdited('mother_name')} />
              <TextField label="Grandfather's name" value={form.grandfather_name ?? ''} onChange={setField('grandfather_name')} edited={isEdited('grandfather_name')} />
              <TextField label="Spouse's name" value={form.spouse_name ?? ''} onChange={setField('spouse_name')} edited={isEdited('spouse_name')} />
            </FieldGrid>
          )}

          {editing === 'emergency' && (
            <FieldGrid>
              <TextField label="Name" value={form.emergency_contact_name ?? ''} onChange={setField('emergency_contact_name')} edited={isEdited('emergency_contact_name')} />
              <TextField
                label="Relationship"
                value={form.emergency_contact_relationship ?? ''}
                onChange={setField('emergency_contact_relationship')}
                edited={isEdited('emergency_contact_relationship')}
              />
              <TextField label="Mobile no." value={form.emergency_contact_phone ?? ''} onChange={setField('emergency_contact_phone')} edited={isEdited('emergency_contact_phone')} />
              <TextField label="Address" value={form.emergency_contact_address ?? ''} onChange={setField('emergency_contact_address')} edited={isEdited('emergency_contact_address')} />
            </FieldGrid>
          )}
        </SectionDialog>
      )}
    </>
  );
}
