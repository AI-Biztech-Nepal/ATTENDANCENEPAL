import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { formatHoursMinutes, nepalDateKey, nepalTodayIso, punchTypeLabel, selectDayPunches } from '../lib/shift';
import type { AttendanceGpsRequest, AttendanceLog } from '../types';
import { ATTENDANCE_LOG_COLUMNS } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate, localDateKey } from '../lib/calendar';
import type { CalendarSystem } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '../lib/weekOff';
import type { CompanyHoliday, Gender } from '../types';
import { ChevronRightIcon, EditIcon, PinIcon, SignInIcon, SignOutIcon, UmbrellaIcon } from '../components/icons';

type PunchModal = {
  punchType: '0' | '1' | '2' | '3';
  punchTime: string;
  status: 'locating' | 'ready' | 'error';
  coords?: { lat: number; lng: number; accuracy: number | null };
  error?: string;
};

const HISTORY_WINDOW_DAYS = 90;
type HistoryRange = 'daily' | 'weekly' | 'monthly';
const HISTORY_RANGE_DAYS: Record<HistoryRange, number> = { daily: 1, weekly: 7, monthly: 30 };

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}
function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}
function formatDateTime(value: string, system: CalendarSystem) {
  return `${formatAdDate(localDateKey(value), system)} · ${formatTime(value)}`;
}
/** Day number + short month for the date block beside each activity row,
 * in whichever calendar (AD/BS) the header switch is set to. */
function dateBlock(value: string, system: CalendarSystem) {
  const key = localDateKey(value);
  if (system === 'BS') {
    const [day, month] = formatAdDate(key, 'BS').split(' ');
    return { day, month: (month ?? '').slice(0, 3).toUpperCase() };
  }
  const [y, mo, d] = key.split('-').map(Number);
  return { day: String(d), month: new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: 'short' }).toUpperCase() };
}
function activityLabel(punchType: string) {
  if (punchType === '2') return 'Break';
  if (punchType === '3') return 'Back from break';
  return punchTypeLabel(punchType);
}

