'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { EditIcon } from '@/components/employee/parts';
import FormDialog from '@/components/employee/FormDialog';
import RowMenu from '@/components/employee/RowMenu';
import SectionDialog from '@/components/profile/SectionDialog';
import DatePicker from '@/components/DatePicker';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { SKILL_CATEGORIES } from '@/lib/skillCategories';
import type { Branch, Employee, EmployeeEducation, EmployeeWorkExperience } from '@/lib/types';
import { ProfileTabs, type ProfileTab } from '@/components/profile/ProfileParts';
import MyEmploymentCards from '@/components/employee/hris/MyEmploymentCards';
import MyRecords from '@/components/employee/hris/MyRecords';
import MyDocuments from '@/components/employee/hris/MyDocuments';
import MyExit from '@/components/employee/hris/MyExit';
import { DOCUMENT_TYPES, type EmployeeDocument } from '@/lib/employeeDocuments';
import { degreeLabel, experienceSummary, formatDuration, formatPassingYear, highestQualification } from '@/lib/employeeProfile';
import type { EmployeeSeparation } from '@/lib/employeeSeparation';

const EMPTY_PROFILE_FORM = { name: '', email: '', phone: '', address: '', department: '', designation: '' };
const EMPTY_EMERGENCY_FORM = { emergency_contact_name: '', emergency_contact_relationship: '', emergency_contact_phone: '' };
const EMPTY_EDUCATION_FORM = { degree: '', institution: '', board_university: '', year: '', year_calendar: 'AD' };
const EMPTY_EXPERIENCE_FORM = { employer: '', role: '', description: '', start_date: '', end_date: '' };

const CARD = 'rounded-2xl border border-slate-200 bg-white p-4 lg:rounded-[20px] lg:p-6';
const CARD_TITLE = 'text-base font-extrabold lg:text-xl lg:leading-6';
const INPUT = 'h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium';
const TEXTAREA = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium';
const LABEL = 'mb-1.5 block text-xs font-bold text-slate-600';

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

