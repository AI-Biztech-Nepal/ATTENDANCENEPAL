import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Branch, Employee } from '../types';
import { colors } from '../theme';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { DOCUMENT_TYPES, type EmployeeDocument } from '../lib/employeeDocuments';
import { EMPLOYMENT_STATUS_LABEL, STATUS_TONE, effectiveStatus, employmentTypeLabel } from '../lib/employeeProfile';
import type { EmployeeSeparation } from '../lib/employeeSeparation';
import Badge from '../components/Badge';
import DocumentsCard from '../components/hr/DocumentsCard';
import MyOverviewCards from '../components/employee/MyOverviewCards';
import MyRecordsCards from '../components/employee/MyRecordsCards';
import { MyEducationCard, MyExperienceCard, MySkillsCard, MyTrainingCard } from '../components/employee/MyCvCards';
import MyExitCard from '../components/employee/MyExitCard';

type Tab = 'overview' | 'records' | 'docs' | 'exit';

/** The fields update_my_profile() takes besides the photo and skills. */
type ProfileDetails = Partial<
  Record<'name' | 'email' | 'phone' | 'address' | 'emergency_contact_name' | 'emergency_contact_relationship' | 'emergency_contact_phone', string>
>;

/** The employee's own profile, laid out like the admin's employee screen: a header, then Overview /
 * Records / Docs / Exit. HR sets employment and pay; the employee edits their own details, CV,
 * documents and resignation (each in its own sheet). */
export default function MyProfileScreen() {
  const { system } = useCalendarSystem();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [photoFailed, setPhotoFailed] = useState(false);

  // The rest of what HR keeps on file. `undefined` = still loading, null = couldn't be read.
  const [docs, setDocs] = useState<EmployeeDocument[] | null | undefined>(undefined);
  const [sep, setSep] = useState<EmployeeSeparation | null | undefined>(undefined);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [openConduct, setOpenConduct] = useState<number | null>(null);

  const reload = useCallback((empId: string) => {
    supabase
      .from('employees')
      .select('*')
      .eq('id', empId)
      .single()
      .then(({ data }) => {
        // skills is a newer column — normalise to [] if the migration adding it hasn't been run yet.
        if (data) setEmployee({ ...(data as Employee), skills: (data as Employee).skills ?? [] });
      });
  }, []);

  // Each read may fail — before the latest migration the policies aren't there — and that tab then says
  // it isn't available instead of breaking the screen.
  const loadHris = useCallback((empId: string) => {
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
  }, []);

  const employeeId = employee?.id;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (profile?.employee_id) reload(profile.employee_id);
    });
    supabase.from('branches').select('*').then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, [reload]);

  // Read again when the tab changes, so a document added or a resignation handed in shows up in the labels.
  useEffect(() => {
    if (employeeId) loadHris(employeeId);
  }, [employeeId, tab, loadHris]);

  // update_my_profile() replaces the whole editable row at once, so every call passes the full current
  // state — only what is being changed differs from what is already saved.
  async function saveProfile(overrides: { skills?: string[]; details?: ProfileDetails } = {}) {
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
      p_photo_url: employee.profile_photo_url ?? null,
      p_skills: overrides.skills ?? employee.skills ?? [],
      p_emergency_contact_name: pick('emergency_contact_name', employee.emergency_contact_name) || null,
      p_emergency_contact_relationship: pick('emergency_contact_relationship', employee.emergency_contact_relationship) || null,
      p_emergency_contact_phone: pick('emergency_contact_phone', employee.emergency_contact_phone) || null,
    });
    return error;
  }

  /** For the sheets: save some of the profile fields, resolving to an error message or null. */
  async function saveDetails(values: Record<string, string>) {
    const error = await saveProfile({ details: values });
    return error ? error.message : null;
  }

  async function saveSkills(skills: string[]) {
    const error = await saveProfile({ skills });
    if (error) return error.message;
    if (employee) reload(employee.id);
    return null;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
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
        <Text style={styles.warn}>Your account isn't linked to an employee record yet.</Text>
      </View>
    );
  }

  const branchName = branches.find(b => b.id === employee.branch_id)?.name ?? null;
  const status = effectiveStatus(employee);
  const initials =
    employee.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || '?';
  const haveDocs = docs ? DOCUMENT_TYPES.filter(t => docs.some(d => d.doc_type === t.value)).length : null;
  const exitOpen = !!sep && sep.settlement_status !== 'completed';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: openConduct ? `Records · ${openConduct} open` : 'Records' },
    { id: 'docs', label: haveDocs !== null ? `Docs · ${haveDocs}/${DOCUMENT_TYPES.length}` : 'Docs' },
    { id: 'exit', label: exitOpen ? 'Exit · open' : 'Exit' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          {employee.profile_photo_url && !photoFailed ? (
            <Image source={{ uri: employee.profile_photo_url }} style={styles.avatar} onError={() => setPhotoFailed(true)} accessibilityLabel={`Photo of ${employee.name}`} />
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
        <View style={styles.headerBadges}>
          <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
          {!!employee.employment_type && <Badge tone="neutral">{employmentTypeLabel(employee.employment_type)}</Badge>}
          {!!employee.blood_group && <Badge tone="critical">Blood group {employee.blood_group}</Badge>}
        </View>
        {!!employee.resigned_at && <Text style={[styles.meta, { marginTop: 8 }]}>Last working date: {formatAdDate(employee.resigned_at, system)}</Text>}
      </View>

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

      <View style={tab === 'overview' ? undefined : styles.hidden}>
        <MyOverviewCards
          employee={employee}
          branchName={branchName}
          managerName={managerName}
          docs={docs}
          openConduct={openConduct}
          sep={sep}
          onOpenTab={t => setTab(t === 'documents' ? 'docs' : t)}
          onSaveProfile={saveDetails}
          onSaved={() => reload(employee.id)}
        />
      </View>

      <View style={tab === 'records' ? undefined : styles.hidden}>
        <MyRecordsCards employeeId={employee.id} joinedOn={employee.date_of_joining} />
        <MyEducationCard employeeId={employee.id} />
        <MyTrainingCard employeeId={employee.id} />
        <MyExperienceCard employee={employee} />
        <MySkillsCard skills={employee.skills} onSave={saveSkills} />
      </View>

      <View style={tab === 'docs' ? undefined : styles.hidden}>
        <DocumentsCard employeeId={employee.id} companyId={employee.company_id ?? null} defaultOpen selfService />
      </View>

      <View style={tab === 'exit' ? undefined : styles.hidden}>
        <MyExitCard sep={sep} onChanged={() => loadHris(employee.id)} />
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} accessibilityRole="button" accessibilityLabel="Sign out">
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  hidden: { display: 'none' },
  headerCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { height: 64, width: 64, borderRadius: 32 },
  avatarFallback: { backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '800', color: colors.accent },
  headerBadges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 },
  name: { fontSize: 18, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 2 },
  meta: { fontSize: 12, color: colors.slate400, marginTop: 2 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  tabPill: { minHeight: 44, paddingHorizontal: 11, borderRadius: 22, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  tabPillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '800', color: colors.slate500 },
  tabTextOn: { color: colors.white },
  signOutBtn: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  signOutText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
});