export default function CheckInScreen({ navigation }: any) {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const [modal, setModal] = useState<PunchModal | null>(null);
  const [gpsRequests, setGpsRequests] = useState<AttendanceGpsRequest[]>([]);
  const [history, setHistory] = useState<AttendanceLog[]>([]);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('weekly');
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [todayHoliday, setTodayHoliday] = useState<CompanyHoliday | null>(null);
  const [myGender, setMyGender] = useState<Gender | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState(0);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay }) => {
      setWeeklyOffDay(weeklyOffDay);
    });
    supabase.from('company_holidays').select('*').eq('holiday_date', today).maybeSingle().then(({ data }) => setTodayHoliday((data as CompanyHoliday) ?? null));
  }, []);

  const todayIsWeekOff = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return weekOffDatesInRange(today, today, weeklyOffDay, todayHoliday ? [todayHoliday] : [], myGender).has(today);
  }, [weeklyOffDay, todayHoliday, myGender]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setEmployeeId(profile?.employee_id ?? null);
      if (profile?.employee_id) {
        const { data: emp } = await supabase.from('employees').select('gender, name').eq('id', profile.employee_id).single();
        setMyGender((emp?.gender as Gender) ?? null);
        setMyName(emp?.name ?? null);
      }
    });
  }, []);

  // Reloads on focus too, so the summary card and pending-leave count are
  // current after coming back from Leave / Fix a Missed Punch.
  useEffect(() => {
    if (!employeeId) return;
    const load = () => {
      reloadGpsRequests(employeeId);
      reloadHistory(employeeId);
      reloadPendingLeave(employeeId);
    };
    load();
    return navigation.addListener('focus', load);
  }, [employeeId, navigation]);

  function reloadGpsRequests(empId: string) {
    supabase.from('attendance_gps_requests').select('*').eq('employee_id', empId).order('created_at', { ascending: false }).limit(10).then(({ data }) => setGpsRequests((data as AttendanceGpsRequest[]) ?? []));
  }
  function reloadHistory(empId: string) {
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', empId)
      .gte('punch_time', new Date(Date.now() - HISTORY_WINDOW_DAYS * 86400000).toISOString())
      .order('punch_time', { ascending: false })
      .limit(50)
      .then(({ data }) => setHistory((data as AttendanceLog[]) ?? []));
  }
  function reloadPendingLeave(empId: string) {
    supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', empId)
      .eq('status', 'pending')
      .then(({ count }) => setPendingLeave(count ?? 0));
  }

  const filteredHistory = useMemo(() => {
    const cutoff = Date.now() - HISTORY_RANGE_DAYS[historyRange] * 86400000;
    return history.filter(log => new Date(log.punch_time).getTime() >= cutoff);
  }, [history, historyRange]);

  const pendingGpsRequests = useMemo(() => gpsRequests.filter(r => r.status === 'pending'), [gpsRequests]);
  const rejectedGpsRequests = useMemo(() => gpsRequests.filter(r => r.status === 'rejected'), [gpsRequests]);

  const acceptedPunchIds = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of history) {
      const key = nepalDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const ids = new Set<string>();
    for (const dayLogs of byDate.values()) {
      const { checkIn, checkOut } = selectDayPunches(dayLogs);
      ids.add(checkIn.id);
      if (checkOut) ids.add(checkOut.id);
    }
    return ids;
  }, [history]);

  const historyEntries = useMemo(() => {
    const cutoff = Date.now() - HISTORY_RANGE_DAYS[historyRange] * 86400000;
    const fromLogs = filteredHistory.map(log => ({ id: log.id, punchTime: log.punch_time, punchType: log.punch_type, method: log.method, accepted: acceptedPunchIds.has(log.id) }));
    const fromRejected = rejectedGpsRequests
      .filter(r => new Date(r.punch_time).getTime() >= cutoff)
      .map(r => ({ id: `req-${r.id}`, punchTime: r.punch_time, punchType: r.punch_type, method: 'gps', accepted: false }));
    return [...fromLogs, ...fromRejected].sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime());
  }, [filteredHistory, acceptedPunchIds, rejectedGpsRequests, historyRange]);

  // Summary card: today's state from accepted punches, falling back to a
  // still-pending GPS request so a fresh Check In doesn't read "Not in".
  const today = nepalTodayIso();
  const todaySummary = useMemo(() => {
    const todayLogs = history.filter(l => nepalDateKey(l.punch_time) === today && l.punch_type !== '2' && l.punch_type !== '3');
    const punches = todayLogs.length ? selectDayPunches(todayLogs) : null;
    const pendingToday = pendingGpsRequests.some(r => nepalDateKey(r.punch_time) === today);
    const status = punches?.checkOut
      ? { label: 'Checked out', dot: colors.slate500 }
      : punches
        ? { label: 'Checked in', dot: colors.good }
        : pendingToday
          ? { label: 'Pending', dot: colors.warning }
          : { label: 'Not in', dot: colors.warning };
    const workedMinutes = punches
      ? Math.max(
          0,
          Math.round(
            ((punches.checkOut ? new Date(punches.checkOut.punch_time).getTime() : Date.now()) -
              new Date(punches.checkIn.punch_time).getTime()) /
              60000
          )
        )
      : 0;
    return { status, inAt: punches ? formatTime(punches.checkIn.punch_time) : '—', worked: formatHoursMinutes(workedMinutes) };
  }, [history, pendingGpsRequests, today]);

  const firstName = myName?.trim().split(/\s+/)[0];
  const [ty, tm, td] = today.split('-').map(Number);
  const weekday = new Date(ty, tm - 1, td).toLocaleDateString(undefined, { weekday: 'short' });
  const todayLine = `${weekday}, ${formatAdDate(today, 'AD')}  ·  ${formatAdDate(today, 'BS')}`;

  async function locate(base: PunchModal) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setModal({ ...base, status: 'error', error: 'Location permission is required.' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setModal(m => (m ? { ...m, status: 'ready', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } } : m));
    } catch (e: any) {
      setModal(m => (m ? { ...m, status: 'error', error: e.message ?? String(e) } : m));
    }
  }

  function openPunchModal(punchType: '0' | '1' | '2' | '3') {
    if (!employeeId) {
      setMessage({ kind: 'critical', text: 'No employee linked to this account.' });
      return;
    }
    const base: PunchModal = { punchType, punchTime: new Date().toISOString(), status: 'locating' };
    setModal(base);
    locate(base);
  }
  function retryLocate() {
    if (!modal) return;
    const base: PunchModal = { punchType: modal.punchType, punchTime: modal.punchTime, status: 'locating' };
    setModal(base);
    locate(base);
  }

  async function confirmPunch() {
    if (!modal || modal.status !== 'ready' || !modal.coords || !employeeId) return;
    setBusy(true);
    const { error } = await supabase.from('attendance_gps_requests').insert({
      employee_id: employeeId,
      punch_time: modal.punchTime,
      punch_type: modal.punchType,
      lat: modal.coords.lat,
      lng: modal.coords.lng,
      accuracy_m: modal.coords.accuracy,
    });
    setBusy(false);
    const punchType = modal.punchType;
    setModal(null);
    if (error) setMessage({ kind: 'critical', text: `Check-in failed: ${error.message}` });
    else {
      setMessage({ kind: 'good', text: `${punchTypeLabel(punchType)} submitted — waiting for Admin/HR approval.` });
      reloadGpsRequests(employeeId);
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ paddingBottom: 20 }}
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <Text style={styles.greeting} numberOfLines={1}>
                Namaste{firstName ? `, ${firstName}` : ''}
              </Text>
              <Text style={styles.heroDate}>{todayLine}</Text>
            </View>

            <View style={styles.body}>
              <View style={styles.summaryCard}>
                <View style={styles.statsRow}>
                  <View style={[styles.stat, styles.statFirst]}>
                    <Text style={styles.statLabel}>Status</Text>
                    <View style={styles.statValueRow}>
                      <View style={[styles.statusDot, { backgroundColor: todaySummary.status.dot }]} />
                      <Text style={[styles.statValue, { marginTop: 0 }]} numberOfLines={1}>
                        {todaySummary.status.label}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.stat, styles.statDivider]}>
                    <Text style={styles.statLabel}>In at</Text>
                    <Text style={styles.statValue} numberOfLines={1}>
                      {todaySummary.inAt}
                    </Text>
                  </View>
                  <View style={[styles.stat, styles.statDivider]}>
                    <Text style={styles.statLabel}>Today</Text>
                    <Text style={styles.statValue} numberOfLines={1}>
                      {todaySummary.worked}
                    </Text>
                  </View>
                </View>

                <View style={styles.punchRow}>
                  <TouchableOpacity style={[styles.primaryBtn, !employeeId && styles.btnDisabled]} disabled={!employeeId} onPress={() => openPunchModal('0')}>
                    <SignInIcon color={colors.white} />
                    <Text style={styles.primaryBtnText}>Check In</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.outlineBtn, !employeeId && styles.btnDisabled]} disabled={!employeeId} onPress={() => openPunchModal('1')}>
                    <SignOutIcon size={18} color={colors.accent} />
                    <Text style={styles.outlineBtnText}>Check Out</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.gpsNote}>
                  <PinIcon size={14} color={colors.slate500} />
                  <Text style={styles.gpsNoteText}>Uses your GPS location · approved by Admin/HR</Text>
                </View>
              </View>

              {todayIsWeekOff && (
                <View style={[styles.banner, { backgroundColor: colors.infoBg }]}>
                  <Text style={{ color: colors.infoText, fontSize: 13, fontWeight: '600' }}>
                    Today is a Week-off{todayHoliday?.name ? ` — ${todayHoliday.name}` : ''}. No one is expected to work today.
                  </Text>
                </View>
              )}
              {message && (
                <View style={[styles.banner, { backgroundColor: message.kind === 'good' ? colors.goodBg : colors.criticalBg }]}>
                  <Text style={{ color: message.kind === 'good' ? colors.goodText : colors.criticalText, fontSize: 13 }}>{message.text}</Text>
                </View>
              )}

              <View style={styles.actionsCard}>
                <TouchableOpacity style={[styles.actionRow, styles.actionRowDivider]} onPress={() => navigation.getParent()?.navigate('FixPunch')}>
                  <View style={styles.actionIcon}>
                    <EditIcon size={18} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actionTitle}>Fix a missed punch</Text>
                    <Text style={styles.actionSub}>Forgot to check in or out?</Text>
                  </View>
                  <ChevronRightIcon color={colors.slate500} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionRow} onPress={() => navigation.getParent()?.navigate('Leave')}>
                  <View style={styles.actionIcon}>
                    <UmbrellaIcon color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actionTitle}>Leave requests</Text>
                    <Text style={styles.actionSub}>Casual, sick and annual</Text>
                  </View>
                  {pendingLeave > 0 && (
                    <View style={styles.pendingPill}>
                      <Text style={styles.pendingPillText}>{pendingLeave} pending</Text>
                    </View>
                  )}
                  <ChevronRightIcon color={colors.slate500} />
                </TouchableOpacity>
              </View>

              {pendingGpsRequests.length > 0 && (
                <>
                  <Text style={styles.sectionHeading}>Waiting for approval</Text>
                  {pendingGpsRequests.map(r => {
                    const block = dateBlock(r.punch_time, system);
                    return (
                      <View key={r.id} style={styles.row}>
                        <View style={styles.dateBlock}>
                          <Text style={styles.dateDay}>{block.day}</Text>
                          <Text style={styles.dateMonth}>{block.month}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>
                            {punchTypeLabel(r.punch_type)} · {formatTime(r.punch_time)}
                          </Text>
                          <Text style={styles.rowSub}>GPS</Text>
                        </View>
                        <Badge tone={statusTone(r.status)}>{r.status === 'approved' ? 'Accepted' : r.status}</Badge>
                      </View>
                    );
                  })}
                </>
              )}

              <View style={styles.historyHeader}>
                <Text style={styles.sectionHeadingInline}>Recent activity</Text>
                <View style={styles.segmented}>
                  {(['daily', 'weekly', 'monthly'] as const).map(r => (
                    <TouchableOpacity key={r} style={[styles.segment, historyRange === r && styles.segmentActive]} onPress={() => setHistoryRange(r)}>
                      <Text style={[styles.segmentText, historyRange === r && styles.segmentTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </>
        }
        data={historyEntries}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const block = dateBlock(item.punchTime, system);
          return (
            <View style={[styles.row, styles.listRow]}>
              <View style={styles.dateBlock}>
                <Text style={styles.dateDay}>{block.day}</Text>
                <Text style={styles.dateMonth}>{block.month}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {activityLabel(item.punchType)} · {formatTime(item.punchTime)}
                </Text>
                <Text style={[styles.rowSub, { textTransform: 'capitalize' }]}>{item.method}</Text>
              </View>
              <Badge tone={item.accepted ? 'good' : 'critical'}>{item.accepted ? 'Accepted' : 'Rejected'}</Badge>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No attendance records for this period.</Text>}
      />

      <Modal visible={!!modal} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Confirm {modal ? punchTypeLabel(modal.punchType) : ''}</Text>
            <Text style={styles.modalSub}>{modal ? formatDateTime(modal.punchTime, system) : ''}</Text>
            {modal?.status === 'locating' && <Text style={styles.modalStatus}>📍 Getting your location…</Text>}
            {modal?.status === 'ready' && <Text style={[styles.modalStatus, { color: colors.goodText }]}>📍 Location confirmed</Text>}
            {modal?.status === 'error' && (
              <View style={{ marginBottom: 12 }}>
                <Text style={[styles.modalStatus, { color: colors.criticalText }]}>📍 {modal.error ?? 'Could not get your location.'}</Text>
                <TouchableOpacity onPress={retryLocate}>
                  <Text style={styles.retryLink}>Try again</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setModal(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmPunch} disabled={modal?.status !== 'ready' || busy} style={[styles.confirmBtn, (modal?.status !== 'ready' || busy) && { opacity: 0.5 }]}>
                <Text style={styles.submitBtnText}>{busy ? 'Submitting…' : 'Confirm'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate100 },
  hero: { backgroundColor: colors.accent, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 72 },
  greeting: { fontSize: 26, fontWeight: '800', color: colors.white, letterSpacing: -0.4 },
  heroDate: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.78)', marginTop: 4 },
  body: { paddingHorizontal: 20 },
  summaryCard: {
    marginTop: -56,
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 18,
    shadowColor: '#172554',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, paddingHorizontal: 10 },
  statFirst: { paddingLeft: 0 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.slate200 },
  statLabel: { fontSize: 11, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  statusDot: { height: 7, width: 7, borderRadius: 4 },
  statValue: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 4, flexShrink: 1 },
  punchRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primaryBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  outlineBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cdd5e3',
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  outlineBtnText: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  gpsNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  gpsNoteText: { fontSize: 12, fontWeight: '600', color: colors.slate500 },
  banner: { borderRadius: 12, padding: 12, marginTop: 12 },
  actionsCard: { marginTop: 14, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.slate200 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  actionRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  actionIcon: { height: 38, width: 38, borderRadius: 19, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  actionSub: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 1 },
  pendingPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.warningBg },
  pendingPillText: { fontSize: 11, fontWeight: '800', color: colors.warningText },
  sectionHeading: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 20, marginBottom: 8 },
  sectionHeadingInline: { fontSize: 16, fontWeight: '800', color: colors.ink },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 10 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: colors.slate200 },
  segment: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  segmentActive: { backgroundColor: colors.white },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.slate500, textTransform: 'capitalize' },
  segmentTextActive: { color: colors.accent, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, gap: 12 },
  listRow: { marginHorizontal: 20 },
  dateBlock: { height: 44, width: 44, borderRadius: 10, backgroundColor: colors.slate100, alignItems: 'center', justifyContent: 'center' },
  dateDay: { fontSize: 16, fontWeight: '800', color: colors.ink, lineHeight: 18 },
  dateMonth: { fontSize: 10, fontWeight: '800', color: colors.slate500, marginTop: 1 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  rowSub: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.slate500, marginTop: 20, marginHorizontal: 20 },
  submitBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  modalSub: { fontSize: 12, color: colors.slate500, marginTop: 4, marginBottom: 12 },
  modalStatus: { fontSize: 13, color: colors.slate500, marginBottom: 12 },
  retryLink: { fontSize: 12, fontWeight: '600', color: colors.accent, marginTop: 4 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  confirmBtn: { backgroundColor: colors.good, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
});
