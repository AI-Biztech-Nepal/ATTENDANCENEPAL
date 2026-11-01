'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import PhotoCropModal from '@/components/PhotoCropModal';
import EmployeeDocuments from '@/components/EmployeeDocuments';
import EmployeeHistory from '@/components/EmployeeHistory';
import EmployeeSeparation from '@/components/EmployeeSeparation';
import EmployeePerformance from '@/components/EmployeePerformance';
import EmployeeConduct from '@/components/EmployeeConduct';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { SKILL_CATEGORIES } from '@/lib/skillCategories';
import {
  BLOOD_GROUPS,
  EMPLOYMENT_STATUS_LABEL,
  EMPLOYMENT_TYPES,
  MARITAL_STATUSES,
  NEPAL_PROVINCES,
  PROFILE_COLUMNS,
  STATUS_TONE,
  WORKING_STATUSES,
  degreeLabel,
  effectiveStatus,
  employmentTypeLabel,
  experienceSummary,
  formatAddress,
  formatDuration,
  formatPassingYear,
  highestQualification,
  withKnownColumns,
} from '@/lib/employeeProfile';
import type {
  Branch,
  Department,
  Employee,
  EmployeeEducation,
  EmployeeTraining,
  EmployeeWorkExperience,
} from '@/lib/types';

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

const EMPTY_EDUCATION_FORM = { degree: '', institution: '', board_university: '', year: '', year_calendar: 'AD' };
const EMPTY_TRAINING_FORM = { title: '', provider: '', start_date: '', end_date: '' };
const EMPTY_EXPERIENCE_FORM = { employer: '', role: '', description: '', start_date: '', end_date: '' };

// Every field on the edit form is held as a string. The first group are the
// columns the page has always edited; PROFILE_COLUMNS are the HR-profile ones
// added by 20261101120000_employee_hr_profile.sql.
const LEGACY_KEYS = [
  'name',
  'username',
  'email',
  'phone',
  'gender',
  'department',
  'designation',
  'branch_id',
  'date_of_joining',
  'address',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
  'pan_no',
  'ssf_no',
  'allowance',
] as const;
const CORE_KEYS = [...LEGACY_KEYS, ...PROFILE_COLUMNS] as const;
type CoreKey = (typeof CORE_KEYS)[number];
type CoreForm = Record<CoreKey, string>;

const EMPTY_CORE_FORM = Object.fromEntries(CORE_KEYS.map(k => [k, ''])) as CoreForm;

function formFromEmployee(row: Record<string, unknown>): CoreForm {
  const form = { ...EMPTY_CORE_FORM };
  for (const key of CORE_KEYS) {
    const value = row[key];
    form[key] = value == null ? '' : String(value);
  }
  if (!form.employment_status) form.employment_status = 'active';
  return form;
}

const INPUT_CLASS = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

type PersonOption = Pick<Employee, 'id' | 'name' | 'employee_code' | 'status'>;

