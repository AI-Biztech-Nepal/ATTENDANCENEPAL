import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Modal, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { AttendanceLog, Device, Employee, PayrollSummary, Shift } from '../types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '../types';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalDateKey,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
  type WeeklyPatternByEmployee,
} from '../lib/shift';
import { fetchMyCompanyWeekOffConfig } from '../lib/weekOff';
import { colors } from '../theme';
import { formatDdMmYyyy } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import DateRangePicker from '../components/DateRangePicker';

type Row = {
  key: string;
  date: string;
  enrollId: string;
  employeeName: string;
  device: string;
  shiftLabel: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming';
  lateMinutes: number;
  earlyMinutes: number;
  overtime: number;
};

const COLS = [
  { key: 'date', label: 'Date', width: 64 },
  { key: 'enrollId', label: 'ID', width: 48 },
  { key: 'employeeName', label: 'Employee', width: 120 },
  { key: 'shiftLabel', label: 'Shift', width: 130 },
  { key: 'inOut', label: 'In / Out', width: 100 },
  { key: 'lateEarly', label: 'Late/Early', width: 90 },
  { key: 'hours', label: 'Work Hrs', width: 64 },
  { key: 'overtime', label: 'OT', width: 56 },
  { key: 'status', label: 'Status', width: 64 },
  { key: 'device', label: 'Device', width: 110 },
] as const;
const EMPLOYEE_COLS = COLS.filter(c => c.key !== 'employeeName' && c.key !== 'enrollId');

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–';
}
function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const STATUS_OPTIONS = ['All', 'Present', 'Absent', 'Late', 'Early'] as const;

