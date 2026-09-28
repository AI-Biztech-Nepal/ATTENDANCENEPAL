import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Employee, LeaveRequest } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { nepalTodayIso } from '../lib/shift';
import { fetchMyCompanyWeekOffConfig } from '../lib/weekOff';
import {
  NO_LEAVE_POLICY,
  fetchLeavePolicy,
  fiscalYearEnd,
  fiscalYearLabel,
  fiscalYearStart,
  formatLeaveDays,
  leavePolicyActive,
  loadLeaveLedgers,
  type LeaveEntry,
  type LeaveLedger,
  type LeavePolicy,
} from '../lib/leaveBalance';

const FILTERS = ['pending', 'approved', 'rejected', 'All'] as const;

const ENTRY_LABEL: Record<LeaveEntry['kind'], string> = {
  earned: 'Worked on Week Off',
  absent: 'Absent',
  leave: 'Approved leave',
  'unpaid-leave': 'Unpaid leave',
};

function daysBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

/**
 * Leave, for an admin: the Requests list (approve / reject) and the yearly
 * Leave Balance — the same two tabs as the dashboard's Leave page, driven by
 * the same lib/leaveBalance.ts, so a balance here is the balance there.
 */
export default function LeaveApprovalScreen() {
  const { system } = useCalendarSystem();
  const [tab, setTab] = useState<'requests' | 'balance'>('requests');
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<LeavePolicy>(NO_LEAVE_POLICY);
  const [company, setCompany] = useState<{ weeklyOffDay: number | null; rosterMode: 'weekly' | 'monthly' } | null>(null);
  const [ledgers, setLedgers] = useState<Map<string, LeaveLedger>>(new Map());
  const [ledgersLoading, setLedgersLoading] = useState(false);
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);
  // Yearly Leave editing, one employee at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  function reload() {
    supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRequests((data as LeaveRequest[]) ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees((data as Employee[]) ?? []));
  }
  useEffect(reload, []);

  useEffect(() => {
    fetchLeavePolicy().then(p => {
      setCompanyId(p.companyId);
      setPolicy(p);
    });
    fetchMyCompanyWeekOffConfig().then(c => setCompany({ weeklyOffDay: c.weeklyOffDay, rosterMode: c.rosterMode }));
  }, []);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  const balanceOn = leavePolicyActive(policy, activeEmployees);

  // Rebuilt when the policy, the staff list or an approval changes — an
  // approved leave is drawn from the balance, so the numbers move with it.
  useEffect(() => {
    if (!company || !balanceOn || activeEmployees.length === 0) {
      setLedgers(new Map());
      return;
    }
    let cancelled = false;
    setLedgersLoading(true);
    loadLeaveLedgers({
      employees: activeEmployees,
      policy,
      weeklyOffDay: company.weeklyOffDay,
      rosterMode: company.rosterMode,
      until: nepalTodayIso(),
    }).then(m => {
      if (cancelled) return;
      setLedgers(m);
      setLedgersLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, policy, activeEmployees, requests, balanceOn]);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';
  const filtered = useMemo(() => (filter === 'All' ? requests : requests.filter(r => r.status === filter)), [requests, filter]);

  async function review(id: string, status: 'approved' | 'rejected') {
    setBusyId(id);
    const { data } = await supabase.auth.getUser();
    await supabase.from('leave_requests').update({ status, reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() }).eq('id', id);
    setBusyId(null);
    reload();
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setEditText(emp.annual_leave_days != null ? String(emp.annual_leave_days) : '');
    setSaveError(null);
    setSavedId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
    setSaveError(null);
  }

  async function saveAllowance(emp: Employee) {
    const text = editText.trim();
    const value = text === '' ? null : Number(text);
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 366)) {
      setSaveError('Enter whole days from 0 to 366, or clear the box for no leave.');
      return;
    }
    if (value === (emp.annual_leave_days ?? null)) {
      cancelEdit();
      return;
    }
    setSavingId(emp.id);
    setSaveError(null);
    const { error } = await supabase.from('employees').update({ annual_leave_days: value }).eq('id', emp.id);
    if (error) {
      setSavingId(null);
      setSaveError(error.message);
      return;
    }
    // Week Off work always earns leave for a company using the balance —
    // switched on the first time anyone is given leave, as on the dashboard.
    if (!policy.weekOffWorkEarnsLeave && companyId && value != null && value > 0) {
      const { error: policyError } = await supabase.from('companies').update({ week_off_work_earns_leave: true }).eq('id', companyId);
      if (!policyError) setPolicy(p => ({ ...p, weekOffWorkEarnsLeave: true }));
    }
    setSavingId(null);
    setEmployees(list => list.map(e => (e.id === emp.id ? { ...e, annual_leave_days: value } : e)));
    setEditingId(null);
    setEditText('');
    setSavedId(emp.id);
    setTimeout(() => setSavedId(s => (s === emp.id ? null : s)), 2500);
  }

  const fyStart = fiscalYearStart(nepalTodayIso());
  const balanceRows = useMemo(
    () =>
      [...activeEmployees].sort((a, b) =>
        (a.fingerprint_id ?? '').localeCompare(b.fingerprint_id ?? '', undefined, { numeric: true, sensitivity: 'base' })
      ),
    [activeEmployees]
  );

  function balanceText(id: string) {
    const l = ledgers.get(id);
    if (!l) return null;
    return <Text style={[styles.balanceValue, l.balance <= 0 && { color: colors.criticalText }]}>{formatLeaveDays(l.balance)}d</Text>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {(
          [
            ['requests', 'Requests'],
            ['balance', 'Leave Balance'],
          ] as const
        ).map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'requests' ? (
        <>
          <View style={styles.filterBar}>
            {FILTERS.map(f => (
              <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
                <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item: r }) => (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{employeeName(r.employee_id)}</Text>
                    <Text style={styles.type}>{r.leave_type}</Text>
                  </View>
                  <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'critical' : 'warning'}>{r.status}</Badge>
                </View>
                <Text style={styles.dates}>
                  {formatAdDate(r.start_date, system)} → {formatAdDate(r.end_date, system)}{' '}
                  <Text style={styles.dim}>· {daysBetween(r.start_date, r.end_date)}d</Text>
                </Text>
                {balanceOn && ledgers.get(r.employee_id) && (
                  <Text style={styles.reason}>Leave balance: {balanceText(r.employee_id)}</Text>
                )}
                {r.reason ? <Text style={styles.reason}>{r.reason}</Text> : null}
                {r.status === 'pending' && (
                  <View style={styles.actions}>
                    <TouchableOpacity disabled={busyId === r.id} style={styles.approveBtn} onPress={() => review(r.id, 'approved')}>
                      <Text style={styles.approveText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busyId === r.id} style={styles.rejectBtn} onPress={() => review(r.id, 'rejected')}>
                      <Text style={styles.rejectText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No {filter !== 'All' ? filter : ''} leave requests.</Text>}
          />
        </>
      ) : (
        <FlatList
          data={balanceRows}
          keyExtractor={e => e.id}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>How leave works</Text>
                <Text style={styles.infoLine}>
                  • Each employee gets the yearly leave you set below, on 1 Shrawan. Nobody gets leave until you set it. Unused days lapse
                  at the end of the fiscal year.
                </Text>
                <Text style={styles.infoLine}>
                  • An absent working day, or approved leave, is paid from the balance and costs the rostered duty: 8h day = 1, 16h duty
                  = 2, 24h duty = 3. Salary is cut only once the balance runs out.
                </Text>
                <Text style={styles.infoLine}>
                  • Work on a Week Off adds +1 day for every full {formatLeaveDays(policy.hoursPerLeaveDay)} hours (no half days; 30
                  minutes' leeway, so a 24h duty = 3). It is not paid as overtime.
                </Text>
              </View>
              <View style={styles.fyBar}>
                <Text style={styles.fyTitle}>Fiscal year {fiscalYearLabel(fyStart)}</Text>
                <Text style={styles.fySub}>
                  {formatAdDate(fyStart, system)} – {formatAdDate(fiscalYearEnd(fyStart), system)}
                </Text>
                <Text style={styles.fySub}>
                  {!balanceOn ? "Set an employee's yearly leave to start" : ledgersLoading ? 'Calculating…' : 'Counted up to yesterday'}
                </Text>
              </View>
              {saveError && <Text style={styles.error}>{saveError}</Text>}
            </>
          }
          renderItem={({ item: emp }) => {
            const ledger = ledgers.get(emp.id);
            const editing = editingId === emp.id;
            const saving = savingId === emp.id;
            return (
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.cardTop}
                  onPress={() => setOpenEmployee(o => (o === emp.id ? null : emp.id))}
                  disabled={!ledger}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{emp.name}</Text>
                    <Text style={styles.type}>ID {emp.fingerprint_id ?? '—'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.gridLabel}>Balance</Text>
                    {balanceText(emp.id) ?? <Text style={styles.dim}>—</Text>}
                  </View>
                </TouchableOpacity>

                <View style={styles.allowanceRow}>
                  <Text style={styles.gridLabel}>Yearly Leave</Text>
                  {editing ? (
                    <View style={styles.editRow}>
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        autoFocus
                        value={editText}
                        placeholder="0"
                        onChangeText={setEditText}
                        onSubmitEditing={() => saveAllowance(emp)}
                        returnKeyType="done"
                      />
                      <Text style={styles.dim}>days</Text>
                      <TouchableOpacity style={styles.saveBtn} onPress={() => saveAllowance(emp)} disabled={saving}>
                        {saving ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.saveText}>Save</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit} disabled={saving}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.editRow}>
                      {emp.annual_leave_days != null ? (
                        <Text style={styles.allowanceValue}>{formatLeaveDays(emp.annual_leave_days)} days</Text>
                      ) : (
                        <Text style={styles.dim}>Not set</Text>
                      )}
                      <TouchableOpacity style={styles.editBtn} onPress={() => startEdit(emp)} disabled={editingId !== null}>
                        <Text style={styles.editText}>{emp.annual_leave_days != null ? 'Edit' : 'Set'}</Text>
                      </TouchableOpacity>
                      {savedId === emp.id && <Text style={styles.saved}>Saved ✓</Text>}
                    </View>
                  )}
                </View>

                {ledger && (
                  <View style={styles.grid}>
                    <View style={styles.gridItem}>
                      <Text style={styles.gridLabel}>Earned (Week Off)</Text>
                      <Text style={[styles.gridValue, { color: colors.goodText }]}>+{formatLeaveDays(ledger.earned)}</Text>
                    </View>
                    <View style={styles.gridItem}>
                      <Text style={styles.gridLabel}>Used</Text>
                      <Text style={styles.gridValue}>{formatLeaveDays(ledger.used)}</Text>
                    </View>
                    <View style={styles.gridItem}>
                      <Text style={styles.gridLabel}>Unpaid days</Text>
                      <Text style={[styles.gridValue, ledger.unpaidDays > 0 && { color: colors.criticalText }]}>
                        {formatLeaveDays(ledger.unpaidDays)}
                      </Text>
                    </View>
                  </View>
                )}

                {openEmployee === emp.id && ledger && <LedgerEntries ledger={ledger} system={system} />}
                {ledger && (
                  <TouchableOpacity onPress={() => setOpenEmployee(o => (o === emp.id ? null : emp.id))}>
                    <Text style={styles.detailsLink}>{openEmployee === emp.id ? 'Hide details' : 'Details'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No active employees.</Text>}
        />
      )}
    </View>
  );
}

/** The dated list behind one employee's balance. */
function LedgerEntries({ ledger, system }: { ledger: LeaveLedger; system: ReturnType<typeof useCalendarSystem>['system'] }) {
  if (ledger.entries.length === 0) {
    return (
      <Text style={styles.entriesEmpty}>
        No absences or Week Off work since {formatAdDate(ledger.from, system)}.
        {ledger.entitlement > 0 ? ` The full ${formatLeaveDays(ledger.entitlement)} days are available.` : ' No yearly leave set yet.'}
      </Text>
    );
  }
  return (
    <View style={styles.entries}>
      <Text style={styles.entriesEmpty}>Counted from {formatAdDate(ledger.from, system)}.</Text>
      {ledger.entries.map(e => (
        <View key={e.date + e.kind} style={styles.entryRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryDate}>{formatAdDate(e.date, system)}</Text>
            <Text style={styles.entryWhat}>
              {ENTRY_LABEL[e.kind]}
              {e.kind === 'earned' && e.hours != null ? ` · ${formatLeaveDays(e.hours)}h worked` : ''}
              {e.cost != null && e.cost > 1 ? ` · ${e.cost}-day duty` : ''}
            </Text>
            {e.unpaid > 0 && <Text style={styles.entryUnpaid}>{formatLeaveDays(e.unpaid)}d unpaid</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.entryDelta, e.kind === 'earned' && { color: colors.goodText }]}>
              {e.kind === 'earned' ? `+${formatLeaveDays(e.days)}` : e.days > 0 ? `−${formatLeaveDays(e.days)}` : '0'}
            </Text>
            <Text style={styles.entryBalance}>bal {formatLeaveDays(e.balance)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  tabBar: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate200 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.slate500 },
  tabTextActive: { color: colors.accent },
  filterBar: { flexDirection: 'row', gap: 8, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate200, padding: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.slate500, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  type: { fontSize: 11, color: colors.slate500, textTransform: 'capitalize', marginTop: 2 },
  dates: { fontSize: 13, color: colors.slate500, marginTop: 8 },
  dim: { color: colors.slate400, fontSize: 13 },
  reason: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  approveBtn: { backgroundColor: colors.good, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  approveText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  rejectBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  rejectText: { color: colors.slate500, fontSize: 12, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  infoCard: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.slate200 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  infoLine: { fontSize: 12, color: colors.slate500, marginBottom: 4, lineHeight: 17 },
  fyBar: { marginBottom: 10, paddingHorizontal: 2 },
  fyTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  fySub: { fontSize: 11, color: colors.slate500, marginTop: 2 },
  error: { color: colors.criticalText, fontSize: 12, marginBottom: 10 },
  balanceValue: { fontSize: 18, fontWeight: '700', color: colors.ink },
  allowanceRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate100 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  allowanceValue: { fontSize: 14, fontWeight: '700', color: colors.ink },
  input: {
    width: 64,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: 'right',
    fontSize: 14,
    color: colors.ink,
  },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, minWidth: 54, alignItems: 'center' },
  saveText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  cancelBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  cancelText: { color: colors.slate500, fontSize: 12, fontWeight: '700' },
  editBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  editText: { color: colors.slate500, fontSize: 12, fontWeight: '600' },
  saved: { color: colors.goodText, fontSize: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', marginTop: 10 },
  gridItem: { flex: 1 },
  gridLabel: { fontSize: 10, fontWeight: '700', color: colors.slate400, textTransform: 'uppercase', marginBottom: 3 },
  gridValue: { fontSize: 14, fontWeight: '700', color: colors.ink },
  detailsLink: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 10 },
  entries: { marginTop: 8 },
  entriesEmpty: { fontSize: 12, color: colors.slate500, marginTop: 8 },
  entryRow: { flexDirection: 'row', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100 },
  entryDate: { fontSize: 12, color: colors.slate500 },
  entryWhat: { fontSize: 13, color: colors.ink, marginTop: 1 },
  entryUnpaid: { fontSize: 11, color: colors.criticalText, fontWeight: '700', marginTop: 1 },
  entryDelta: { fontSize: 14, fontWeight: '700', color: colors.ink },
  entryBalance: { fontSize: 11, color: colors.slate400, marginTop: 1 },
});
