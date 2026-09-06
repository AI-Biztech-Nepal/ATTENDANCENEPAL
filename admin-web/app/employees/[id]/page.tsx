'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { SKILL_CATEGORIES } from '@/lib/skillCategories';
import type { Branch, Department, Employee, EmployeeEducation, EmployeeWorkExperience } from '@/lib/types';

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

const EMPTY_EDUCATION_FORM = { degree: '', institution: '', year: '' };
const EMPTY_EXPERIENCE_FORM = { employer: '', role: '', description: '', start_date: '', end_date: '' };
const EMPTY_CORE_FORM = {
  name: '',
  username: '',
  email: '',
  phone: '',
  gender: '',
  department: '',
  designation: '',
  branch_id: '',
  date_of_joining: '',
  address: '',
  emergency_contact_name: '',
  emergency_contact_relationship: '',
  emergency_contact_phone: '',
  pan_no: '',
  ssf_no: '',
  allowance: '',
};

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

export default function EmployeeCvPage() {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const params = useParams<{ id: string }>();
  const employeeId = params.id;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingCore, setEditingCore] = useState(false);
  const [coreForm, setCoreForm] = useState(EMPTY_CORE_FORM);
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

  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE_FORM);
  const [savingExperience, setSavingExperience] = useState(false);

  const [generatingPdf, setGeneratingPdf] = useState(false);

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
          setCoreForm({
            name: data.name ?? '',
            username: data.username ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            gender: data.gender ?? '',
            department: data.department ?? '',
            designation: data.designation ?? '',
            branch_id: data.branch_id ?? '',
            date_of_joining: data.date_of_joining ?? '',
            address: data.address ?? '',
            emergency_contact_name: data.emergency_contact_name ?? '',
            emergency_contact_relationship: data.emergency_contact_relationship ?? '',
            emergency_contact_phone: data.emergency_contact_phone ?? '',
            pan_no: data.pan_no ?? '',
            ssf_no: data.ssf_no ?? '',
            allowance: data.allowance != null ? String(data.allowance) : '',
          });
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
      .from('employee_education')
      .select('*')
      .eq('employee_id', employeeId)
      .order('year', { ascending: false })
      .then(({ data }) => setEducation(data ?? []));
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

  async function handleSaveCore(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingCore(true);
    const { error } = await supabase
      .from('employees')
      .update({
        name: coreForm.name,
        username: coreForm.username || null,
        email: coreForm.email || null,
        phone: coreForm.phone || null,
        gender: coreForm.gender || null,
        department: coreForm.department || null,
        designation: coreForm.designation || null,
        branch_id: coreForm.branch_id || null,
        date_of_joining: coreForm.date_of_joining || null,
        address: coreForm.address || null,
        emergency_contact_name: coreForm.emergency_contact_name || null,
        emergency_contact_relationship: coreForm.emergency_contact_relationship || null,
        emergency_contact_phone: coreForm.emergency_contact_phone || null,
        pan_no: coreForm.pan_no || null,
        ssf_no: coreForm.ssf_no || null,
        allowance: coreForm.allowance ? Number(coreForm.allowance) : null,
      })
      .eq('id', employee.id);
    setSavingCore(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setEditingCore(false);
    reload();
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
      if (employee!.profile_photo_url) {
        const dataUrl = await toDataUrl(employee!.profile_photo_url);
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
      doc.text(employee!.name, textStartX, y + 8);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text([employee!.designation, employee!.department].filter(Boolean).join(' · ') || '—', textStartX, y + 15);
      doc.setFontSize(9);
      doc.setTextColor(100);
      const contactLine = [employee!.phone, employee!.email, branch?.name].filter(Boolean).join('   ·   ');
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

      sectionHeading('Employment');
      const days = tenureDays(employee!.date_of_joining, employee!.resigned_at);
      const employmentLines = [
        `Employee code: ${employee!.employee_code}`,
        employee!.fingerprint_id ? `Biometric / Registration ID: ${employee!.fingerprint_id}` : null,
        `Date of joining: ${employee!.date_of_joining ?? '—'}`,
        days !== null ? `Tenure: ${days} days${employee!.resigned_at ? ' (resigned ' + employee!.resigned_at + ')' : ''}` : null,
        employee!.pan_no ? `PAN No.: ${employee!.pan_no}` : null,
        employee!.ssf_no ? `SSF No.: ${employee!.ssf_no}` : null,
        employee!.address ? `Address: ${employee!.address}` : null,
      ].filter(Boolean) as string[];
      for (const line of employmentLines) {
        ensureSpace(6);
        doc.text(line, marginX, y);
        y += 6;
      }
      y += 4;

      if (education.length > 0) {
        sectionHeading('Education');
        for (const ed of education) {
          ensureSpace(6);
          const line = [ed.degree, ed.institution, ed.year ? String(ed.year) : null].filter(Boolean).join(' — ');
          const wrapped = doc.splitTextToSize(line, contentWidth);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 5 + 2;
        }
        y += 2;
      }

      if (experience.length > 0) {
        sectionHeading('Work Experience');
        for (const exp of experience) {
          ensureSpace(6);
          const dates = [exp.start_date, exp.end_date ?? 'Present'].filter(Boolean).join(' – ');
          const line = [exp.employer, exp.role, dates].filter(Boolean).join(' — ');
          const wrapped = doc.splitTextToSize(line, contentWidth);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 5 + 2;
        }
        y += 2;
      }

      if (employee!.skills.length > 0) {
        sectionHeading('Skills');
        const wrapped = doc.splitTextToSize(employee!.skills.join(', '), contentWidth);
        doc.text(wrapped, marginX, y);
        y += wrapped.length * 5 + 2;
      }

      if (employee!.emergency_contact_name || employee!.emergency_contact_phone) {
        sectionHeading('Emergency Contact');
        const line = [employee!.emergency_contact_name, employee!.emergency_contact_relationship, employee!.emergency_contact_phone]
          .filter(Boolean)
          .join(' — ');
        doc.text(line, marginX, y);
        y += 6;
      }

      doc.save(`${employee!.name.replace(/\s+/g, '_')}_CV.pdf`);
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Employee CV">
        <p className="text-sm text-slate-400">Loading…</p>
      </AppShell>
    );
  }

  if (!employee) {
    return (
      <AppShell title="Employee CV">
        <p className="text-sm text-warning-text">Employee not found.</p>
      </AppShell>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);

  return (
    <AppShell title="Employee CV">
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
          <div className="mb-5 flex items-center gap-4">
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
              <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
                {employee.name}
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

          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-sm sm:grid-cols-3">
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">Employee code</span>
              <span className="text-ink">{employee.employee_code}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">Username</span>
              <span className="text-ink">{employee.username || '—'}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">Biometric / Registration ID</span>
              <span className="text-ink">{employee.fingerprint_id ?? '—'}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">Gender</span>
              <span className="text-ink capitalize">{employee.gender ?? '—'}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">Date of joining</span>
              <span className="text-ink">{formatAdDate(employee.date_of_joining, system)}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">{employee.resigned_at ? 'Days worked' : 'Days with company'}</span>
              <span className="text-ink">{days !== null ? `${days} days` : '—'}</span>
            </div>
            {employee.resigned_at && (
              <div className="bg-white p-3">
                <span className="block text-xs text-slate-400">Resigned</span>
                <span className="text-ink">{formatAdDate(employee.resigned_at, system)}</span>
              </div>
            )}
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">PAN No.</span>
              <span className="text-ink">{employee.pan_no || '—'}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">SSF No.</span>
              <span className="text-ink">{employee.ssf_no || '—'}</span>
            </div>
            <div className="bg-white p-3">
              <span className="block text-xs text-slate-400">Allowance</span>
              <span className="text-ink">{employee.allowance != null ? employee.allowance.toLocaleString() : '—'}</span>
            </div>
            <div className="col-span-2 bg-white p-3 sm:col-span-3">
              <span className="block text-xs text-slate-400">Address</span>
              <span className="text-ink">{employee.address || '—'}</span>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <span className="mb-1 block text-xs text-slate-400">Emergency contact</span>
            {employee.emergency_contact_name || employee.emergency_contact_phone ? (
              <span className="text-ink">
                {[employee.emergency_contact_name, employee.emergency_contact_relationship, employee.emergency_contact_phone]
                  .filter(Boolean)
                  .join(' — ')}
              </span>
            ) : (
              <span className="text-xs text-slate-400">Not set — click Edit to add one.</span>
            )}
          </div>
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

          <div className="mb-4 flex items-center justify-between">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Full name</label>
              <input
                required
                value={coreForm.name}
                onChange={e => setCoreForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Username</label>
              <input
                value={coreForm.username}
                onChange={e => setCoreForm(f => ({ ...f, username: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
              <input
                type="email"
                value={coreForm.email}
                onChange={e => setCoreForm(f => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
              <input
                value={coreForm.phone}
                onChange={e => setCoreForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Gender</label>
              <select
                value={coreForm.gender}
                onChange={e => setCoreForm(f => ({ ...f, gender: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Department</label>
              <select
                value={coreForm.department}
                onChange={e => setCoreForm(f => ({ ...f, department: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {coreForm.department && !departmentOptions.some(d => d.name === coreForm.department) && (
                  <option value={coreForm.department}>{coreForm.department}</option>
                )}
                {departmentOptions.map(d => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Designation</label>
              <input
                value={coreForm.designation}
                onChange={e => setCoreForm(f => ({ ...f, designation: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Branch</label>
              <select
                value={coreForm.branch_id}
                onChange={e => setCoreForm(f => ({ ...f, branch_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Date of joining</label>
              <DatePicker value={coreForm.date_of_joining} onChange={v => setCoreForm(f => ({ ...f, date_of_joining: v }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">PAN No.</label>
              <input
                value={coreForm.pan_no}
                onChange={e => setCoreForm(f => ({ ...f, pan_no: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">SSF No.</label>
              <input
                value={coreForm.ssf_no}
                onChange={e => setCoreForm(f => ({ ...f, ssf_no: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
              <textarea
                value={coreForm.address}
                onChange={e => setCoreForm(f => ({ ...f, address: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <h2 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-sm font-semibold text-ink">Salary</h2>
          <p className="mb-3 -mt-2 text-xs text-slate-400">
            Basic Salary is set on the Payroll page. The PF / SSF / TDS contribution rates are company-wide now — set them on
            Payroll &rsaquo; Salary Structure.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Allowance</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={coreForm.allowance}
                onChange={e => setCoreForm(f => ({ ...f, allowance: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <h2 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-sm font-semibold text-ink">Emergency Contact</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
              <input
                value={coreForm.emergency_contact_name}
                onChange={e => setCoreForm(f => ({ ...f, emergency_contact_name: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Relationship</label>
              <input
                value={coreForm.emergency_contact_relationship}
                onChange={e => setCoreForm(f => ({ ...f, emergency_contact_relationship: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
              <input
                value={coreForm.emergency_contact_phone}
                onChange={e => setCoreForm(f => ({ ...f, emergency_contact_phone: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingCore}
            className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {savingCore ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}

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
          <h2 className="text-sm font-semibold text-ink">Education</h2>
          <button onClick={() => setShowEducationForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        {education.length === 0 && <p className="text-xs text-slate-400">No education entries yet.</p>}
        <ul className="divide-y divide-slate-100">
          {education.map(ed => (
            <li key={ed.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-ink">{ed.degree}</span>
                {(ed.institution || ed.year) && (
                  <span className="text-slate-500"> — {[ed.institution, ed.year ? String(ed.year) : null].filter(Boolean).join(', ')}</span>
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
          <h2 className="text-sm font-semibold text-ink">Work Experience</h2>
          <button onClick={() => setShowExperienceForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
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

      {showEducationForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddEducation} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Education</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Degree</label>
            <select
              required
              value={educationForm.degree}
              onChange={e => setEducationForm(f => ({ ...f, degree: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="" disabled>Select degree</option>
              <option value="Under SEE">Under SEE</option>
              <option value="SEE">SEE</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Bachelors">Bachelors</option>
              <option value="Masters">Masters</option>
            </select>
            <label className="mb-1 block text-xs font-medium text-slate-600">Institution</label>
            <input
              value={educationForm.institution}
              onChange={e => setEducationForm(f => ({ ...f, institution: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Year</label>
            <input
              type="number"
              value={educationForm.year}
              onChange={e => setEducationForm(f => ({ ...f, year: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
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

      {showExperienceForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddExperience} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Work Experience</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Employer</label>
            <input
              required
              value={experienceForm.employer}
              onChange={e => setExperienceForm(f => ({ ...f, employer: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Role</label>
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
    </AppShell>
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
