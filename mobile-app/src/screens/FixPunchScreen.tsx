import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { nepalDateTimeToUtcMs } from '../lib/shift';
import type { CorrectionRequest } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import DatePicker from '../components/DatePicker';

// Pushed from Check In/Out as its own stack page (same as Leave) so the
// shared header's back button handles going back, not an in-page link.

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}
function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function FixPunchScreen() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [workDate, setWorkDate] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('attendance_correction_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests((data as CorrectionRequest[]) ?? []));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      if (profile?.employee_id) {
        setEmployeeId(profile.employee_id);
        reload(profile.employee_id);
      }
    });
  }, []);

  async function handleSubmit() {
    if (!employeeId) return;
    setError(null);
    if (!workDate || (!checkInTime && !checkOutTime)) {
      setError('Pick a date and at least one of check-in or check-out time.');
      return;
    }
    setSubmitting(true);
    let coords: { lat: number; lng: number } | null = null;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    } catch {
      // best-effort only
    }
    const { error: insertError } = await supabase.from('attendance_correction_requests').insert({
      employee_id: employeeId,
      work_date: workDate,
      requested_check_in: checkInTime ? new Date(nepalDateTimeToUtcMs(workDate, checkInTime)).toISOString() : null,
      requested_check_out: checkOutTime ? new Date(nepalDateTimeToUtcMs(workDate, checkOutTime)).toISOString() : null,
      reason: reason || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setWorkDate('');
    setCheckInTime('');
    setCheckOutTime('');
    setReason('');
    reload(employeeId);
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={
        <>
          <Text style={styles.intro}>
            Forgot to check in or out? Request a correction and HR/Admin will review it. Your current location is captured
            automatically as confirmation.
          </Text>
          <View style={styles.form}>
            <Text style={styles.label}>Date</Text>
            <DatePicker value={workDate} onChange={setWorkDate} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Check-in (HH:MM)</Text>
                <TextInput style={styles.input} value={checkInTime} onChangeText={setCheckInTime} placeholder="09:00" placeholderTextColor={colors.slate400} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Check-out (HH:MM)</Text>
                <TextInput style={styles.input} value={checkOutTime} onChangeText={setCheckOutTime} placeholder="18:00" placeholderTextColor={colors.slate400} />
              </View>
            </View>
            <Text style={styles.label}>Reason (optional)</Text>
            <TextInput style={[styles.input, { height: 60 }]} value={reason} onChangeText={setReason} multiline placeholderTextColor={colors.slate400} />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
              <Text style={styles.submitBtnText}>{submitting ? 'Submitting…' : 'Submit request'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionHeading}>My requests</Text>
        </>
      }
      data={requests}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{formatAdDate(item.work_date, system)}</Text>
            <Text style={styles.rowSub}>
              In {formatTime(item.requested_check_in)} · Out {formatTime(item.requested_check_out)}
            </Text>
            {item.reason ? <Text style={styles.rowSub}>{item.reason}</Text> : null}
          </View>
          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No correction requests yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  intro: { fontSize: 12, color: colors.slate500, marginBottom: 12, lineHeight: 18 },
  sectionHeading: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginBottom: 8, gap: 10 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 11, color: colors.slate400, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.slate400, marginTop: 20 },
  form: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, padding: 10, fontSize: 14, color: colors.ink },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  submitBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  submitBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
});
