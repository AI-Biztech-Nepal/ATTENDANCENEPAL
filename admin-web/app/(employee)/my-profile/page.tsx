'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Badge from '@/components/Badge';
import PhotoCropModal from '@/components/PhotoCropModal';
import { DocumentRing, Fact, ProfileTabs, type ProfileTab } from '@/components/profile/ProfileParts';
import MyCv from '@/components/employee/hris/MyCv';
import MyDocuments from '@/components/employee/hris/MyDocuments';
import MyExit from '@/components/employee/hris/MyExit';
import MyOverview from '@/components/employee/hris/MyOverview';
import MyRecords from '@/components/employee/hris/MyRecords';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { DOCUMENT_TYPES, type EmployeeDocument } from '@/lib/employeeDocuments';
import { EMPLOYMENT_STATUS_LABEL, STATUS_TONE, daysCovered, effectiveStatus, employmentTypeLabel, formatDuration } from '@/lib/employeeProfile';
import type { EmployeeSeparation } from '@/lib/employeeSeparation';
import type { Branch, Employee } from '@/lib/types';

/** The fields update_my_profile() takes besides the photo and skills. */
type ProfileDetails = Partial<
  Record<'name' | 'email' | 'phone' | 'address' | 'emergency_contact_name' | 'emergency_contact_relationship' | 'emergency_contact_phone', string>
>;

/** The employee's own profile, laid out like the admin's employee page: a hero with the document
 * ring, then Overview / Records / Documents / Exit. HR sets employment and pay; the employee edits
 * their own details, CV, documents and resignation (each in its own pop-up). */
