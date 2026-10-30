import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceGpsRequest, CorrectionRequest, Employee } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { nepalDateKey } from '../lib/shift';
import { usePendingApprovals } from '../lib/PendingApprovals';

const FILTERS = ['pending', 'approved', 'rejected', 'All'] as const;

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type UnifiedRequest =
  | { kind: 'correction'; id: string; employee_id: string; status: string; created_at: string; data: CorrectionRequest }
  | { kind: 'gps'; id: string; employee_id: string; status: string; created_at: string; data: AttendanceGpsRequest };

/** `kind` narrows the list to GPS check-ins or missed-punch corrections only —
 * how the owner's Approvals tab embeds this screen; More › Corrections shows both. */
export default function CorrectionsScreen({ kind }: { kind?: 'gps' | 'correction' }) {
  const { system } = useCalendarSystem();
  const { refresh: refreshPending } = usePendingApprovals();
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [gpsRequests, setGpsRequests] = useState<AttendanceGpsRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    supabase.from('attendance_correction_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRequests((data as CorrectionRequest[]) ?? []));
    supabase.from('attendance_gps_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setGpsRequests((data as AttendanceGpsRequest[]) ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees((data as Employee[]) ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

  const unified: UnifiedRequest[] = useMemo(() => {
    const corrections: UnifiedRequest[] = requests.map(r => ({ kind: 'correction', id: r.id, employee_id: r.employee_id, status: r.status, created_at: r.created_at, data: r }));
    const gps: UnifiedRequest[] = gpsRequests.map(r => ({ kind: 'gps', id: r.id, employee_id: r.employee_id, status: r.status, created_at: r.created_at, data: r }));
    return [...corrections, ...gps].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [requests, gpsRequests]);

  const filtered = useMemo(
    () => unified.filter(r => (!kind || r.kind === kind) && (filter === 'All' || r.status === filter)),
    [unified, filter, kind]
  );

  async function approve(item: UnifiedRequest) {
    setBusyId(item.id);
    const { error } = await supabase.rpc(item.kind === 'correction' ? 'approve_attendance_correction' : 'approve_attendance_gps_request', { p_request_id: item.id });
    setBusyId(null);
    if (error) Alert.alert('Could not approve', error.message);
    reload();
    refreshPending();
  }

  async function reject(item: UnifiedRequest) {
    setBusyId(item.id);
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase
      .from(item.kind === 'correction' ? 'attendance_correction_requests' : 'attendance_gps_requests')
      .update({ status: 'rejected', reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', item.id);
    setBusyId(null);
    if (error) Alert.alert('Could not reject', error.message);
    reload();
    refreshPending();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={item => `${item.kind}-${item.id}`}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
            {!kind && (
              <Text style={styles.intro}>
                Requests from employees — a missed punch, or a live check-in/out submitted from their phone. Approving a missed punch
                recalculates that day's hours and locks it against the nightly recompute.
              </Text>
            )}
            <View style={styles.filterBar}>
              {FILTERS.map(f => (
                <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
                  <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        }
        renderItem={({ item }) => {
          const lat = item.data.lat;
          const lng = item.data.lng;
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{employeeName(item.employee_id)}</Text>
                  <Text style={styles.type}>
                    {item.kind === 'correction' ? 'Missed Punch' : item.data.punch_type === '0' ? 'Check In' : 'Check Out'} ·{' '}
                    {formatAdDate(item.kind === 'correction' ? item.data.work_date : nepalDateKey(item.data.punch_time), system)}
                  </Text>
                </View>
                <Badge tone={item.status === 'approved' ? 'good' : item.status === 'rejected' ? 'critical' : 'warning'}>{item.status}</Badge>
              </View>
              <Text style={styles.detail}>
                {item.kind === 'correction' ? `In ${formatTime(item.data.requested_check_in)} · Out ${formatTime(item.data.requested_check_out)}` : formatTime(item.data.punch_time)}
              </Text>
              {item.kind === 'correction' && item.data.reason ? <Text style={styles.reason}>{item.data.reason}</Text> : null}
              {lat != null && lng != null ? (
                <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)}>
                  <Text style={styles.locationLink}>View location</Text>
                </TouchableOpacity>
              ) : null}
              {item.status === 'pending' && (
                <View style={styles.actions}>
                  <TouchableOpacity disabled={busyId === item.id} style={styles.rejectBtn} onPress={() => reject(item)}>
                    <Text style={styles.rejectText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busyId === item.id} style={styles.approveBtn} onPress={() => approve(item)}>
                    <Text style={styles.approveText}>Approve</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No {filter !== 'All' ? filter : ''} requests.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate100 },
  intro: { fontSize: 12, color: colors.slate500, lineHeight: 18, marginBottom: 12 },
  filterBar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.slate500, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 15, fontWeight: '800', color: colors.ink },
  type: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 2 },
  detail: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 10 },
  reason: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  locationLink: { fontSize: 13, color: colors.accent, marginTop: 6, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  approveBtn: { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  approveText: { color: colors.white, fontSize: 14, fontWeight: '800' },
  rejectBtn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: '#fecaca', alignItems: 'center', justifyContent: 'center' },
  rejectText: { color: colors.criticalText, fontSize: 14, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate500 },
});