export default function EmployeeCvPage() {
  usePageTitle('Employee CV');
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const params = useParams<{ id: string }>();
  const employeeId = params.id;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [training, setTraining] = useState<EmployeeTraining[]>([]);
  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingCore, setEditingCore] = useState(false);
  const [coreForm, setCoreForm] = useState<CoreForm>(EMPTY_CORE_FORM);
  const [savingCore, setSavingCore] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);

  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillCategory, setSkillCategory] = useState<(typeof SKILL_CATEGORIES)[number]>(SKILL_CATEGORIES[0]);
  const [skillInput, setSkillInput] = useState('');

  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationForm, setEducationForm] = useState(EMPTY_EDUCATION_FORM);
  const [savingEducation, setSavingEducation] = useState(false);

  const [showTrainingForm, setShowTrainingForm] = useState(false);
  const [trainingForm, setTrainingForm] = useState(EMPTY_TRAINING_FORM);
  const [savingTraining, setSavingTraining] = useState(false);

  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE_FORM);
  const [savingExperience, setSavingExperience] = useState(false);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  // Bumped after a save so the history card re-reads what the save logged.
  const [historyVersion, setHistoryVersion] = useState(0);

  function reload() {
    supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        if (data) {
          // skills is a new column — normalize to [] if the migration adding
          // it hasn't been run yet, so the page degrades instead of crashing.
          setEmployee({ ...data, skills: data.skills ?? [] });
          setCoreForm(formFromEmployee(data));
          if (data.branch_id) {
            supabase
              .from('branches')
              .select('*')
              .eq('id', data.branch_id)
              .single()
              .then(({ data: b }) => setBranch(b ?? null));
          } else {
            setBranch(null);
          }
        }
        setLoading(false);
      });
    supabase
      .from('branches')
      .select('*')
      .order('name')
      .then(({ data }) => setBranches(data ?? []));
    supabase
      .from('departments')
      .select('*')
      .order('name')
      .then(({ data }) => setDepartmentOptions(data ?? []));
    supabase
      .from('employees')
      .select('id, name, employee_code, status')
      .order('name')
      .then(({ data }) => setPeople((data ?? []) as PersonOption[]));
    supabase
      .from('employee_education')
      .select('*')
      .eq('employee_id', employeeId)
      .order('year', { ascending: false })
      .then(({ data }) => setEducation(data ?? []));
    supabase
      .from('employee_training')
      .select('*')
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false })
      .then(({ data }) => setTraining(data ?? []));
    supabase
      .from('employee_work_experience')
      .select('*')
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false })
      .then(({ data }) => setExperience(data ?? []));
  }
  useEffect(() => {
    if (employeeId) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const setField = (key: CoreKey) => (value: string) => setCoreForm(f => ({ ...f, [key]: value }));

  function copyPermanentToTemporary() {
    setCoreForm(f => ({
      ...f,
      temporary_province: f.permanent_province,
      temporary_district: f.permanent_district,
      temporary_municipality: f.permanent_municipality,
      temporary_ward: f.permanent_ward,
      temporary_tole: f.permanent_tole,
    }));
  }

  async function handleSaveCore(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    const isContract = coreForm.employment_type === 'contract';
    if (isContract && coreForm.contract_start && coreForm.contract_end && coreForm.contract_end < coreForm.contract_start) {
      alert('The contract end date is before the contract start date.');
      return;
    }

    const payload: Record<string, unknown> = { name: coreForm.name };
    for (const key of LEGACY_KEYS) {
      if (key === 'name' || key === 'allowance') continue;
      payload[key] = coreForm[key] || null;
    }
    payload.allowance = coreForm.allowance ? Number(coreForm.allowance) : null;

    const added: Record<string, string | null> = {};
    for (const key of PROFILE_COLUMNS) {
      if (key === 'employment_status') continue;
      added[key] = coreForm[key] || null;
    }
    // Contract dates only mean something for a contract; clearing them when
    // the type changes keeps a stale end date from lingering on a permanent hire.
    if (!isContract) {
      added.contract_start = null;
      added.contract_end = null;
    }
    Object.assign(payload, withKnownColumns(employee, added));
    // Someone who has left keeps the Resigned / Terminated label that "Mark
    // Resigned" gave them; only people still working can be moved between
    // Active, Probation and Suspended here.
    if (employee.status === 'active' && ('employment_status' in employee || coreForm.employment_status !== 'active')) {
      payload.employment_status = coreForm.employment_status || 'active';
    }

    setSavingCore(true);
    const { error } = await supabase.from('employees').update(payload).eq('id', employee.id);
    setSavingCore(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setEditingCore(false);
    reload();
    // The database may just have logged a transfer / promotion / pay change.
    setHistoryVersion(v => v + 1);
  }

  // A standing per-person exemption (e.g. for someone "in charge") — never
  // flagged Late or Absent regardless of whether/when they punch. Toggled
  // immediately, like Mark Resigned/Reactivate, rather than folded into the
  // core edit form, since it's a single independent switch.
  async function handleToggleExempt() {
    if (!employee) return;
    const { error } = await supabase
      .from('employees')
      .update({ attendance_exempt: !employee.attendance_exempt })
      .eq('id', employee.id);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    reload();
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingPhotoFile(file);
  }

  async function handlePhotoCropped(blob: Blob) {
    if (!employee) return;

    setUploadingPhoto(true);
    const path = `employee-photos/${employee.id}-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, blob, {
      contentType: 'image/jpeg',
    });
    if (uploadError) {
      setUploadingPhoto(false);
      alert(`Photo upload failed: ${uploadError.message}`);
      return;
    }
    const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
    const { error } = await supabase
      .from('employees')
      .update({ profile_photo_url: publicUrl.publicUrl })
      .eq('id', employee.id);
    setUploadingPhoto(false);
    if (error) {
      alert(`Could not save photo: ${error.message}`);
      return;
    }
    setPendingPhotoFile(null);
    reload();
  }

  async function addSkill(e?: React.FormEvent) {
    e?.preventDefault();
    const value = skillInput.trim();
    if (!value || !employee) return;
    const skill = `${skillCategory}: ${value}`;
    if (employee.skills.includes(skill)) {
      setSkillInput('');
      setShowSkillForm(false);
      return;
    }
    const { error } = await supabase
      .from('employees')
      .update({ skills: [...employee.skills, skill] })
      .eq('id', employee.id);
    if (error) {
      alert(`Could not add skill: ${error.message}`);
      return;
    }
    setSkillInput('');
    setShowSkillForm(false);
    reload();
  }

  async function removeSkill(skill: string) {
    if (!employee) return;
    const { error } = await supabase
      .from('employees')
      .update({ skills: employee.skills.filter(s => s !== skill) })
      .eq('id', employee.id);
    if (error) {
      alert(`Could not remove skill: ${error.message}`);
      return;
    }
    reload();
  }

  async function handleAddEducation(e: React.FormEvent) {
    e.preventDefault();
    setSavingEducation(true);
    const { error } = await supabase.from('employee_education').insert({
      employee_id: employeeId,
      degree: educationForm.degree,
      institution: educationForm.institution || null,
      year: educationForm.year ? Number(educationForm.year) : null,
      // Only sent when used, so adding a plain entry still works before the
      // HR-profile migration has been run.
      ...(educationForm.board_university ? { board_university: educationForm.board_university } : {}),
      ...(educationForm.year_calendar === 'BS' ? { year_calendar: 'BS' } : {}),
    });
    setSavingEducation(false);
    if (error) {
      alert(`Could not add: ${error.message}`);
      return;
    }
    setEducationForm(EMPTY_EDUCATION_FORM);
    setShowEducationForm(false);
    reload();
  }

  async function handleDeleteEducation(id: string) {
    if (!(await confirm('Remove this education entry?', { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from('employee_education').delete().eq('id', id);
    reload();
  }

  async function handleAddTraining(e: React.FormEvent) {
    e.preventDefault();
    if (trainingForm.start_date && trainingForm.end_date && trainingForm.end_date < trainingForm.start_date) {
      alert('The end date is before the start date.');
      return;
    }
    setSavingTraining(true);
    const { error } = await supabase.from('employee_training').insert({
      employee_id: employeeId,
      title: trainingForm.title,
      provider: trainingForm.provider || null,
      start_date: trainingForm.start_date || null,
      end_date: trainingForm.end_date || null,
    });
    setSavingTraining(false);
    if (error) {
      alert(`Could not add: ${error.message}`);
      return;
    }
    setTrainingForm(EMPTY_TRAINING_FORM);
    setShowTrainingForm(false);
    reload();
  }

  async function handleDeleteTraining(id: string) {
    if (!(await confirm('Remove this training entry?', { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from('employee_training').delete().eq('id', id);
    reload();
  }

  async function handleAddExperience(e: React.FormEvent) {
    e.preventDefault();
    setSavingExperience(true);
    const { error } = await supabase.from('employee_work_experience').insert({
      employee_id: employeeId,
      employer: experienceForm.employer,
      role: experienceForm.role || null,
      description: experienceForm.description || null,
      start_date: experienceForm.start_date || null,
      end_date: experienceForm.end_date || null,
    });
    setSavingExperience(false);
    if (error) {
      alert(`Could not add: ${error.message}`);
      return;
    }
    setExperienceForm(EMPTY_EXPERIENCE_FORM);
    setShowExperienceForm(false);
    reload();
  }

  async function handleDeleteExperience(id: string) {
    if (!(await confirm('Remove this work experience entry?', { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from('employee_work_experience').delete().eq('id', id);
    reload();
  }

  async function downloadPdf() {
    if (!employee) return;
    const emp = employee;
    setGeneratingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const marginX = 18;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const contentWidth = pageWidth - marginX * 2;
      let y = 20;

      function ensureSpace(next: number) {
        if (y + next > pageHeight - 15) {
          doc.addPage();
          y = 20;
        }
      }

      let textStartX = marginX;
      if (emp.profile_photo_url) {
        const dataUrl = await toDataUrl(emp.profile_photo_url);
        if (dataUrl) {
          try {
            doc.addImage(dataUrl, 'JPEG', marginX, y, 28, 28);
            textStartX = marginX + 34;
          } catch {
            // Unsupported image format for jsPDF — fall back to text-only header.
          }
        }
      }

      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(emp.name, textStartX, y + 8);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text([emp.designation, emp.department].filter(Boolean).join(' · ') || '—', textStartX, y + 15);
      doc.setFontSize(9);
      doc.setTextColor(100);
      const contactLine = [emp.phone, emp.email, branch?.name, emp.blood_group ? `Blood group ${emp.blood_group}` : null].filter(Boolean).join('   ·   ');
      doc.text(contactLine || '—', textStartX, y + 21);
      doc.setTextColor(0);
      y += 34;

      function sectionHeading(title: string) {
        ensureSpace(10);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(title, marginX, y);
        y += 1.5;
        doc.setDrawColor(200);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
      }

      // A heading plus one wrapped line per fact; a section with nothing to
      // say is left out entirely.
      function section(title: string, lines: (string | null | false | undefined)[]) {
        const rows = lines.filter(Boolean) as string[];
        if (rows.length === 0) return;
        sectionHeading(title);
        for (const line of rows) {
          const wrapped = doc.splitTextToSize(line, contentWidth);
          ensureSpace(wrapped.length * 5 + 1);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 5 + 1;
        }
        y += 3;
      }

      const days = tenureDays(emp.date_of_joining, emp.resigned_at);
      const manager = people.find(p => p.id === emp.reporting_to);
      const status = effectiveStatus(emp);

      section('Employment', [
        `Employee code: ${emp.employee_code}`,
        emp.fingerprint_id ? `Biometric / Registration ID: ${emp.fingerprint_id}` : null,
        emp.employment_type ? `Employment type: ${employmentTypeLabel(emp.employment_type)}` : null,
        `Status: ${EMPLOYMENT_STATUS_LABEL[status]}`,
        emp.employment_type === 'contract' && (emp.contract_start || emp.contract_end)
          ? `Contract: ${emp.contract_start ?? '—'} to ${emp.contract_end ?? '—'}`
          : null,
        manager ? `Reports to: ${manager.name}` : null,
        `Date of joining: ${emp.date_of_joining ?? '—'}`,
        days !== null ? `Tenure: ${days} days${emp.resigned_at ? ' (last working day ' + emp.resigned_at + ')' : ''}` : null,
      ]);

      section('Personal', [
        emp.gender ? `Gender: ${emp.gender}` : null,
        emp.date_of_birth ? `Date of birth: ${emp.date_of_birth}` : null,
        emp.nationality ? `Nationality: ${emp.nationality}` : null,
        emp.marital_status ? `Marital status: ${emp.marital_status}` : null,
        emp.blood_group ? `Blood group: ${emp.blood_group}` : null,
        emp.citizenship_no
          ? `Citizenship no.: ${emp.citizenship_no}${emp.citizenship_issued_district ? ', issued in ' + emp.citizenship_issued_district : ''}${emp.citizenship_issue_date ? ' on ' + emp.citizenship_issue_date : ''}`
          : null,
        emp.pan_no ? `PAN No.: ${emp.pan_no}` : null,
        emp.ssf_no ? `SSF No.: ${emp.ssf_no}` : null,
      ]);

      section('Contact', [
        emp.phone ? `Phone (personal): ${emp.phone}` : null,
        emp.official_phone ? `Phone (official): ${emp.official_phone}` : null,
        emp.email ? `Email (official): ${emp.email}` : null,
        emp.personal_email ? `Email (personal): ${emp.personal_email}` : null,
      ]);

      section('Address', [
        formatAddress(emp, 'permanent') ? `Permanent: ${formatAddress(emp, 'permanent')}` : null,
        formatAddress(emp, 'temporary') ? `Temporary: ${formatAddress(emp, 'temporary')}` : null,
        emp.address ? `Other: ${emp.address}` : null,
      ]);

      section('Family', [
        emp.father_name ? `Father: ${emp.father_name}` : null,
        emp.mother_name ? `Mother: ${emp.mother_name}` : null,
        emp.grandfather_name ? `Grandfather: ${emp.grandfather_name}` : null,
        emp.spouse_name ? `Spouse: ${emp.spouse_name}` : null,
      ]);

      section(
        'Education',
        education.map(ed =>
          [degreeLabel(ed.degree), ed.institution, ed.board_university, formatPassingYear(ed)].filter(Boolean).join(' — ')
        )
      );

      section(
        'Training & Certification',
        training.map(t => {
          const dates = [t.start_date, t.end_date].filter(Boolean).join(' – ');
          return [t.title, t.provider, dates].filter(Boolean).join(' — ');
        })
      );

      const summary = experienceSummary(experience, emp.date_of_joining, emp.resigned_at);
      section('Work Experience', [
        ...experience.map(exp => {
          const dates = [exp.start_date, exp.end_date ?? 'Present'].filter(Boolean).join(' – ');
          return [exp.employer, exp.role, dates].filter(Boolean).join(' — ');
        }),
        summary.total > 0 ? `Total experience: ${formatDuration(summary.total)}` : null,
      ]);

      section('Skills', emp.skills.length > 0 ? [emp.skills.join(', ')] : []);

      section('Emergency Contact', [
        [emp.emergency_contact_name, emp.emergency_contact_relationship, emp.emergency_contact_phone].filter(Boolean).join(' — '),
        emp.emergency_contact_address ? `Address: ${emp.emergency_contact_address}` : null,
      ]);

      doc.save(`${emp.name.replace(/\s+/g, '_')}_CV.pdf`);
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) {
    return (
      <>
        <p className="text-sm text-slate-400">Loading…</p>
      </>
    );
  }

  if (!employee) {
    return (
      <>
        <p className="text-sm text-warning-text">Employee not found.</p>
      </>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);
  const status = effectiveStatus(employee);
  const manager = people.find(p => p.id === employee.reporting_to);
  const highest = highestQualification(education);
  const summary = experienceSummary(experience, employee.date_of_joining, employee.resigned_at);
  const permanentAddress = formatAddress(employee, 'permanent');
  const temporaryAddress = formatAddress(employee, 'temporary');
  const isContract = employee.employment_type === 'contract';
  // Reporting-to choices: people still working here, never the person
  // themselves, plus whoever is already chosen even if they have since left.
  const managerChoices = people.filter(p => p.id !== employee.id && (p.status === 'active' || p.id === coreForm.reporting_to));

  return (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      <div className="mb-5 flex items-center justify-between">
        <Link href="/employees" className="text-sm font-medium text-accent hover:underline">
          {'←'} Employee Directory
        </Link>
        <div className="flex gap-2">
          <Link
            href={`/attendance?employee=${employee.id}`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Attendance
          </Link>
          <button
            onClick={downloadPdf}
            disabled={generatingPdf}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {generatingPdf ? 'Generating…' : '⬇ Download PDF'}
          </button>
          <button
            onClick={handleToggleExempt}
            title="Never flag this employee Late or Absent, even without a punch — for staff who are in charge and aren't required to clock in/out"
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              employee.attendance_exempt
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {employee.attendance_exempt ? '✓ Excused from Attendance' : 'Excuse from Attendance'}
          </button>
          {!editingCore && (
            <button
              onClick={() => setEditingCore(true)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ✎ Edit
            </button>
          )}
        </div>
      </div>

      {!editingCore ? (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-2 flex items-center gap-4">
            <button
              onClick={openPhotoPicker}
              title={employee.profile_photo_url ? 'Change photo' : 'Add photo'}
              className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold text-accent ${
                employee.profile_photo_url ? 'bg-accent/10' : 'border-2 border-dashed border-accent/40 bg-accent/5 hover:bg-accent/10'
              }`}
            >
              {uploadingPhoto ? (
                <span className="text-sm">…</span>
              ) : employee.profile_photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
              ) : (
                <CameraIcon className="h-7 w-7" />
              )}
            </button>
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
                {employee.name}
                <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
                {employee.employment_type && <Badge tone="neutral">{employmentTypeLabel(employee.employment_type)}</Badge>}
                {employee.blood_group && <Badge tone="critical">Blood group {employee.blood_group}</Badge>}
                {employee.attendance_exempt && <Badge tone="neutral">Excused</Badge>}
              </h1>
              <p className="text-sm text-slate-500">
                {employee.designation ?? '—'} {employee.department && `· ${employee.department}`}
              </p>
              <p className="text-xs text-slate-400">{[employee.phone, branch?.name].filter(Boolean).join('  ·  ') || '—'}</p>
              {employee.email && <p className="text-xs text-slate-400">{employee.email}</p>}
              <button onClick={openPhotoPicker} className="mt-1 text-xs font-medium text-accent hover:underline">
                {employee.profile_photo_url ? 'Change photo' : '+ Add photo'}
              </button>
            </div>
          </div>

          <InfoGrid title="Employment">
            <Info label="Employee code">{employee.employee_code}</Info>
            <Info label="Username">{employee.username}</Info>
            <Info label="Biometric / Registration ID">{employee.fingerprint_id}</Info>
            <Info label="Employment type">{employmentTypeLabel(employee.employment_type)}</Info>
            <Info label="Status">
              <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
            </Info>
            <Info label="Reporting to">
              {manager ? (
                <Link href={`/employees/${manager.id}`} className="text-accent hover:underline">
                  {manager.name}
                </Link>
              ) : null}
            </Info>
            <Info label="Outlet / branch">{branch?.name}</Info>
            <Info label="Department">{employee.department}</Info>
            <Info label="Designation">{employee.designation}</Info>
            <Info label="Date of joining">{employee.date_of_joining ? formatAdDate(employee.date_of_joining, system) : null}</Info>
            <Info label={employee.resigned_at ? 'Days worked' : 'Days with company'}>{days !== null ? `${days} days` : null}</Info>
            {employee.resigned_at && <Info label="Last working date">{formatAdDate(employee.resigned_at, system)}</Info>}
            {isContract && (
              <>
                <Info label="Contract start">{employee.contract_start ? formatAdDate(employee.contract_start, system) : null}</Info>
                <Info label="Contract end">{employee.contract_end ? formatAdDate(employee.contract_end, system) : null}</Info>
              </>
            )}
          </InfoGrid>

          <InfoGrid title="Personal">
            <Info label="Gender">{employee.gender ? <span className="capitalize">{employee.gender}</span> : null}</Info>
            <Info label="Date of birth">{employee.date_of_birth ? formatAdDate(employee.date_of_birth, system) : null}</Info>
            <Info label="Nationality">{employee.nationality}</Info>
            <Info label="Marital status">
              {employee.marital_status ? <span className="capitalize">{employee.marital_status}</span> : null}
            </Info>
            <Info label="Blood group">{employee.blood_group}</Info>
            <Info label="Citizenship no.">{employee.citizenship_no}</Info>
            <Info label="Citizenship issued district">{employee.citizenship_issued_district}</Info>
            <Info label="Citizenship issue date">
              {employee.citizenship_issue_date ? formatAdDate(employee.citizenship_issue_date, system) : null}
            </Info>
          </InfoGrid>

          <InfoGrid title="Contact">
            <Info label="Phone (personal)">{employee.phone}</Info>
            <Info label="Phone (official)">{employee.official_phone}</Info>
            <Info label="Email (official)">{employee.email}</Info>
            <Info label="Email (personal)">{employee.personal_email}</Info>
          </InfoGrid>

          <InfoGrid title="Address">
            <Info label="Permanent address" wide>
              {permanentAddress}
            </Info>
            <Info label="Temporary address" wide>
              {temporaryAddress}
            </Info>
            {employee.address && (
              <Info label="Other address note" wide>
                {employee.address}
              </Info>
            )}
          </InfoGrid>

          <InfoGrid title="Family">
            <Info label="Father's name">{employee.father_name}</Info>
            <Info label="Mother's name">{employee.mother_name}</Info>
            <Info label="Grandfather's name">{employee.grandfather_name}</Info>
            <Info label="Spouse's name">{employee.spouse_name}</Info>
          </InfoGrid>

          <InfoGrid title="Emergency contact">
            <Info label="Name">{employee.emergency_contact_name}</Info>
            <Info label="Relationship">{employee.emergency_contact_relationship}</Info>
            <Info label="Mobile no.">{employee.emergency_contact_phone}</Info>
            <Info label="Address" wide>
              {employee.emergency_contact_address}
            </Info>
          </InfoGrid>

          <InfoGrid title="Payroll & statutory">
            <Info label="PAN No.">{employee.pan_no}</Info>
            <Info label="SSF No.">{employee.ssf_no}</Info>
            <Info label="Allowance">{employee.allowance != null ? employee.allowance.toLocaleString() : null}</Info>
          </InfoGrid>
        </div>
      ) : (
        <form onSubmit={handleSaveCore} className="mb-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-4">
            <button
              type="button"
              onClick={openPhotoPicker}
              title={employee.profile_photo_url ? 'Change photo' : 'Add photo'}
              className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold text-accent ${
                employee.profile_photo_url ? 'bg-accent/10' : 'border-2 border-dashed border-accent/40 bg-accent/5 hover:bg-accent/10'
              }`}
            >
              {uploadingPhoto ? (
                <span className="text-sm">…</span>
              ) : employee.profile_photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
              ) : (
                <CameraIcon className="h-7 w-7" />
              )}
            </button>
            <div>
              <button type="button" onClick={openPhotoPicker} className="text-xs font-medium text-accent hover:underline">
                {employee.profile_photo_url ? 'Change photo' : '+ Add photo'}
              </button>
              <div className="mt-2 flex gap-4 text-xs text-slate-400">
                <span>Code: {employee.employee_code}</span>
                <span>Biometric ID: {employee.fingerprint_id ?? '—'}</span>
              </div>
            </div>
          </div>

          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Details</h2>
            <button
              type="button"
              onClick={() => {
                setEditingCore(false);
                reload();
              }}
              className="text-xs font-medium text-slate-500 hover:underline"
            >
              Cancel
            </button>
          </div>

          <FormSection title="Employment" first>
            <TextField label="Full name" required value={coreForm.name} onChange={setField('name')} />
            <TextField label="Username" value={coreForm.username} onChange={setField('username')} />
            <SelectField label="Employment type" value={coreForm.employment_type} onChange={setField('employment_type')}>
              <option value="">Not set</option>
              {EMPLOYMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </SelectField>
            {employee.status === 'active' ? (
              <SelectField label="Employment status" value={coreForm.employment_status} onChange={setField('employment_status')}>
                {WORKING_STATUSES.map(s => (
                  <option key={s} value={s}>
                    {EMPLOYMENT_STATUS_LABEL[s]}
                  </option>
                ))}
              </SelectField>
            ) : (
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Employment status</span>
                <p className="py-2 text-sm text-ink">{EMPLOYMENT_STATUS_LABEL[status]}</p>
                <p className="text-xs text-slate-400">Restore the employee from the directory to change this.</p>
              </div>
            )}
            {coreForm.employment_type === 'contract' && (
              <>
                <DateField label="Contract start date" value={coreForm.contract_start} onChange={setField('contract_start')} />
                <DateField label="Contract end date" value={coreForm.contract_end} onChange={setField('contract_end')} />
              </>
            )}
            <SelectField label="Reporting to" value={coreForm.reporting_to} onChange={setField('reporting_to')}>
              <option value="">No one</option>
              {managerChoices.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.employee_code})
                </option>
              ))}
            </SelectField>
            <SelectField label="Department" value={coreForm.department} onChange={setField('department')}>
              <option value="">Unassigned</option>
              {coreForm.department && !departmentOptions.some(d => d.name === coreForm.department) && (
                <option value={coreForm.department}>{coreForm.department}</option>
              )}
              {departmentOptions.map(d => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Designation" value={coreForm.designation} onChange={setField('designation')} />
            <SelectField label="Outlet / branch" value={coreForm.branch_id} onChange={setField('branch_id')}>
              <option value="">Unassigned</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <DateField label="Date of joining" value={coreForm.date_of_joining} onChange={setField('date_of_joining')} />
          </FormSection>

          <FormSection title="Personal">
            <SelectField label="Gender" value={coreForm.gender} onChange={setField('gender')}>
              <option value="">Not set</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </SelectField>
            <DateField label="Date of birth" value={coreForm.date_of_birth} onChange={setField('date_of_birth')} />
            <TextField label="Nationality" placeholder="Nepali" value={coreForm.nationality} onChange={setField('nationality')} />
            <SelectField label="Marital status" value={coreForm.marital_status} onChange={setField('marital_status')}>
              <option value="">Not set</option>
              {MARITAL_STATUSES.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="Blood group" value={coreForm.blood_group} onChange={setField('blood_group')}>
              <option value="">Not set</option>
              {BLOOD_GROUPS.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </SelectField>
            <TextField label="Citizenship no." value={coreForm.citizenship_no} onChange={setField('citizenship_no')} />
            <TextField
              label="Citizenship issued district"
              value={coreForm.citizenship_issued_district}
              onChange={setField('citizenship_issued_district')}
            />
            <DateField label="Citizenship issue date" value={coreForm.citizenship_issue_date} onChange={setField('citizenship_issue_date')} />
          </FormSection>

          <FormSection title="Contact">
            <TextField label="Phone (personal)" value={coreForm.phone} onChange={setField('phone')} />
            <TextField label="Phone (official)" value={coreForm.official_phone} onChange={setField('official_phone')} />
            <TextField
              label="Email (official)"
              type="email"
              value={coreForm.email}
              onChange={setField('email')}
              hint="Also the email this person's login is linked to."
            />
            <TextField label="Email (personal)" type="email" value={coreForm.personal_email} onChange={setField('personal_email')} />
          </FormSection>

          <FormSection title="Permanent address" cols={3}>
            <AddressFields kind="permanent" form={coreForm} setField={setField} />
          </FormSection>

          <FormSection
            title="Temporary address"
            cols={3}
            action={
              <button type="button" onClick={copyPermanentToTemporary} className="text-xs font-medium text-accent hover:underline">
                Same as permanent
              </button>
            }
          >
            <AddressFields kind="temporary" form={coreForm} setField={setField} />
          </FormSection>

          <FormSection title="Other address note" cols={1}>
            <div>
              <textarea
                value={coreForm.address}
                onChange={e => setField('address')(e.target.value)}
                rows={2}
                placeholder="Anything that doesn't fit above (landmark, current rented room…)"
                className={INPUT_CLASS}
              />
            </div>
          </FormSection>

          <FormSection title="Family">
            <TextField label="Father's name" value={coreForm.father_name} onChange={setField('father_name')} />
            <TextField label="Mother's name" value={coreForm.mother_name} onChange={setField('mother_name')} />
            <TextField label="Grandfather's name" value={coreForm.grandfather_name} onChange={setField('grandfather_name')} />
            <TextField label="Spouse's name" value={coreForm.spouse_name} onChange={setField('spouse_name')} />
          </FormSection>

          <FormSection title="Emergency contact">
            <TextField label="Name" value={coreForm.emergency_contact_name} onChange={setField('emergency_contact_name')} />
            <TextField
              label="Relationship"
              value={coreForm.emergency_contact_relationship}
              onChange={setField('emergency_contact_relationship')}
            />
            <TextField label="Mobile no." value={coreForm.emergency_contact_phone} onChange={setField('emergency_contact_phone')} />
            <TextField label="Address" value={coreForm.emergency_contact_address} onChange={setField('emergency_contact_address')} />
          </FormSection>

          <FormSection
            title="Payroll & statutory"
            hint="Basic Salary is set on the Payroll page. The PF / SSF / TDS contribution rates are company-wide now — set them on Payroll › Salary Structure."
            cols={3}
          >
            <TextField label="PAN No." value={coreForm.pan_no} onChange={setField('pan_no')} />
            <TextField label="SSF No." value={coreForm.ssf_no} onChange={setField('ssf_no')} />
            <TextField label="Allowance" type="number" min="0" step="0.01" value={coreForm.allowance} onChange={setField('allowance')} />
          </FormSection>

          <button
            type="submit"
            disabled={savingCore}
            className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {savingCore ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}

      <EmployeeHistory employeeId={employee.id} joinedOn={employee.date_of_joining} reloadKey={historyVersion} />

      <EmployeeSeparation employee={employee} onEmployeeChanged={reload} />

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Skills</h2>
          <button onClick={() => setShowSkillForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {employee.skills.map(skill => (
            <span key={skill} className="flex items-center gap-1 rounded-full bg-good-bg px-3 py-1 text-xs font-medium text-good-text">
              {skill}
              <button onClick={() => removeSkill(skill)} className="text-good-text/60 hover:text-good-text">
                ×
              </button>
            </span>
          ))}
          {employee.skills.length === 0 && <p className="text-xs text-slate-400">No skills added yet.</p>}
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Education</h2>
            {highest && <p className="text-xs text-slate-400">Highest qualification: {degreeLabel(highest.degree)}</p>}
          </div>
          <button onClick={() => setShowEducationForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        {education.length === 0 && <p className="text-xs text-slate-400">No education entries yet.</p>}
        <ul className="divide-y divide-slate-100">
          {education.map(ed => (
            <li key={ed.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-ink">{degreeLabel(ed.degree)}</span>
                {(ed.institution || ed.board_university || ed.year) && (
                  <span className="text-slate-500">
                    {' '}
                    — {[ed.institution, ed.board_university, formatPassingYear(ed)].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
              <button onClick={() => handleDeleteEducation(ed.id)} className="text-xs font-medium text-critical hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Training & Certification</h2>
          <button onClick={() => setShowTrainingForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        {training.length === 0 && <p className="text-xs text-slate-400">No training recorded yet.</p>}
        <ul className="divide-y divide-slate-100">
          {training.map(t => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-ink">{t.title}</span>
                {t.provider && <span className="text-slate-500"> — {t.provider}</span>}
                {(t.start_date || t.end_date) && (
                  <div className="text-xs text-slate-400">
                    {t.start_date ? formatAdDate(t.start_date, system) : '—'}
                    {t.end_date ? ` – ${formatAdDate(t.end_date, system)}` : ''}
                  </div>
                )}
              </div>
              <button onClick={() => handleDeleteTraining(t.id)} className="text-xs font-medium text-critical hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Work Experience</h2>
          <button onClick={() => setShowExperienceForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        {summary.total > 0 && (
          <InfoBox className="mb-3">
            <Info label="Before joining">{formatDuration(summary.previous)}</Info>
            <Info label="With this company">{formatDuration(summary.here)}</Info>
            <Info label="Total work experience">
              <span className="font-semibold">{formatDuration(summary.total)}</span>
            </Info>
          </InfoBox>
        )}
        {experience.length === 0 && <p className="text-xs text-slate-400">No work experience entries yet.</p>}
        <ul className="divide-y divide-slate-100">
          {experience.map(exp => (
            <li key={exp.id} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-ink">{exp.employer}</span>
                  {exp.role && <span className="text-slate-500"> — {exp.role}</span>}
                </div>
                <button onClick={() => handleDeleteExperience(exp.id)} className="text-xs font-medium text-critical hover:underline">
                  Remove
                </button>
              </div>
              {exp.description && <p className="mt-1 text-xs text-slate-500">{exp.description}</p>}
              {(exp.start_date || exp.end_date) && (
                <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {formatAdDate(exp.start_date, system)} – {exp.end_date ? formatAdDate(exp.end_date, system) : 'Present'}
                  </span>
                  {tenureDays(exp.start_date, exp.end_date) !== null && (
                    <span>{tenureDays(exp.start_date, exp.end_date)} days</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <EmployeePerformance employeeId={employee.id} managerName={manager?.name ?? null} />

      <EmployeeConduct employeeId={employee.id} />

      <EmployeeDocuments employeeId={employee.id} companyId={employee.company_id ?? null} />

      {showEducationForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddEducation} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Education</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Qualification</label>
            <select
              required
              value={educationForm.degree}
              onChange={e => setEducationForm(f => ({ ...f, degree: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="" disabled>Select qualification</option>
              <option value="Under SEE">Under SEE</option>
              <option value="SEE">SEE</option>
              <option value="Intermediate">Intermediate (+2)</option>
              <option value="Bachelors">Bachelor</option>
              <option value="Masters">Master</option>
            </select>
            <label className="mb-1 block text-xs font-medium text-slate-600">Institution</label>
            <input
              value={educationForm.institution}
              onChange={e => setEducationForm(f => ({ ...f, institution: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Board / University</label>
            <input
              value={educationForm.board_university}
              onChange={e => setEducationForm(f => ({ ...f, board_university: e.target.value }))}
              placeholder="e.g. NEB, Tribhuvan University"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Passing year</label>
            <div className="mb-3 flex gap-2">
              <input
                type="number"
                value={educationForm.year}
                onChange={e => setEducationForm(f => ({ ...f, year: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <select
                aria-label="Year calendar"
                value={educationForm.year_calendar}
                onChange={e => setEducationForm(f => ({ ...f, year_calendar: e.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="AD">AD</option>
                <option value="BS">BS</option>
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEducationForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEducation}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingEducation ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showTrainingForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddTraining} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Training / Certification</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Training name</label>
            <input
              required
              autoFocus
              value={trainingForm.title}
              onChange={e => setTrainingForm(f => ({ ...f, title: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Provider</label>
            <input
              value={trainingForm.provider}
              onChange={e => setTrainingForm(f => ({ ...f, provider: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
                <DatePicker value={trainingForm.start_date} onChange={v => setTrainingForm(f => ({ ...f, start_date: v }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
                <DatePicker value={trainingForm.end_date} onChange={v => setTrainingForm(f => ({ ...f, end_date: v }))} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTrainingForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingTraining}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingTraining ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showExperienceForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddExperience} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Work Experience</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Previous employer</label>
            <input
              required
              value={experienceForm.employer}
              onChange={e => setExperienceForm(f => ({ ...f, employer: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Previous designation</label>
            <input
              value={experienceForm.role}
              onChange={e => setExperienceForm(f => ({ ...f, role: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
            <textarea
              value={experienceForm.description}
              onChange={e => setExperienceForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
                <DatePicker value={experienceForm.start_date} onChange={v => setExperienceForm(f => ({ ...f, start_date: v }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
                <DatePicker value={experienceForm.end_date} onChange={v => setExperienceForm(f => ({ ...f, end_date: v }))} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExperienceForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingExperience}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingExperience ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showSkillForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={addSkill} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Skill</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
            <select
              value={skillCategory}
              onChange={e => setSkillCategory(e.target.value as (typeof SKILL_CATEGORIES)[number])}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {SKILL_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs font-medium text-slate-600">Value</label>
            <input
              autoFocus
              required
              value={skillInput}
              onChange={e => setSkillInput(e.target.value)}
              placeholder="e.g. English, Forklift license…"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSkillForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
              >
                Add
              </button>
            </div>
          </form>
        </div>
      )}

      {pendingPhotoFile && (
        <PhotoCropModal
          file={pendingPhotoFile}
          saving={uploadingPhoto}
          onCancel={() => setPendingPhotoFile(null)}
          onSave={handlePhotoCropped}
        />
      )}
    </>
  );
}

// --- Small building blocks ---------------------------------------------------
// Defined out here (not inside the page) so typing in a field never remounts it.

// Each cell draws its own right and bottom rule, and the grid is pulled 1px
// out of its clipping frame so the outer edge isn't ruled twice. Unlike a
// grey-background-with-gaps grid, a last row with fewer cells just ends
// instead of leaving a grey hole.
function Info({ label, children, wide }: { label: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-white p-3 shadow-[inset_-1px_-1px_0_#e2e8f0] ${wide ? 'col-span-2 sm:col-span-3' : ''}`}>
      <span className="block text-xs text-slate-400">{label}</span>
      <span className="text-ink">{children || '—'}</span>
    </div>
  );
}