export default function MyProfilePage() {
  usePageTitle('Profile');
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // The rest of what HR keeps on file, read only. `undefined` = still loading, null = couldn't be read.
  const [tab, setTab] = useState<'overview' | 'records' | 'documents' | 'exit'>('overview');
  const [docs, setDocs] = useState<EmployeeDocument[] | null | undefined>(undefined);
  const [sep, setSep] = useState<EmployeeSeparation | null | undefined>(undefined);
  const [managerName, setManagerName] = useState<string | null>(null);

  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [showDetails, setShowDetails] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);

  const [emergencyForm, setEmergencyForm] = useState(EMPTY_EMERGENCY_FORM);

  const [skillCategory, setSkillCategory] = useState<(typeof SKILL_CATEGORIES)[number]>(SKILL_CATEGORIES[0]);
  const [skillInput, setSkillInput] = useState('');
  const [skillError, setSkillError] = useState<string | null>(null);

  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationForm, setEducationForm] = useState(EMPTY_EDUCATION_FORM);
  const [editingEducationId, setEditingEducationId] = useState<string | null>(null);
  const [savingEducation, setSavingEducation] = useState(false);

  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);
  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE_FORM);
  const [editingExperienceId, setEditingExperienceId] = useState<string | null>(null);
  const [savingExperience, setSavingExperience] = useState(false);

  function reload(empId: string) {
    supabase
      .from('employees')
      .select('*')
      .eq('id', empId)
      .single()
      .then(({ data }) => {
        if (data) {
          // skills is a new column — normalize to [] if the migration adding
          // it hasn't been run yet, so the page degrades instead of crashing.
          setEmployee({ ...data, skills: data.skills ?? [] });
          setProfileForm({
            name: data.name ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            address: data.address ?? '',
            department: data.department ?? '',
            designation: data.designation ?? '',
          });
          setEmergencyForm({
            emergency_contact_name: data.emergency_contact_name ?? '',
            emergency_contact_relationship: data.emergency_contact_relationship ?? '',
            emergency_contact_phone: data.emergency_contact_phone ?? '',
          });
        }
      });
    supabase
      .from('employee_education')
      .select('*')
      .eq('employee_id', empId)
      .order('year', { ascending: false })
      .then(({ data }) => setEducation(data ?? []));
    supabase
      .from('employee_work_experience')
      .select('*')
      .eq('employee_id', empId)
      .order('start_date', { ascending: false })
      .then(({ data }) => setExperience(data ?? []));
  }

  // Each read may fail — before the latest migration the policies aren't there — and
  // that tab then says it isn't available instead of breaking the page.
  function loadHris(empId: string) {
    supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => setDocs(error ? null : ((data ?? []) as EmployeeDocument[])));
    supabase
      .from('employee_separations')
      .select('*')
      .eq('employee_id', empId)
      .maybeSingle()
      .then(({ data, error }) => setSep(error ? null : ((data as EmployeeSeparation | null) ?? null)));
    supabase.rpc('my_reporting_manager').then(({ data, error }) => setManagerName(error ? null : ((data as string | null) ?? null)));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (profile?.employee_id) {
        reload(profile.employee_id);
        loadHris(profile.employee_id);
      }
    });
    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));
  }, []);

  // update_my_profile() replaces the whole editable row at once, so every
  // call passes the full current state — only the field actually being
  // changed differs from what's already there (profileForm/emergencyForm are
  // kept in sync via reload() after each save, same as the photo-only save
  // below relies on profileForm already reflecting saved values).
  async function saveProfile(overrides: { photoUrl?: string | null; skills?: string[]; emergency?: typeof EMPTY_EMERGENCY_FORM } = {}) {
    const emergency = overrides.emergency ?? emergencyForm;
    const { error } = await supabase.rpc('update_my_profile', {
      p_name: profileForm.name,
      p_email: profileForm.email || null,
      p_phone: profileForm.phone || null,
      p_address: profileForm.address || null,
      p_department: profileForm.department || null,
      p_designation: profileForm.designation || null,
      p_photo_url: overrides.photoUrl !== undefined ? overrides.photoUrl : employee?.profile_photo_url ?? null,
      p_skills: overrides.skills ?? employee?.skills ?? [],
      p_emergency_contact_name: emergency.emergency_contact_name || null,
      p_emergency_contact_relationship: emergency.emergency_contact_relationship || null,
      p_emergency_contact_phone: emergency.emergency_contact_phone || null,
    });
    return error;
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    const error = await saveProfile();
    setSavingProfile(false);
    if (error) {
      setProfileError(error.message);
      return;
    }
    setProfileSaved(true);
    setShowDetails(false);
    reload(employee.id);
  }

  function detailsFromEmployee(emp: Employee) {
    return {
      name: emp.name ?? '',
      email: emp.email ?? '',
      phone: emp.phone ?? '',
      address: emp.address ?? '',
      department: emp.department ?? '',
      designation: emp.designation ?? '',
    };
  }

  function emergencyFromEmployee(emp: Employee) {
    return {
      emergency_contact_name: emp.emergency_contact_name ?? '',
      emergency_contact_relationship: emp.emergency_contact_relationship ?? '',
      emergency_contact_phone: emp.emergency_contact_phone ?? '',
    };
  }

  function startEditDetails() {
    if (!employee) return;
    setProfileForm(detailsFromEmployee(employee));
    setEmergencyForm(emergencyFromEmployee(employee));
    setProfileError(null);
    setProfileSaved(false);
    setShowDetails(true);
  }

  function cancelEditDetails() {
    if (!employee) return;
    setProfileForm(detailsFromEmployee(employee));
    setEmergencyForm(emergencyFromEmployee(employee));
    setProfileError(null);
    setShowDetails(false);
  }

  async function addSkill(e?: React.FormEvent) {
    e?.preventDefault();
    const value = skillInput.trim();
    if (!value || !employee) return;
    setSkillError(null);
    const skill = `${skillCategory}: ${value}`;
    if (employee.skills.includes(skill)) {
      setSkillInput('');
      return;
    }
    const error = await saveProfile({ skills: [...employee.skills, skill] });
    if (error) {
      setSkillError(`Could not add skill: ${error.message}`);
      return;
    }
    setSkillInput('');
    reload(employee.id);
  }

  async function removeSkill(skill: string) {
    if (!employee) return;
    setSkillError(null);
    const error = await saveProfile({ skills: employee.skills.filter(s => s !== skill) });
    if (error) {
      setSkillError(`Could not remove skill: ${error.message}`);
      return;
    }
    reload(employee.id);
  }

  function openAddEducation() {
    setEditingEducationId(null);
    setEducationForm(EMPTY_EDUCATION_FORM);
    setShowEducationForm(true);
  }

  function openEditEducation(ed: EmployeeEducation) {
    setEditingEducationId(ed.id);
    setEducationForm({
      degree: ed.degree,
      institution: ed.institution ?? '',
      board_university: ed.board_university ?? '',
      year: ed.year ? String(ed.year) : '',
      year_calendar: ed.year_calendar ?? 'AD',
    });
    setShowEducationForm(true);
  }

  async function handleSaveEducation(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingEducation(true);
    const row = {
      degree: educationForm.degree,
      institution: educationForm.institution || null,
      board_university: educationForm.board_university || null,
      year: educationForm.year ? Number(educationForm.year) : null,
      year_calendar: educationForm.year_calendar,
    };
    const { error } = editingEducationId
      ? await supabase.from('employee_education').update(row).eq('id', editingEducationId)
      : await supabase.from('employee_education').insert({ ...row, employee_id: employee.id });
    setSavingEducation(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setEducationForm(EMPTY_EDUCATION_FORM);
    setEditingEducationId(null);
    setShowEducationForm(false);
    reload(employee.id);
  }

  async function handleDeleteEducation(id: string) {
    if (!employee) return;
    if (!(await confirm('Remove this education entry?', { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from('employee_education').delete().eq('id', id);
    reload(employee.id);
  }

  function openAddExperience() {
    setEditingExperienceId(null);
    setExperienceForm(EMPTY_EXPERIENCE_FORM);
    setShowExperienceForm(true);
  }

  function openEditExperience(exp: EmployeeWorkExperience) {
    setEditingExperienceId(exp.id);
    setExperienceForm({
      employer: exp.employer,
      role: exp.role ?? '',
      description: exp.description ?? '',
      start_date: exp.start_date ?? '',
      end_date: exp.end_date ?? '',
    });
    setShowExperienceForm(true);
  }

  async function handleSaveExperience(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingExperience(true);
    const row = {
      employer: experienceForm.employer,
      role: experienceForm.role || null,
      description: experienceForm.description || null,
      start_date: experienceForm.start_date || null,
      end_date: experienceForm.end_date || null,
    };
    const { error } = editingExperienceId
      ? await supabase.from('employee_work_experience').update(row).eq('id', editingExperienceId)
      : await supabase.from('employee_work_experience').insert({ ...row, employee_id: employee.id });
    setSavingExperience(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setExperienceForm(EMPTY_EXPERIENCE_FORM);
    setEditingExperienceId(null);
    setShowExperienceForm(false);
    reload(employee.id);
  }

  async function handleDeleteExperience(id: string) {
    if (!employee) return;
    if (!(await confirm('Remove this work experience entry?', { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from('employee_work_experience').delete().eq('id', id);
    reload(employee.id);
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
    try {
      const path = `employee-photos/${employee.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, blob, {
        contentType: 'image/jpeg',
      });
      if (uploadError) {
        alert(`Photo upload failed: ${uploadError.message}`);
        return;
      }
      const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
      const rpcError = await saveProfile({ photoUrl: publicUrl.publicUrl });
      if (rpcError) {
        alert(`Could not save photo: ${rpcError.message}`);
        return;
      }
      setPendingPhotoFile(null);
      reload(employee.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function updateField(key: keyof typeof EMPTY_PROFILE_FORM, value: string) {
    setProfileForm(f => ({ ...f, [key]: value }));
    setProfileSaved(false);
  }

  if (loading) {
    return (
      <>
        <p className="p-4 text-center text-sm text-slate-500">Loading…</p>
      </>
    );
  }

  if (!employee) {
    return (
      <>
        <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      </>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);
  const branchName = branches.find(b => b.id === employee.branch_id)?.name ?? null;
  const joined = formatAdDate(employee.date_of_joining, system);
  const daysText = days !== null ? `${days} days` : '—';
  const daysLabel = employee.resigned_at ? 'Days worked' : 'With the company';
  const emergencySet = !!(employee.emergency_contact_name || employee.emergency_contact_phone);

  const haveDocs = docs ? DOCUMENT_TYPES.filter(t => docs.some(d => d.doc_type === t.value)).length : null;
  const profileTabs: ProfileTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: 'Records' },
    {
      id: 'documents',
      label: 'Documents',
      badge: haveDocs !== null ? { text: `${haveDocs} / ${DOCUMENT_TYPES.length}`, tone: haveDocs < DOCUMENT_TYPES.length ? 'warn' : 'good' } : undefined,
    },
    { id: 'exit', label: 'Exit' },
  ];
  const highest = highestQualification(education);
  const experienceTotals = experienceSummary(experience, employee.date_of_joining, employee.resigned_at);

  // Skills are stored as "Category: value"; the ones added from the phone app have no category.
  const skillGroups = (() => {
    const groups = new Map<string, { skill: string; value: string }[]>();
    for (const skill of employee.skills) {
      const i = skill.indexOf(': ');
      const category = i > 0 && (SKILL_CATEGORIES as readonly string[]).includes(skill.slice(0, i)) ? skill.slice(0, i) : 'Other';
      const list = groups.get(category) ?? [];
      list.push({ skill, value: category === 'Other' ? skill : skill.slice(i + 2) });
      groups.set(category, list);
    }
    return [...SKILL_CATEGORIES, 'Other'].filter(c => groups.has(c)).map(category => ({ category, items: groups.get(category)! }));
  })();

  const personalRows: [string, string][] = [
    ['Name', employee.name || '—'],
    ['Email', employee.email || '—'],
    ['Phone', employee.phone || '—'],
    ['Address', employee.address || '—'],
  ];
  const emergencyRows: [string, string][] = [
    ['Name', employee.emergency_contact_name || '—'],
    ['Relationship', employee.emergency_contact_relationship || '—'],
    ['Phone', employee.emergency_contact_phone || '—'],
  ];
  const employerRows: [string, string][] = [
    ['Username', employee.username || '—'],
    ['Branch', branchName ?? '—'],
    ['Department', employee.department || '—'],
    ['Designation', employee.designation || '—'],
    ['Current salary', employee.salary != null ? employee.salary.toLocaleString() : '—'],
    ['Allowance', employee.allowance != null ? employee.allowance.toLocaleString() : '—'],
    ['PAN No.', employee.pan_no || '—'],
    ['SSF No.', employee.ssf_no || '—'],
    ...(employee.resigned_at ? ([['Resigned', formatAdDate(employee.resigned_at, system)]] as [string, string][]) : []),
  ];
  // On a phone the same facts sit in one "My Details" card, in the app's order.
  const phoneEmployerRows: [string, string][] = [
    ['Username', employee.username || '—'],
    ['Enroll ID', employee.fingerprint_id || '—'],
    ['Branch', branchName ?? '—'],
    ['Department', employee.department || '—'],
    ['Designation', employee.designation || '—'],
    ['Current Salary', employee.salary != null ? employee.salary.toLocaleString() : '—'],
    ['Allowance', employee.allowance != null ? employee.allowance.toLocaleString() : '—'],
    ['PAN No.', employee.pan_no || '—'],
    ['SSF No.', employee.ssf_no || '—'],
    ['Date of joining', joined],
    [employee.resigned_at ? 'Days worked' : 'Days with company', daysText],
    ...(employee.resigned_at ? ([['Resigned', formatAdDate(employee.resigned_at, system)]] as [string, string][]) : []),
  ];

  const changedLabels = (
    [
      ['Name', profileForm.name !== (employee.name ?? '')],
      ['Email', profileForm.email !== (employee.email ?? '')],
      ['Phone', profileForm.phone !== (employee.phone ?? '')],
      ['Address', profileForm.address !== (employee.address ?? '')],
      ['Emergency name', emergencyForm.emergency_contact_name !== (employee.emergency_contact_name ?? '')],
      ['Emergency relationship', emergencyForm.emergency_contact_relationship !== (employee.emergency_contact_relationship ?? '')],
      ['Emergency phone', emergencyForm.emergency_contact_phone !== (employee.emergency_contact_phone ?? '')],
    ] as [string, boolean][]
  )
    .filter(([, changed]) => changed)
    .map(([label]) => label);

  async function requestCloseDetails() {
    if (changedLabels.length > 0 && !(await confirm('Discard your unsaved changes?', { title: 'Discard changes?', confirmLabel: 'Discard', tone: 'danger' }))) return;
    cancelEditDetails();
  }

  const editButtons = (
    <>
      {profileSaved && (
        <span role="status" className="mr-3 text-[13px] font-bold text-[#14532d]">
          Saved
        </span>
      )}
      <button
        type="button"
        onClick={startEditDetails}
        className="hidden h-10 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-4 text-[13px] font-extrabold text-brand hover:bg-slate-50 lg:flex"
      >
        <EditIcon className="h-3.5 w-3.5" />
        Edit
      </button>
      <button type="button" onClick={startEditDetails} className="flex h-11 items-center px-1 text-sm font-extrabold text-brand lg:hidden">
        Edit
      </button>
    </>
  );

  return (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      <div className="lg:px-8 lg:pb-10 lg:pt-7">
        <div className="mx-4 mt-4 pb-4 lg:mx-0 lg:mt-0 lg:pb-0">
          {/* Who you are: a centred card on a phone, a wide card with three facts on a computer. */}
          <section aria-label="Profile summary" className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-center lg:rounded-[20px] lg:text-left">
            <div aria-hidden="true" className="hidden h-[104px] bg-brand lg:block" />
            <div className="p-5 lg:flex lg:flex-wrap lg:items-start lg:gap-x-10 lg:gap-y-4 lg:px-8 lg:pb-7 lg:pt-0">
              <div className="flex flex-col items-center lg:min-w-0 lg:flex-[1_1_420px] lg:flex-row lg:items-start lg:gap-6">
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  aria-label="Change photo"
                  title="Change photo"
                  className="relative mb-3 h-[72px] w-[72px] shrink-0 rounded-full lg:-mt-[52px] lg:mb-0 lg:h-[104px] lg:w-[104px]"
                >
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-brand-light text-3xl font-extrabold text-brand lg:border-4 lg:border-white lg:text-[38px]">
                    {uploadingPhoto ? (
                      <span className="text-sm">…</span>
                    ) : employee.profile_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
                    ) : (
                      employee.name.slice(0, 1)
                    )}
                  </span>
                  <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-ink text-white lg:bottom-0 lg:-right-1 lg:h-9 lg:w-9">
                    <CameraIcon className="h-4 w-4" />
                  </span>
                </button>
                <div className="min-w-0 lg:mt-2.5">
                  <h2 className="text-lg font-extrabold lg:text-[28px] lg:leading-[34px] lg:tracking-[-0.01em]">{employee.name}</h2>
                  <p className="mt-0.5 text-[13px] font-semibold text-slate-600 lg:hidden">{employee.designation ?? '—'}</p>
                  <p className="text-xs text-slate-600 lg:hidden">{employee.department ?? '—'}</p>
                  <p className="mt-0.5 hidden text-[15px] font-semibold text-slate-600 lg:block">
                    {[employee.designation, employee.department, branchName ? `${branchName} branch` : null].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              </div>
              <dl className="hidden lg:flex lg:flex-wrap lg:gap-x-9 lg:gap-y-3 lg:pt-4">
                {[
                  ['Joined', joined],
                  [daysLabel, daysText],
                  ['Enroll ID', employee.fingerprint_id || '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[13px] font-semibold text-slate-600">{k}</dt>
                    <dd className="m-0 mt-0.5 text-lg font-extrabold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <div className="mt-3 lg:mt-6">
            <ProfileTabs tabs={profileTabs} active={tab} onChange={id => setTab(id as typeof tab)} />
          </div>

          <div hidden={tab !== 'overview'}>
            <div className="mt-3 flex flex-col gap-3 lg:mt-6 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] lg:items-start lg:gap-6">
              {/* Phone: one card for everything */}
              <section aria-label="My Details" className={`${CARD} lg:hidden`}>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className={CARD_TITLE}>My Details</h2>
                  <div className="flex items-center">{editButtons}</div>
                </div>
                {personalRows.map(([label, value]) => (
                  <PhoneRow key={label} label={label} value={value} />
                ))}
                <p className="mb-1 mt-3 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#586474]">Filled by employer</p>
                {phoneEmployerRows.map(([label, value]) => (
                  <PhoneRow key={label} label={label} value={value} />
                ))}
                <p className="mt-1 text-xs text-slate-500">Set by HR/Admin — not editable here.</p>
                <p className="mb-1 mt-3 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#586474]">Emergency contact</p>
                {emergencySet ? (
                  <PhoneRow
                    label="Contact"
                    value={[employee.emergency_contact_name, employee.emergency_contact_relationship, employee.emergency_contact_phone].filter(Boolean).join(' — ')}
                  />
                ) : (
                  <p className="text-xs text-slate-500">Not set — tap Edit to add one.</p>
                )}
              </section>

              {/* Computer: Personal, and what the employer set */}
              <section aria-label="Personal" className={`${CARD} hidden lg:block`}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className={CARD_TITLE}>Personal</h2>
                  <div className="flex items-center">{editButtons}</div>
                </div>
                {personalRows.map(([label, value]) => (
                  <DetailRow key={label} label={label} value={value} />
                ))}
                <p className="mb-1 mt-5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#586474]">Emergency contact</p>
                {emergencySet ? (
                  emergencyRows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)
                ) : (
                  <p className="border-t border-slate-100 pt-3 text-[13px] text-slate-500">Not set — click Edit to add one.</p>
                )}
              </section>

              <section aria-label="Set by your employer" className={`${CARD} hidden lg:block`}>
                <div className="mb-2 flex h-10 items-center justify-between">
                  <h2 className={CARD_TITLE}>Set by your employer</h2>
                  <LockIcon className="h-[18px] w-[18px] text-[#586474]" />
                </div>
                {employerRows.map(([label, value]) => (
                  <DetailRow key={label} label={label} value={value} />
                ))}
                <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">Set by HR/Admin — not editable here.</p>
              </section>

              <div className="flex min-w-0 flex-col gap-3 lg:gap-6">
                <section aria-label="Skills" className={CARD}>
                  <h2 className={CARD_TITLE}>Skills</h2>
                  {skillGroups.length === 0 && <p className="mt-2 text-[13px] text-slate-600">No skills added yet.</p>}
                  {skillGroups.map(group => (
                    <div key={group.category} className="mt-3 border-t border-slate-100 pt-3">
                      <div className="mb-2 text-[13px] font-bold text-slate-600">{group.category}</div>
                      <div className="flex flex-wrap gap-2">
                        {group.items.map(({ skill, value }) => (
                          <span key={skill} className="flex items-center gap-1 rounded-full bg-brand-light py-1.5 pl-3 pr-1.5 text-[13px] font-bold text-[#065f46]">
                            {value}
                            <button
                              type="button"
                              onClick={() => removeSkill(skill)}
                              aria-label={`Remove ${value}`}
                              className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none hover:bg-white/70"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <form onSubmit={addSkill} className="mt-3 border-t border-slate-100 pt-4">
                    <div role="group" aria-label="Skill category" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-[3px]">
                      {SKILL_CATEGORIES.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSkillCategory(c)}
                          aria-pressed={skillCategory === c}
                          className={`h-9 rounded-[9px] px-3 text-[13px] ${
                            skillCategory === c ? 'bg-white font-extrabold text-brand shadow-[0_1px_2px_rgba(15,23,42,0.12)]' : 'font-bold text-slate-600 hover:text-ink'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <input
                        aria-label="New skill"
                        required
                        value={skillInput}
                        onChange={e => setSkillInput(e.target.value)}
                        placeholder="e.g. English, Forklift license…"
                        className={`${INPUT} min-w-0 flex-1`}
                      />
                      <button type="submit" className="h-11 shrink-0 rounded-xl bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand/90">
                        Add
                      </button>
                    </div>
                    {skillError && (
                      <p role="alert" className="mt-2 text-[13px] font-semibold text-[#b91c1c]">
                        {skillError}
                      </p>
                    )}
                  </form>
                </section>


              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:mt-6 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] lg:items-start lg:gap-6">
              <MyEmploymentCards employee={employee} managerName={managerName} onSaved={() => reload(employee.id)} />
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
              <section aria-label="Education" className={CARD}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className={CARD_TITLE}>Education</h2>
                    {highest && <p className="text-xs font-semibold text-slate-600">Highest qualification: {degreeLabel(highest.degree)}</p>}
                  </div>
                  <button type="button" onClick={openAddEducation} className="flex h-11 items-center px-1 text-[13px] font-extrabold text-brand">
                    + Add
                  </button>
                </div>
                {education.length === 0 && <p className="mt-2 text-[13px] text-slate-500">No education entries yet.</p>}
                <ul className="mt-1 border-t border-slate-100">
                  {education.map(ed => (
                    <li key={ed.id} className="flex items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold">{degreeLabel(ed.degree)}</div>
                        {(ed.institution || ed.board_university || ed.year) && (
                          <div className="text-xs font-medium text-slate-600">{[ed.institution, ed.board_university, formatPassingYear(ed)].filter(Boolean).join(' · ')}</div>
                        )}
                      </div>
                      <RowMenu
                        label={ed.degree}
                        items={[
                          { label: 'Edit', onSelect: () => openEditEducation(ed) },
                          { label: 'Remove', danger: true, onSelect: () => handleDeleteEducation(ed.id) },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="Work Experience" className={CARD}>
                <div className="flex items-center justify-between">
                  <h2 className={CARD_TITLE}>Work Experience</h2>
                  <button type="button" onClick={openAddExperience} className="flex h-11 items-center px-1 text-[13px] font-extrabold text-brand">
                    + Add
                  </button>
                </div>
                {experienceTotals.total > 0 && (
                  <p className="mt-2 text-xs font-semibold text-slate-600">
                    Before joining {formatDuration(experienceTotals.previous)} · With this company {formatDuration(experienceTotals.here)} ·{' '}
                    <span className="font-extrabold text-ink">Total {formatDuration(experienceTotals.total)}</span>
                  </p>
                )}
                {experience.length === 0 && <p className="mt-2 text-[13px] text-slate-500">No work experience entries yet.</p>}
                <ul className="mt-1 border-t border-slate-100">
                  {experience.map(exp => {
                    const span = tenureDays(exp.start_date, exp.end_date);
                    return (
                      <li key={exp.id} className="border-b border-slate-100 py-3 last:border-b-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-extrabold">{exp.role || exp.employer}</div>
                            {exp.role && <div className="text-xs font-medium text-slate-600">{exp.employer}</div>}
                          </div>
                          <RowMenu
                          label={exp.role || exp.employer}
                          items={[
                            { label: 'Edit', onSelect: () => openEditExperience(exp) },
                            { label: 'Remove', danger: true, onSelect: () => handleDeleteExperience(exp.id) },
                          ]}
                        />
                        </div>
                        {exp.description && <p className="mt-1 text-[13px] text-slate-600">{exp.description}</p>}
                        {(exp.start_date || exp.end_date) && (
                          <div className="mt-1 flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
                            <span>
                              {formatAdDate(exp.start_date, system)} – {exp.end_date ? formatAdDate(exp.end_date, system) : 'Present'}
                            </span>
                            {span !== null && <span className="shrink-0">{span} days</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>

          {tab === 'records' && <MyRecords employeeId={employee.id} joinedOn={employee.date_of_joining} />}
          {tab === 'documents' && (docs === undefined ? <p className="p-4 text-center text-sm text-slate-500">Loading…</p> : <MyDocuments docs={docs} employeeId={employee.id} companyId={employee.company_id ?? null} onChanged={() => loadHris(employee.id)} />)}
          {tab === 'exit' && <MyExit sep={sep} onChanged={() => loadHris(employee.id)} />}

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-3 h-12 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 lg:hidden"
          >
            Sign out
          </button>
        </div>
      </div>

      {showDetails && (
        <SectionDialog
          title="my details"
          hint="Your name, contact details and emergency contact."
          changed={changedLabels.length}
          changedLabels={changedLabels}
          saving={savingProfile}
          error={profileError ?? undefined}
          onClose={requestCloseDetails}
          onSubmit={handleSaveProfile}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="my-name" className={LABEL}>
                Name
              </label>
              <input id="my-name" required value={profileForm.name} onChange={e => updateField('name', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="my-email" className={LABEL}>
                Email
              </label>
              <input id="my-email" type="email" value={profileForm.email} onChange={e => updateField('email', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="my-phone" className={LABEL}>
                Phone
              </label>
              <input id="my-phone" value={profileForm.phone} onChange={e => updateField('phone', e.target.value)} className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="my-address" className={LABEL}>
                Address
              </label>
              <textarea id="my-address" value={profileForm.address} onChange={e => updateField('address', e.target.value)} rows={2} className={TEXTAREA} />
            </div>
          </div>

          <h3 className="mb-3 mt-5 border-t border-slate-100 pt-4 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-600">Emergency contact</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="my-em-name" className={LABEL}>
                Name
              </label>
              <input
                id="my-em-name"
                value={emergencyForm.emergency_contact_name}
                onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_name: e.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="my-em-rel" className={LABEL}>
                Relationship
              </label>
              <input
                id="my-em-rel"
                value={emergencyForm.emergency_contact_relationship}
                onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_relationship: e.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="my-em-phone" className={LABEL}>
                Phone
              </label>
              <input
                id="my-em-phone"
                value={emergencyForm.emergency_contact_phone}
                onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_phone: e.target.value }))}
                className={INPUT}
              />
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Username, department, designation, branch, PAN and SSF are set by your employer — contact your admin to change them.
          </p>
        </SectionDialog>
      )}

      {showEducationForm && (
        <FormDialog
          title={editingEducationId ? 'Edit Education' : 'Add Education'}
          onSubmit={handleSaveEducation}
          onClose={() => setShowEducationForm(false)}
          saving={savingEducation}
          savingLabel="Saving…"
          submitLabel={editingEducationId ? 'Save' : 'Add'}
        >
          <label htmlFor="edu-degree" className={LABEL}>
            Degree
          </label>
          <select
            id="edu-degree"
            required
            value={educationForm.degree}
            onChange={e => setEducationForm(f => ({ ...f, degree: e.target.value }))}
            className={`${INPUT} mb-3 bg-white`}
          >
            <option value="" disabled>
              Select degree
            </option>
            <option value="Under SEE">Under SEE</option>
            <option value="SEE">SEE</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Bachelors">Bachelors</option>
            <option value="Masters">Masters</option>
          </select>
          <label htmlFor="edu-institution" className={LABEL}>
            Institution
          </label>
          <input
            id="edu-institution"
            value={educationForm.institution}
            onChange={e => setEducationForm(f => ({ ...f, institution: e.target.value }))}
            className={`${INPUT} mb-3`}
          />
          <label htmlFor="edu-board" className={LABEL}>
            Board / university
          </label>
          <input
            id="edu-board"
            value={educationForm.board_university}
            onChange={e => setEducationForm(f => ({ ...f, board_university: e.target.value }))}
            placeholder="e.g. NEB, Tribhuvan University"
            className={`${INPUT} mb-3`}
          />
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label htmlFor="edu-year" className={LABEL}>
                Passing year
              </label>
              <input id="edu-year" type="number" value={educationForm.year} onChange={e => setEducationForm(f => ({ ...f, year: e.target.value }))} className={INPUT} />
            </div>
            <div>
              <label htmlFor="edu-cal" className={LABEL}>
                Calendar
              </label>
              <select id="edu-cal" value={educationForm.year_calendar} onChange={e => setEducationForm(f => ({ ...f, year_calendar: e.target.value }))} className={`${INPUT} bg-white`}>
                <option value="AD">AD</option>
                <option value="BS">BS</option>
              </select>
            </div>
          </div>
        </FormDialog>
      )}

      {showExperienceForm && (
        <FormDialog
          title={editingExperienceId ? 'Edit Work Experience' : 'Add Work Experience'}
          onSubmit={handleSaveExperience}
          onClose={() => setShowExperienceForm(false)}
          saving={savingExperience}
          savingLabel="Saving…"
          submitLabel={editingExperienceId ? 'Save' : 'Add'}
        >
          <label htmlFor="exp-employer" className={LABEL}>
            Employer
          </label>
          <input
            id="exp-employer"
            required
            value={experienceForm.employer}
            onChange={e => setExperienceForm(f => ({ ...f, employer: e.target.value }))}
            className={`${INPUT} mb-3`}
          />
          <label htmlFor="exp-role" className={LABEL}>
            Role
          </label>
          <input id="exp-role" value={experienceForm.role} onChange={e => setExperienceForm(f => ({ ...f, role: e.target.value }))} className={`${INPUT} mb-3`} />
          <label htmlFor="exp-description" className={LABEL}>
            Description
          </label>
          <textarea
            id="exp-description"
            value={experienceForm.description}
            onChange={e => setExperienceForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            className={`${TEXTAREA} mb-3`}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Start date</label>
              <DatePicker value={experienceForm.start_date} onChange={v => setExperienceForm(f => ({ ...f, start_date: v }))} />
            </div>
            <div>
              <label className={LABEL}>End date</label>
              <DatePicker value={experienceForm.end_date} onChange={v => setExperienceForm(f => ({ ...f, end_date: v }))} />
            </div>
          </div>
        </FormDialog>
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

/** A label and its value on one line; the computer's cards. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-slate-100 py-1.5 text-sm">
      <span className="w-24 shrink-0 text-[#586474]">{label}</span>
      <span className="min-w-0 break-words font-semibold">{value}</span>
    </div>
  );
}

/** The phone's "My Details" rows: label left, value right. */
function PhoneRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between gap-4 text-[13px]">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold">{value}</span>
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h3l2-3h6l2 3h3v11H4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} role="img" aria-label="Read only">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