export default function HistoryScreen() {
  const { profile } = useAuth();
  const { system } = useCalendarSystem();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'hr';

  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('All');
  const [statusOpen, setStatusOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('all');
  const [employeeOpen, setEmployeeOpen] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAdmin) {
      supabase
        .from('employees')
        .select('*')
        .eq('status', 'active')
        .then(({ data }) =>
          setEmployees(((data as Employee[]) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
        );
      supabase.from('devices').select('*').then(({ data }) => setDevices((data as Device[]) ?? []));
    }
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    fetchMyCompanyWeekOffConfig().then(({ rosterMode }) => {
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows((data as any) ?? []));
      }
    });
  }, [isAdmin]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', from).lte('work_date', to),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', `${from}T00:00:00Z`).lte('punch_time', `${to}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', from).lte('work_date', to),
    ]).then(([summariesRes, logsRes, rosterRes]) => {
      setSummaries((summariesRes.data as PayrollSummary[]) ?? []);
      setLogs((logsRes.data as AttendanceLog[]) ?? []);
      setDailyShiftRows((rosterRes.data as any) ?? []);
      setLoading(false);
    });
  }, [from, to]);

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );
  const selfEmployee = useMemo(() => {
    if (isAdmin || !profile?.employee_id) return null;
    return employees.find(e => e.id === profile.employee_id) ?? null;
  }, [isAdmin, profile, employees]);

  useEffect(() => {
    if (!isAdmin && profile?.employee_id) {
      supabase
        .from('employees')
        .select('*')
        .eq('id', profile.employee_id)
        .then(({ data }) => setEmployees((data as Employee[]) ?? []));
    }
  }, [isAdmin, profile]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

  const deviceName = (id: string | null | undefined) => devices.find(d => d.id === id)?.name ?? 'Mobile / QR / Selfie';

  const rows: Row[] = useMemo(() => {
    const activeEmployees = isAdmin ? scopedEmployees : selfEmployee ? [selfEmployee] : [];
    const days: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const today = nepalTodayIso();

    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of activeEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => nepalDateKey(l.punch_time) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, undefined, weeklyPattern, days);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    const out: Row[] = [];
    for (const day of days) {
      for (const emp of activeEmployees) {
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, undefined, weeklyPattern);
        const shiftLabel = isWeekOff(resolved) ? 'Week Off' : `${resolved.name} (${resolved.start_time.slice(0, 5)}–${resolved.end_time.slice(0, 5)})`;

        if (summary && summary.check_in) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0]?.device_id ?? null),
            shiftLabel,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: summary.total_hours,
            status: summary.is_late ? 'Late' : 'Present',
            lateMinutes: summary.is_late ? summary.late_minutes : 0,
            earlyMinutes: summary.is_early_departure ? summary.early_departure_minutes : 0,
            overtime: summary.overtime_hours,
          });
        } else if (dayLogs.length > 0) {
          const live = computeDayStatusForResolvedShift(dayLogs, resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0].device_id ?? null),
            shiftLabel,
            checkIn: live.checkIn.punch_time,
            checkOut: live.checkOut?.punch_time ?? null,
            hours: live.totalMinutes / 60,
            status: live.isLate ? 'Late' : 'Present',
            lateMinutes: live.lateMinutes,
            earlyMinutes: live.earlyMinutes,
            overtime: live.overtimeMinutes / 60,
          });
        } else {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: 'N/A',
            shiftLabel,
            checkIn: null,
            checkOut: null,
            hours: 0,
            status: day > today ? 'Upcoming' : 'Absent',
            lateMinutes: 0,
            earlyMinutes: 0,
            overtime: 0,
          });
        }
      }
    }
    return out
      .filter(r => status === 'All' || (status === 'Early' ? r.earlyMinutes > 0 : r.status === status))
      .sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, scopedEmployees, selfEmployee, summaries, logs, shifts, from, to, status, dailyShiftByDate, devices, weeklyPattern]);

  const totals = useMemo(() => {
    const workHours = rows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = rows.reduce((sum, r) => sum + r.overtime, 0);
    const lateMinutes = rows.reduce((sum, r) => sum + r.lateMinutes, 0);
    const earlyMinutes = rows.reduce((sum, r) => sum + r.earlyMinutes, 0);
    const presentDays = rows.filter(r => r.checkIn).length;
    const absentDays = rows.filter(r => !r.checkIn && r.status !== 'Upcoming').length;
    return { workHours, overtimeHours, lateMinutes, earlyMinutes, presentDays, absentDays };
  }, [rows]);

  const cols = isAdmin ? COLS : EMPLOYEE_COLS;
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);

  async function exportCsv() {
    const header = ['Date', 'ID', 'Employee', 'Shift', 'Check-In', 'Check-Out', 'Late By (min)', 'Early Out (min)', 'Total Work Hours', 'Overtime', 'Status', 'Device'];
    const lines = rows.map(r =>
      [
        r.date,
        r.enrollId,
        r.employeeName,
        r.shiftLabel,
        r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour12: false }) : '',
        r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour12: false }) : '',
        r.lateMinutes || '',
        r.earlyMinutes || '',
        r.hours.toFixed(1),
        r.overtime.toFixed(1),
        r.status,
        r.device,
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const fileUri = `${FileSystem.cacheDirectory}attendance_${from}_to_${to}.csv`;
    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export attendance CSV' });
    } else {
      Alert.alert('Sharing is not available on this device.');
    }
  }

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <View style={styles.filterChipsRow}>
          {isAdmin && (
            <TouchableOpacity style={styles.chip} onPress={() => setEmployeeOpen(true)}>
              <Text style={styles.chipText} numberOfLines={1}>
                {employeeId === 'all' ? 'All Employees' : employees.find(e => e.id === employeeId)?.name ?? 'Employee'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.chip} onPress={() => setStatusOpen(true)}>
            <Text style={styles.chipText}>{status === 'All' ? 'All Logs' : status}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={exportCsv}>
          <Text style={styles.exportBtnText}>⭳ Export CSV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }} contentContainerStyle={{ width: tableWidth, flexGrow: 1 }}>
        <View style={{ flex: 1 }}>
          <View style={styles.tableHeader}>
            {cols.map(c => (
              <Text key={c.key} style={[styles.th, { width: c.width }]}>
                {c.label}
              </Text>
            ))}
          </View>

          <FlatList
            data={rows}
            keyExtractor={item => item.key}
            renderItem={({ item, index }) => (
              <View style={[styles.tr, index % 2 === 1 && styles.trAlt]}>
                {isAdmin && (
                  <>
                    <Text style={[styles.td, { width: 64 }]}>{formatDdMmYyyy(item.date, system).slice(0, 5)}</Text>
                    <Text style={[styles.td, { width: 48 }]}>{item.enrollId}</Text>
                    <Text style={[styles.td, styles.tdName, { width: 120 }]} numberOfLines={1}>
                      {item.employeeName}
                    </Text>
                  </>
                )}
                {!isAdmin && <Text style={[styles.td, { width: 64 }]}>{formatDdMmYyyy(item.date, system).slice(0, 5)}</Text>}
                <Text style={[styles.td, { width: 130 }]} numberOfLines={1}>
                  {item.shiftLabel}
                </Text>
                <Text style={[styles.td, { width: 100 }]}>
                  {fmtTime(item.checkIn)}-{fmtTime(item.checkOut)}
                </Text>
                <Text style={[styles.td, { width: 90 }]}>
                  {item.lateMinutes === 0 && item.earlyMinutes === 0 && <Text style={styles.dim}>—</Text>}
                  {item.lateMinutes > 0 && <Text style={{ color: colors.warningText }}>L{formatHoursMinutes(item.lateMinutes)}</Text>}
                  {item.earlyMinutes > 0 && <Text style={{ color: colors.criticalText }}> E{formatHoursMinutes(item.earlyMinutes)}</Text>}
                </Text>
                <Text style={[styles.td, { width: 64 }]}>{fmtHrs(item.hours)}</Text>
                <Text style={[styles.td, { width: 56, color: colors.infoText }]}>{fmtHrs(item.overtime)}</Text>
                <Text
                  style={[
                    styles.td,
                    { width: 64 },
                    item.checkIn ? { color: colors.goodText } : item.status === 'Upcoming' ? styles.dim : { color: colors.criticalText },
                  ]}
                >
                  {item.checkIn ? 'Present' : item.status === 'Upcoming' ? 'Upcoming' : 'Absent'}
                </Text>
                <Text style={[styles.td, { width: 110 }]} numberOfLines={1}>
                  {item.device}
                </Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No records in this range.</Text>}
            ListFooterComponent={
              rows.length > 0 ? (
                <View style={styles.footerRow}>
                  {isAdmin ? (
                    <Text style={[styles.tf, { width: 64 + 48 + 120 }]}>Total</Text>
                  ) : (
                    <Text style={[styles.tf, { width: 64 }]}>Total</Text>
                  )}
                  <Text style={[styles.tf, { width: 130 }]} />
                  <Text style={[styles.tf, { width: 100 }]}>
                    <Text style={{ color: colors.goodText }}>{totals.presentDays}P</Text> <Text style={{ color: colors.criticalText }}>{totals.absentDays}A</Text>
                  </Text>
                  <Text style={[styles.tf, { width: 90 }]}>
                    {totals.lateMinutes > 0 && <Text style={{ color: colors.warningText }}>L{formatHoursMinutes(totals.lateMinutes)}</Text>}
                    {totals.earlyMinutes > 0 && <Text style={{ color: colors.criticalText }}> E{formatHoursMinutes(totals.earlyMinutes)}</Text>}
                    {totals.lateMinutes === 0 && totals.earlyMinutes === 0 && '—'}
                  </Text>
                  <Text style={[styles.tf, { width: 64 }]}>{fmtHrs(totals.workHours)}</Text>
                  <Text style={[styles.tf, { width: 56, color: colors.infoText }]}>{fmtHrs(totals.overtimeHours)}</Text>
                  <Text style={[styles.tf, { width: 64 }]} />
                  <Text style={[styles.tf, { width: 110 }]} />
                </View>
              ) : null
            }
          />
        </View>
      </ScrollView>

      {isAdmin && (
        <Modal visible={employeeOpen} transparent animationType="fade" onRequestClose={() => setEmployeeOpen(false)}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEmployeeOpen(false)}>
            <View style={styles.modalSheet}>
              <FlatList
                data={[{ id: 'all', name: 'All Employees' } as any, ...employees]}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => {
                      setEmployeeId(item.id);
                      setEmployeeOpen(false);
                    }}
                  >
                    <Text style={[styles.modalOptionText, employeeId === item.id && { color: colors.accent, fontWeight: '700' }]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      <Modal visible={statusOpen} transparent animationType="fade" onRequestClose={() => setStatusOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setStatusOpen(false)}>
          <View style={styles.modalSheet}>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={styles.modalOption}
                onPress={() => {
                  setStatus(s);
                  setStatusOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, status === s && { color: colors.accent, fontWeight: '700' }]}>
                  {s === 'All' ? 'All Logs' : s}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.white },
  filterBar: { backgroundColor: colors.slate50, borderBottomWidth: 1, borderBottomColor: colors.slate200, padding: 12, gap: 8 },
  filterChipsRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  exportBtn: { alignSelf: 'flex-end', borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentLight, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  exportBtnText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.slate50,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  th: { fontSize: 9, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', paddingHorizontal: 2 },
  tr: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  trAlt: { backgroundColor: colors.slate50 },
  td: { fontSize: 10, color: colors.slate500, paddingHorizontal: 2 },
  tdName: { color: colors.ink, fontWeight: '600' },
  dim: { color: colors.slate400 },
  footerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, backgroundColor: colors.slate50, borderTopWidth: 2, borderTopColor: colors.slate200 },
  tf: { fontSize: 10, fontWeight: '700', color: colors.ink, paddingHorizontal: 2 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
