'use client';

import { useState } from 'react';
import Badge from '@/components/Badge';
import { useConfirm } from '@/components/ConfirmDialog';
import SectionDialog from '@/components/profile/SectionDialog';
import { Fact, FactGrid } from '@/components/profile/ProfileParts';
import { supabase } from '@/lib/supabase';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { BLOOD_GROUPS, EMPLOYMENT_STATUS_LABEL, MARITAL_STATUSES, STATUS_TONE, effectiveStatus, employmentTypeLabel, formatAddress } from '@/lib/employeeProfile';
import type { Employee } from '@/lib/types';
import { AddressFields, DateField, FieldGrid, GroupHeading, SegmentField, TextField } from './fields';
import { Card } from './ui';

const capitalize = (v: string | null | undefined) => (v ? <span className="capitalize">{v}</span> : null);

type SectionId = 'personal' | 'contact' | 'family';
const PARTS = ['province', 'district', 'municipality', 'ward', 'tole'] as const;
const ADDRESS_KEYS = (['permanent', 'temporary'] as const).flatMap(kind => PARTS.map(p => `${kind}_${p}`));

// The pop-ups, one per card. Each lists the fields it covers, so a save sends only what changed in it.
const SECTIONS: Record<SectionId, { title: string; hint: string; fields: string[] }> = {
  personal: {
    title: 'personal details',
    hint: 'Identity details used on your CV and for government records.',
    fields: ['gender', 'date_of_birth', 'nationality', 'marital_status', 'blood_group', 'citizenship_no', 'citizenship_issued_district', 'citizenship_issue_date'],
  },
  contact: { title: 'contact & address', hint: 'Where HR can reach you and where you live.', fields: ['personal_email', ...ADDRESS_KEYS, 'emergency_contact_address'] },
  family: { title: 'family', hint: 'Names HR keeps on your file.', fields: ['father_name', 'mother_name', 'grandfather_name', 'spouse_name'] },
};

const LABEL: Record<string, string> = {
  gender: 'Gender',
  date_of_birth: 'Date of birth',
  nationality: 'Nationality',
  marital_status: 'Marital status',
  blood_group: 'Blood group',
  citizenship_no: 'Citizenship no.',
  citizenship_issued_district: 'Citizenship issued district',
  citizenship_issue_date: 'Citizenship issue date',
  personal_email: 'Email (personal)',
  emergency_contact_address: "Emergency contact's address",
  father_name: "Father's name",
  mother_name: "Mother's name",
  grandfather_name: "Grandfather's name",
  spouse_name: "Spouse's name",
  ...Object.fromEntries(
    (['permanent', 'temporary'] as const).flatMap(kind => PARTS.map(p => [`${kind}_${p}`, `${kind === 'permanent' ? 'Permanent' : 'Temporary'} ${p === 'ward' ? 'ward' : p}`] as const))
  ),
};

function addressesMatch(f: Record<string, string>) {
  return PARTS.some(p => f[`permanent_${p}`]) && PARTS.every(p => f[`permanent_${p}`] === f[`temporary_${p}`]);
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} role="img" aria-label="Set by your employer">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** What HR keeps about you beyond the basics My Profile already shows. Employment is set by your
 * employer; personal details, contact & address and family are yours to correct, each in its own pop-up. */