function InfoBox({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 ${className}`}>
      <div className="-mb-px -mr-px grid grid-cols-2 text-sm sm:grid-cols-3">{children}</div>
    </div>
  );
}

function InfoGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <InfoBox>{children}</InfoBox>
    </div>
  );
}

function FormSection({
  title,
  hint,
  action,
  first,
  cols = 2,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  first?: boolean;
  cols?: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  const grid = cols === 3 ? 'sm:grid-cols-3' : cols === 1 ? '' : 'sm:grid-cols-2';
  return (
    <section className={first ? 'mt-3' : 'mt-5 border-t border-slate-100 pt-4'}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {hint && <p className="-mt-2 mb-3 text-xs text-slate-400">{hint}</p>}
      <div className={`grid grid-cols-1 gap-3 ${grid}`}>{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required,
  hint,
  placeholder,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  min?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        required={required}
        min={min}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function SelectField({
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
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLASS}>
        {children}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <DatePicker value={value} onChange={onChange} />
    </div>
  );
}

function AddressFields({
  kind,
  form,
  setField,
}: {
  kind: 'permanent' | 'temporary';
  form: CoreForm;
  setField: (key: CoreKey) => (value: string) => void;
}) {
  const province = form[`${kind}_province`];
  return (
    <>
      <SelectField label="Province" value={province} onChange={setField(`${kind}_province`)}>
        <option value="">Not set</option>
        {province && !(NEPAL_PROVINCES as readonly string[]).includes(province) && <option value={province}>{province}</option>}
        {NEPAL_PROVINCES.map(p => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </SelectField>
      <TextField label="District" value={form[`${kind}_district`]} onChange={setField(`${kind}_district`)} />
      <TextField label="Municipality" value={form[`${kind}_municipality`]} onChange={setField(`${kind}_municipality`)} />
      <TextField label="Ward no." value={form[`${kind}_ward`]} onChange={setField(`${kind}_ward`)} />
      <TextField label="Tole" value={form[`${kind}_tole`]} onChange={setField(`${kind}_tole`)} />
    </>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
