'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import { EditIcon, HeroPanel, StatusTag } from '@/components/employee/parts';
import SectionDialog from '@/components/profile/SectionDialog';
import DatePicker from '@/components/DatePicker';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { SKILL_CATEGORIES } from '@/lib/skillCategories';
import type { Branch, Employee, EmployeeEducation, EmployeeWorkExperience, LeaderboardRow, PointRedemption } from '@/lib/types';

const EMPTY_PROFILE_FORM = { name: '', email: '', phone: '', address: '', department: '', designation: '' };
const EMPTY_EMERGENCY_FORM = { emergency_contact_name: '', emergency_contact_relationship: '', emergency_contact_phone: '' };
const EMPTY_EDUCATION_FORM = { degree: '', institution: '', year: '' };
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

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}

export default function MyProfilePage() {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<LeaderboardRow | null>(null);
  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);

  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [showDetails, setShowDetails] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);

  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [redeemNote, setRedeemNote] = useState('');
  const [submittingRedeem, setSubmittingRedeem] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const [emergencyForm, setEmergencyForm] = useState(EMPTY_EMERGENCY_FORM);

  const [skillCategory, setSkillCategory] = useState<(typeof SKILL_CATEGORIES)[number]>(SKILL_CATEGORIES[0]);
  const [skillInput, setSkillInput] = useState('');
  const [skillError, setSkillError] = useState<string | null>(null);

  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationForm, setEducationForm] = useState(EMPTY_EDUCATION_FORM);
  const [savingEducation, setSavingEducation] = useState(false);

  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);
  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE_FORM);
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
      .from('point_redemptions')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRedemptions(data ?? []));
    supabase.rpc('get_leaderboard').then(({ data }) => {
      const rows = (data as LeaderboardRow[]) ?? [];
      setBoard(rows.find(r => r.employee_id === empId) ?? null);
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

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (profile?.employee_id) reload(profile.employee_id);
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

  async function handleAddEducation(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingEducation(true);
    const { error } = await supabase.from('employee_education').insert({
      employee_id: employee.id,
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
    reload(employee.id);
  }

  async function handleDeleteEducation(id: string) {
    if (!employee) return;
    if (!(await confirm('Remove this education entry?', { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from('employee_education').delete().eq('id', id);
    reload(employee.id);
  }

  async function handleAddExperience(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingExperience(true);
    const { error } = await supabase.from('employee_work_experience').insert({
      employee_id: employee.id,
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

  async function handleRedeemSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setRedeemError(null);
    if (redeemPoints <= 0) {
      setRedeemError('Enter how many points you want to redeem.');
      return;
    }
    if (board && redeemPoints > board.total_points) {
      setRedeemError(`You only have ${board.total_points} points available.`);
      return;
    }
    setSubmittingRedeem(true);
    const { error } = await supabase.from('point_redemptions').insert({
      employee_id: employee.id,
      points_requested: redeemPoints,
      note: redeemNote || null,
    });
    setSubmittingRedeem(false);
    if (error) {
      setRedeemError(error.message);
      return;
    }
    setShowRedeem(false);
    setRedeemPoints(0);
    setRedeemNote('');
    reload(employee.id);
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
      <EmployeeShell title="Profile" flush>
        <p className="p-4 text-center text-sm text-slate-500">Loading…</p>
      </EmployeeShell>
    );
  }

  if (!employee) {
    return (
      <EmployeeShell title="Profile" flush>
        <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      </EmployeeShell>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);
  const branchName = branches.find(b => b.id === employee.branch_id)?.name ?? null;
  const joined = formatAdDate(employee.date_of_joining, system);
  const daysText = days !== null ? `${days} days` : '—';
  const daysLabel = employee.resigned_at ? 'Days worked' : 'With the company';
  const emergencySet = !!(employee.emergency_contact_name || employee.emergency_contact_phone);

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
    <EmployeeShell title="Profile" flush>
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      <div className="lg:px-8 lg:pb-10 lg:pt-7">
        {/* Computer: just the green band the identity card sits over; the header says "Profile". */}
        <div className="hidden lg:block">
          <HeroPanel pad="inner">
            <div aria-hidden="true" />
          </HeroPanel>
        </div>

        <div className="relative mx-4 mt-4 pb-4 lg:mx-5 lg:-mt-11 lg:pb-0">
          {/* Who you are: a centred card on a phone, a wide card with three facts on a computer. */}
          <section aria-label="Profile summary" className="rounded-2xl border border-slate-200 bg-white p-5 text-center lg:flex lg:flex-wrap lg:items-center lg:gap-x-10 lg:gap-y-6 lg:rounded-[20px] lg:p-7 lg:text-left lg:shadow-[0_10px_24px_rgba(6,78,59,0.12)]">
            <div className="flex flex-col items-center lg:min-w-0 lg:flex-[1_1_400px] lg:flex-row lg:gap-6">
              <button
                type="button"
                onClick={openPhotoPicker}
                aria-label="Change photo"
                title="Change photo"
                className="relative mb-3 h-[72px] w-[72px] shrink-0 rounded-full lg:mb-0 lg:h-[104px] lg:w-[104px]"
              >
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-brand-light text-3xl font-extrabold text-brand lg:text-[40px]">
                  {uploadingPhoto ? (
                    <span className="text-sm">…</span>
                  ) : employee.profile_photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
                  ) : (
                    employee.name.slice(0, 1)
                  )}
                </span>
                <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand text-white">
                  <CameraIcon className="h-4 w-4" />
                </span>
              </button>
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold lg:text-[28px] lg:leading-[34px] lg:tracking-[-0.01em]">{employee.name}</h2>
                <p className="mt-0.5 text-[13px] font-semibold text-slate-600 lg:text-[15px] lg:font-bold">{employee.designation ?? '—'}</p>
                <p className="text-xs text-slate-500 lg:hidden">{employee.department ?? '—'}</p>
                <div className="mt-2.5 hidden flex-wrap gap-2 lg:flex">
                  {employee.department && <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-extrabold text-brand">{employee.department}</span>}
                  {branchName && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-600">{branchName} branch</span>}
                </div>
              </div>
            </div>
            <div className="hidden lg:flex lg:flex-[1_1_380px] lg:flex-wrap lg:gap-y-4">
              <Stat label="Joined" value={joined} className="flex-[1_1_130px] pr-5" />
              <Stat label={daysLabel} value={daysText} className="flex-[1_1_130px] border-l border-slate-200 px-5" />
              <Stat label="Enroll ID" value={employee.fingerprint_id || '—'} className="flex-[1_1_90px] border-l border-slate-200 pl-5" />
            </div>
          </section>

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
                <h2 className={`${CARD_TITLE} mb-3`}>Skills</h2>
                <div className="flex flex-wrap gap-2">
                  {employee.skills.map(skill => (
                    <span key={skill} className="flex items-center gap-1 rounded-full bg-brand-light py-1.5 pl-3 pr-1 text-[13px] font-bold text-brand">
                      {skill}
                      <button
                        type="button"
                        onClick={() => removeSkill(skill)}
                        aria-label={`Remove ${skill}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none hover:bg-white/70"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {employee.skills.length === 0 && <p className="text-[13px] text-slate-500">No skills added yet.</p>}
                </div>
                <form onSubmit={addSkill} className="mt-4 flex flex-col gap-2">
                  <select
                    aria-label="Skill category"
                    value={skillCategory}
                    onChange={e => setSkillCategory(e.target.value as (typeof SKILL_CATEGORIES)[number])}
                    className={`${INPUT} bg-white text-slate-600`}
                  >
                    {SKILL_CATEGORIES.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
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
                    <p role="alert" className="text-[13px] font-semibold text-[#b91c1c]">
                      {skillError}
                    </p>
                  )}
                </form>
              </section>

              <section aria-label="Reward points" className={CARD}>
                <div className="flex items-center justify-between">
                  <h2 className={CARD_TITLE}>Reward points</h2>
                  <span className="text-2xl font-extrabold lg:text-[30px]">{board?.total_points ?? 0}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRedeem(true)}
                  className="mt-3 h-11 w-full rounded-xl bg-brand text-sm font-extrabold text-white hover:bg-brand/90"
                >
                  Redeem points
                </button>
                {redemptions.length > 0 && (
                  <ul className="mt-4 border-t border-slate-100">
                    {redemptions.map(r => (
                      <li key={r.id} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold">{r.points_requested} pts</div>
                          {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                        </div>
                        <StatusTag tone={statusTone(r.status)}>{r.status}</StatusTag>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
            <section aria-label="Education" className={CARD}>
              <div className="flex items-center justify-between">
                <h2 className={CARD_TITLE}>Education</h2>
                <button type="button" onClick={() => setShowEducationForm(true)} className="flex h-11 items-center px-1 text-[13px] font-extrabold text-brand">
                  + Add
                </button>
              </div>
              {education.length === 0 && <p className="mt-2 text-[13px] text-slate-500">No education entries yet.</p>}
              <ul className="mt-1 border-t border-slate-100">
                {education.map(ed => (
                  <li key={ed.id} className="flex items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold">{ed.degree}</div>
                      {(ed.institution || ed.year) && (
                        <div className="text-xs font-medium text-slate-600">{[ed.institution, ed.year ? String(ed.year) : null].filter(Boolean).join(' · ')}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteEducation(ed.id)}
                      className="shrink-0 px-1 py-1 text-xs font-bold text-[#b91c1c] hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Work Experience" className={CARD}>
              <div className="flex items-center justify-between">
                <h2 className={CARD_TITLE}>Work Experience</h2>
                <button type="button" onClick={() => setShowExperienceForm(true)} className="flex h-11 items-center px-1 text-[13px] font-extrabold text-brand">
                  + Add
                </button>
              </div>
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
                        <button
                          type="button"
                          onClick={() => handleDeleteExperience(exp.id)}
                          className="shrink-0 px-1 py-1 text-xs font-bold text-[#b91c1c] hover:underline"
                        >
                          Remove
                        </button>
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

      {showRedeem && (
        <FormDialog
          title="Redeem Points"
          note={`You have ${board?.total_points ?? 0} points. HR/Admin will review this request.`}
          onSubmit={handleRedeemSubmit}
          onClose={() => setShowRedeem(false)}
          saving={submittingRedeem}
          savingLabel="Submitting…"
          submitLabel="Submit request"
          error={redeemError}
        >
          <label htmlFor="redeem-points" className={LABEL}>
            Points to redeem
          </label>
          <input
            id="redeem-points"
            type="number"
            min={1}
            max={board?.total_points ?? undefined}
            required
            value={redeemPoints || ''}
            onChange={e => setRedeemPoints(Number(e.target.value))}
            className={`${INPUT} mb-3`}
          />
          <label htmlFor="redeem-note" className={LABEL}>
            Note (optional)
          </label>
          <textarea id="redeem-note" value={redeemNote} onChange={e => setRedeemNote(e.target.value)} rows={2} className={TEXTAREA} />
        </FormDialog>
      )}

      {showEducationForm && (
        <FormDialog
          title="Add Education"
          onSubmit={handleAddEducation}
          onClose={() => setShowEducationForm(false)}
          saving={savingEducation}
          savingLabel="Saving…"
          submitLabel="Add"
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
          <label htmlFor="edu-year" className={LABEL}>
            Year
          </label>
          <input id="edu-year" type="number" value={educationForm.year} onChange={e => setEducationForm(f => ({ ...f, year: e.target.value }))} className={INPUT} />
        </FormDialog>
      )}

      {showExperienceForm && (
        <FormDialog
          title="Add Work Experience"
          onSubmit={handleAddExperience}
          onClose={() => setShowExperienceForm(false)}
          saving={savingExperience}
          savingLabel="Saving…"
          submitLabel="Add"
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
    </EmployeeShell>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#586474]">{label}</div>
      <div className="mt-1 text-lg font-extrabold leading-6">{value}</div>
    </div>
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

/** The small add / request pop-ups (redeem points, education, work experience). */
function FormDialog({
  title,
  note,
  onSubmit,
  onClose,
  saving,
  savingLabel,
  submitLabel,
  error,
  children,
}: {
  title: string;
  note?: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  saving: boolean;
  savingLabel: string;
  submitLabel: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  // Kept in a ref so the key listener is attached once, not on every render of the page.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <form onSubmit={onSubmit} role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-sm rounded-[20px] bg-white p-6 shadow-xl">
        <h3 className="text-xl font-extrabold">{title}</h3>
        {note && <p className="mb-4 mt-1 text-[13px] font-medium text-slate-600">{note}</p>}
        <div className={note ? '' : 'mt-4'}>{children}</div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-[#b91c1c]">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="h-11 rounded-xl bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? savingLabel : submitLabel}
          </button>
        </div>
      </form>
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