export default function MyProfilePage() {
  usePageTitle('Profile');
  const { system } = useCalendarSystem();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // The rest of what HR keeps on file. `undefined` = still loading, null = couldn't be read.
  const [tab, setTab] = useState<'overview' | 'records' | 'documents' | 'exit'>('overview');
  const [docs, setDocs] = useState<EmployeeDocument[] | null | undefined>(undefined);
  const [sep, setSep] = useState<EmployeeSeparation | null | undefined>(undefined);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [openConduct, setOpenConduct] = useState<number | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);

  function reload(empId: string) {
    supabase
      .from('employees')
      .select('*')
      .eq('id', empId)
      .single()
      .then(({ data }) => {
        // skills is a newer column — normalize to [] if the migration adding it hasn't been run
        // yet, so the page degrades instead of crashing.
        if (data) setEmployee({ ...data, skills: data.skills ?? [] });
      });
  }

  // Each read may fail — before the latest migration the policies aren't there — and that tab
  // then says it isn't available instead of breaking the page.
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
    supabase
      .from('employee_conduct_records')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', empId)
      .neq('status', 'closed')
      .then(({ count, error }) => setOpenConduct(error ? null : (count ?? 0)));
    supabase.rpc('my_reporting_manager').then(({ data, error }) => setManagerName(error ? null : ((data as string | null) ?? null)));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (profile?.employee_id) {
        reload(profile.employee_id);
        loadHris(profile.employee_id);
      }
    });
    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));
  }, []);

  // update_my_profile() replaces the whole editable row at once, so every call passes the full
  // current state — only what is being changed differs from what is already saved.
  async function saveProfile(overrides: { photoUrl?: string | null; skills?: string[]; details?: ProfileDetails } = {}) {
    if (!employee) return null;
    const d = overrides.details ?? {};
    const pick = (key: keyof ProfileDetails, current: string | null | undefined) => (key in d ? d[key] : current) ?? '';
    const { error } = await supabase.rpc('update_my_profile', {
      p_name: pick('name', employee.name),
      p_email: pick('email', employee.email) || null,
      p_phone: pick('phone', employee.phone) || null,
      p_address: pick('address', employee.address) || null,
      p_department: employee.department || null,
      p_designation: employee.designation || null,
      p_photo_url: overrides.photoUrl !== undefined ? overrides.photoUrl : (employee.profile_photo_url ?? null),
      p_skills: overrides.skills ?? employee.skills ?? [],
      p_emergency_contact_name: pick('emergency_contact_name', employee.emergency_contact_name) || null,
      p_emergency_contact_relationship: pick('emergency_contact_relationship', employee.emergency_contact_relationship) || null,
      p_emergency_contact_phone: pick('emergency_contact_phone', employee.emergency_contact_phone) || null,
    });
    return error;
  }

  /** For the pop-ups: save some of the profile fields, resolving to an error message or null. */
  async function saveDetails(values: ProfileDetails) {
    const error = await saveProfile({ details: values });
    return error ? error.message : null;
  }

  async function saveSkills(skills: string[]) {
    const error = await saveProfile({ skills });
    if (error) return error.message;
    if (employee) reload(employee.id);
    return null;
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

  if (loading) {
    return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!employee) {
    return <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>;
  }

  const branchName = branches.find(b => b.id === employee.branch_id)?.name ?? null;
  const status = effectiveStatus(employee);
  const isContract = employee.employment_type === 'contract';
  const days = employee.date_of_joining ? daysCovered([{ start: employee.date_of_joining, end: employee.resigned_at }]) : null;
  const haveDocs = docs ? DOCUMENT_TYPES.filter(t => docs.some(d => d.doc_type === t.value)).length : null;
  const exitOpen = !!sep && sep.settlement_status !== 'completed';
  const profileTabs: ProfileTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: 'Records', badge: openConduct ? { text: `${openConduct} open`, tone: 'warn' } : undefined },
    {
      id: 'documents',
      label: 'Documents',
      badge: haveDocs !== null ? { text: `${haveDocs} / ${DOCUMENT_TYPES.length}`, tone: haveDocs < DOCUMENT_TYPES.length ? 'warn' : 'good' } : undefined,
    },
    { id: 'exit', label: 'Exit', badge: exitOpen ? { text: 'Open', tone: 'warn' } : undefined },
  ];

  return (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      <div className="lg:px-8 lg:pb-10 lg:pt-7">
        <div className="mx-4 mt-4 pb-4 lg:mx-0 lg:mt-0 lg:pb-0">
          <section aria-label="Profile summary" className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 lg:p-6">
            <div className="flex flex-wrap items-center gap-5">
              <DocumentRing have={haveDocs} total={DOCUMENT_TYPES.length} onOpen={() => setTab('documents')}>
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  title="Change photo"
                  aria-label="Change photo"
                  className={`relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold text-accent ${
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
              </DocumentRing>
              <div className="min-w-0 flex-1 basis-80">
                <h1 className="flex flex-wrap items-center gap-2 text-[28px] font-extrabold leading-tight tracking-tight text-ink">
                  {employee.name}
                  <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
                  {employee.employment_type && <Badge tone="neutral">{employmentTypeLabel(employee.employment_type)}</Badge>}
                  {employee.blood_group && <Badge tone="critical">Blood group {employee.blood_group}</Badge>}
                </h1>
                <p className="mt-1.5 text-[15px] font-bold text-slate-700">{[employee.designation, employee.department, branchName].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] font-semibold text-slate-600">
                  {employee.phone && (
                    <a href={`tel:${employee.phone}`} className="hover:underline">
                      {employee.phone}
                    </a>
                  )}
                  {employee.email && <span>{employee.email}</span>}
                </p>
                <button type="button" onClick={openPhotoPicker} className="mt-1 py-1 text-xs font-medium text-accent hover:underline">
                  {employee.profile_photo_url ? 'Change photo' : '+ Add photo'}
                </button>
              </div>
            </div>
            <dl className="mt-5 grid gap-x-5 gap-y-4 border-t border-slate-200 pt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
              <Fact label="Employee ID">{employee.employee_code}</Fact>
              <Fact label="Joined">{employee.date_of_joining ? formatAdDate(employee.date_of_joining, system) : null}</Fact>
              <Fact label={employee.resigned_at ? 'Time with the company' : 'With the company'}>{days !== null ? formatDuration(days) : null}</Fact>
              <Fact label="Reports to">{managerName}</Fact>
              {isContract ? (
                <Fact label="Contract ends">{employee.contract_end ? formatAdDate(employee.contract_end, system) : null}</Fact>
              ) : (
                <Fact label="Outlet / branch">{branchName}</Fact>
              )}
            </dl>
          </section>

          <ProfileTabs tabs={profileTabs} active={tab} onChange={id => setTab(id as typeof tab)} />

          <div hidden={tab !== 'overview'}>
            <MyOverview
              employee={employee}
              branchName={branchName}
              managerName={managerName}
              docs={docs}
              openConduct={openConduct}
              sep={sep}
              onOpenTab={setTab}
              onSaveProfile={saveDetails}
              onSaved={() => reload(employee.id)}
            />
          </div>

          {tab === 'records' && (
            <div className="flex flex-wrap items-start gap-x-5">
              <div className="min-w-0 flex-[2_1_520px]">
                <MyRecords employeeId={employee.id} joinedOn={employee.date_of_joining} />
              </div>
              <div className="min-w-0 flex-[1_1_320px]">
                <MyCv employee={employee} onSaveSkills={saveSkills} />
              </div>
            </div>
          )}

          {tab === 'documents' &&
            (docs === undefined ? (
              <p className="p-4 text-center text-sm text-slate-500">Loading…</p>
            ) : (
              <MyDocuments docs={docs} employeeId={employee.id} companyId={employee.company_id ?? null} onChanged={() => loadHris(employee.id)} />
            ))}

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

      {pendingPhotoFile && <PhotoCropModal file={pendingPhotoFile} saving={uploadingPhoto} onCancel={() => setPendingPhotoFile(null)} onSave={handlePhotoCropped} />}
    </>
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