export default function MyEmploymentCards({ employee, managerName, onSaved }: { employee: Employee; managerName: string | null; onSaved: () => void }) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : null);
  const status = effectiveStatus(employee);
  const permanentAddress = formatAddress(employee, 'permanent');
  const temporaryAddress = formatAddress(employee, 'temporary');

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
    setSaving(true);
    setError('');
    const values = Object.fromEntries(editedKeys.map(k => [k, form[k] ?? '']));
    const { error: rpcError } = await supabase.rpc('update_my_hr_profile', { p_values: values });
    setSaving(false);
    if (rpcError) {
      setError(`Could not save: ${rpcError.message}`);
      return;
    }
    setEditing(null);
    onSaved();
  }

  const editLink = (id: SectionId) => (
    <button type="button" onClick={() => open(id)} className="flex h-11 shrink-0 items-center px-1 text-[13px] font-extrabold text-brand lg:h-10">
      Edit
    </button>
  );

  return (
    <>
      <Card title="Employment" right={<LockIcon className="h-[18px] w-[18px] shrink-0 text-[#586474]" />}>
        <FactGrid>
          <Fact label="Employee code">{employee.employee_code}</Fact>
          <Fact label="Employment type">{employmentTypeLabel(employee.employment_type)}</Fact>
          <Fact label="Status">
            <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
          </Fact>
          <Fact label="Reporting to">{managerName}</Fact>
          {employee.employment_type === 'contract' && (
            <>
              <Fact label="Contract start">{date(employee.contract_start)}</Fact>
              <Fact label="Contract end">{date(employee.contract_end)}</Fact>
            </>
          )}
          {employee.resigned_at && <Fact label="Last working date">{date(employee.resigned_at)}</Fact>}
        </FactGrid>
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Set by HR/Admin — not editable here.</p>
      </Card>

      <Card title="Personal details" right={editLink('personal')}>
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
      </Card>

      <Card title="Contact & address" right={editLink('contact')}>
        <FactGrid min={220}>
          <Fact label="Phone (official)">{employee.official_phone}</Fact>
          <Fact label="Email (personal)">{employee.personal_email}</Fact>
          <Fact label="Permanent address" wide>
            {permanentAddress}
          </Fact>
          <Fact label="Temporary address" wide>
            {temporaryAddress}
          </Fact>
          {employee.emergency_contact_address && (
            <Fact label="Emergency contact's address" wide>
              {employee.emergency_contact_address}
            </Fact>
          )}
        </FactGrid>
      </Card>

      <Card title="Family" right={editLink('family')}>
        <FactGrid>
          <Fact label="Father's name">{employee.father_name}</Fact>
          <Fact label="Mother's name">{employee.mother_name}</Fact>
          <Fact label="Grandfather's name">{employee.grandfather_name}</Fact>
          <Fact label="Spouse's name">{employee.spouse_name}</Fact>
        </FactGrid>
      </Card>

      {editing && (
        <SectionDialog
          title={SECTIONS[editing].title}
          hint={SECTIONS[editing].hint}
          changed={editedKeys.length}
          changedLabels={editedKeys.map(k => LABEL[k] ?? k)}
          saving={saving}
          error={error || undefined}
          onClose={requestClose}
          onSubmit={save}
        >
          {editing === 'personal' && (
            <FieldGrid>
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
              <TextField label="Email (personal)" type="email" value={form.personal_email ?? ''} onChange={setField('personal_email')} edited={isEdited('personal_email')} wide />
              <p className="col-span-full -mt-2 text-xs text-slate-500">Your name, phone, sign-in email and emergency contact are in “Edit” on the Personal card above.</p>

              <GroupHeading>Permanent address</GroupHeading>
              <AddressFields kind="permanent" form={form} setField={setPermanentField} isEdited={isEdited} />

              <GroupHeading>Temporary address</GroupHeading>
              <label className="col-span-full flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <input type="checkbox" checked={sameAddress} onChange={e => toggleSameAddress(e.target.checked)} className="h-5 w-5 accent-[#047857]" />
                <span className="text-sm font-bold">Same as permanent address</span>
              </label>
              {!sameAddress && <AddressFields kind="temporary" form={form} setField={setField} isEdited={isEdited} />}

              <GroupHeading>Emergency contact</GroupHeading>
              <TextField
                label="Emergency contact's address"
                value={form.emergency_contact_address ?? ''}
                onChange={setField('emergency_contact_address')}
                edited={isEdited('emergency_contact_address')}
                wide
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
        </SectionDialog>
      )}
    </>
  );
}
