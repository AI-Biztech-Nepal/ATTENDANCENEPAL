import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { nepalDateKey, punchTypeLabel, selectDayPunches } from '../lib/shift';
import type { AttendanceGpsRequest, AttendanceLog } from '../types';
import { ATTENDANCE_LOG_COLUMNS } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate, localDateKey } from '../lib/calendar';
import type { CalendarSystem } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '../lib/weekOff';
import type { CompanyHoliday, Gender } from '../types';

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
        const { data: emp } = await supabase.from('employees').select('gender').eq('id', profile.employee_id).single();
        setMyGender((emp?.gender as Gender) ?? null);
      }
    });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    reloadGpsRequests(employeeId);
    reloadHistory(employeeId);
  }, [employeeId]);

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
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
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
            <Text style={styles.intro}>
              Check In/Check Out use your current GPS location. Every request is reviewed by Admin/HR before it counts as
              attendance.
            </Text>
            <TouchableOpacity style={[styles.punchBtn, { backgroundColor: '#4ade80' }]} disabled={!employeeId} onPress={() => openPunchModal('0')}>
              <Text style={styles.punchBtnText}>📍 Check In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.punchBtn, { backgroundColor: colors.good }]} disabled={!employeeId} onPress={() => openPunchModal('1')}>
              <Text style={styles.punchBtnText}>📍 Check Out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.punchBtn, { backgroundColor: colors.good }]} onPress={() => navigation.getParent()?.navigate('FixPunch')}>
              <Text style={styles.punchBtnText}>🔧 Fix a Missed Punch</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.punchBtn, { backgroundColor: colors.good }]} onPress={() => navigation.getParent()?.navigate('Leave')}>
              <Text style={styles.punchBtnText}>🏖 Leave</Text>
            </TouchableOpacity>

            {pendingGpsRequests.length > 0 && (
              <>
                <Text style={styles.sectionHeading}>Recent Request</Text>
                {pendingGpsRequests.map(r => (
                  <View key={r.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{punchTypeLabel(r.punch_type)}</Text>
                      <Text style={styles.rowSub}>{formatDateTime(r.punch_time, system)}</Text>
                    </View>
                    <Badge tone={statusTone(r.status)}>{r.status === 'approved' ? 'Accepted' : r.status}</Badge>
                  </View>
                ))}
              </>
            )}

            <View style={styles.historyHeader}>
              <Text style={styles.sectionHeading}>History</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['daily', 'weekly', 'monthly'] as const).map(r => (
                  <TouchableOpacity key={r} style={[styles.rangeChip, historyRange === r && styles.rangeChipActive]} onPress={() => setHistoryRange(r)}>
                    <Text style={[styles.rangeChipText, historyRange === r && styles.rangeChipTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        }
        data={historyEntries}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View
              style={[
                styles.punchTypeBadge,
                { backgroundColor: item.punchType === '0' ? colors.goodBg : item.punchType === '1' ? colors.warningBg : colors.infoBg },
              ]}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: item.punchType === '0' ? colors.goodText : item.punchType === '1' ? colors.warningText : colors.infoText,
                }}
              >
                {item.punchType === '0' ? 'IN' : item.punchType === '1' ? 'OUT' : item.punchType === '2' ? 'BRK' : 'BACK'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{formatDateTime(item.punchTime, system)}</Text>
              <Text style={[styles.rowSub, { textTransform: 'capitalize' }]}>{item.method}</Text>
            </View>
            <Badge tone={item.accepted ? 'good' : 'critical'}>{item.accepted ? 'Accepted' : 'Rejected'}</Badge>
          </View>
        )}
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
  container: { flex: 1, backgroundColor: colors.slate50 },
  banner: { borderRadius: 10, padding: 12, marginBottom: 12 },
  intro: { fontSize: 12, color: colors.slate500, marginBottom: 12, lineHeight: 18 },
  punchBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  punchBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  sectionHeading: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 16, marginBottom: 8 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  rangeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.slate200 },
  rangeChipActive: { backgroundColor: colors.accent },
  rangeChipText: { fontSize: 11, fontWeight: '600', color: colors.slate500, textTransform: 'capitalize' },
  rangeChipTextActive: { color: colors.white },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginBottom: 8, gap: 10 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 11, color: colors.slate400, marginTop: 2 },
  punchTypeBadge: { width: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  empty: { textAlign: 'center', color: colors.slate400, marginTop: 20 },
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
