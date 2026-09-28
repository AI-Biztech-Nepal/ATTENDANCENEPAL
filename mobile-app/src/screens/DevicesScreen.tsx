import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, Branch, Device, DeviceSyncEvent, Employee } from '../types';
import { ATTENDANCE_LOG_COLUMNS } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';

const EMPTY_FORM = { name: '', branch_id: '', ip_address: '192.168.1.201', port: '4370', serial_number: '' };

export default function DevicesScreen() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [syncEvents, setSyncEvents] = useState<DeviceSyncEvent[]>([]);
  const [queuing, setQueuing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  function reload() {
    supabase.from('devices').select('*').then(({ data }) => setDevices((data as Device[]) ?? []));
    supabase.from('branches').select('*').then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees((data as Employee[]) ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('method', 'zkteco')
      .then(({ data }) => setLogs((data as AttendanceLog[]) ?? []));
    supabase
      .from('device_sync_events')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setSyncEvents((data as DeviceSyncEvent[]) ?? []));
  }
  useEffect(reload, []);

  useEffect(() => {
    const channel = supabase
      .channel('devices-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'devices' }, payload => {
        setDevices(prev => [...prev, payload.new as Device]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
        const updated = payload.new as Device;
        setDevices(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'devices' }, payload => {
        const removed = payload.old as Device;
        setDevices(prev => prev.filter(d => d.id !== removed.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Poll every 3s only while a RECENT sync is queued/running — the 2-minute
  // cutoff on requested_at stops the poll running forever on a sync stuck
  // 'pending' because the bridge is offline.
  useEffect(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    const active = syncEvents.some(
      e => (e.status === 'pending' || e.status === 'running') && new Date(e.requested_at).getTime() > cutoff
    );
    if (!active) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [syncEvents]);

  async function queueSync(deviceId: string, syncType: 'users' | 'logs') {
    setQueuing(`${deviceId}-${syncType}`);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from('device_sync_events').insert({ device_id: deviceId, sync_type: syncType, requested_by: user?.id ?? null });
    setQueuing(null);
    if (error) Alert.alert('Could not queue sync', error.message);
    reload();
  }

  async function cancelSync(eventId: string) {
    const { error } = await supabase.from('device_sync_events').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', eventId);
    if (error) Alert.alert('Could not cancel', error.message);
    reload();
  }

  async function handleDelete(d: Device) {
    Alert.alert('Remove device', `Remove ${d.name}? Past punches synced from it are kept, but it will stop being polled.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('devices').delete().eq('id', d.id);
          if (error) Alert.alert('Could not remove', error.message);
          reload();
        },
      },
    ]);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.serial_number.trim()) {
      setFormError('Name and serial number are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.from('devices').insert({
      name: form.name,
      branch_id: form.branch_id || null,
      ip_address: form.ip_address,
      port: Number(form.port) || 4370,
      serial_number: form.serial_number,
    });
    setSaving(false);
    if (error) {
      setFormError(error.code === '23505' ? 'That serial number is already registered to another device.' : error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={devices}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
            <Text style={styles.intro}>
              zkteco-bridge polls every device every 15 seconds and writes here. Sync Users/Sync Log queue an on-demand request the
              bridge picks up right away.
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)}>
              <Text style={styles.addBtnText}>+ Add Device</Text>
            </TouchableOpacity>
          </>
        }
        renderItem={({ item: d }) => {
          const branch = branches.find(b => b.id === d.branch_id);
          const registered = employees.filter(e => e.branch_id === d.branch_id && e.fingerprint_id).length;
          const fetched = logs.filter((l: any) => l.device_id === d.id).length;
          const deviceEvents = syncEvents.filter(e => e.device_id === d.id);
          const busy = (type: 'users' | 'logs') =>
            queuing === `${d.id}-${type}` || deviceEvents.some(e => e.sync_type === type && (e.status === 'pending' || e.status === 'running'));
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.deviceName}>{d.name}</Text>
                <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
              </View>
              <Text style={styles.address}>
                {d.ip_address}:{d.port}
              </Text>
              <Text style={styles.detail}>📍 {branch?.name ?? 'Unassigned branch'}</Text>
              <Text style={styles.detail}>🔢 Serial: {d.serial_number ?? '—'}</Text>
              <Text style={styles.detail}>🔄 Last sync: {d.last_sync ? new Date(d.last_sync).toLocaleString() : 'never'}</Text>
              <Text style={styles.detail}>👥 Registered: {registered} staff</Text>
              <View style={styles.footerRow}>
                <Text style={styles.fetched}>{fetched} punches fetched</Text>
                <TouchableOpacity onPress={() => handleDelete(d)}>
                  <Text style={styles.removeLink}>Remove</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.syncRow}>
                <TouchableOpacity style={styles.syncBtn} disabled={busy('users')} onPress={() => queueSync(d.id, 'users')}>
                  <Text style={styles.syncBtnText}>{busy('users') ? 'Syncing…' : '👥 Sync Users'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.syncBtn} disabled={busy('logs')} onPress={() => queueSync(d.id, 'logs')}>
                  <Text style={styles.syncBtnText}>{busy('logs') ? 'Syncing…' : '🕐 Sync Log'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No devices registered yet.</Text>}
        ListFooterComponent={
          <View style={{ marginTop: 8 }}>
            <Text style={styles.sectionTitle}>Sync History</Text>
            {syncEvents.length === 0 ? (
              <Text style={styles.empty}>No sync requests yet.</Text>
            ) : (
              syncEvents.map(e => {
                const device = devices.find(d => d.id === e.device_id);
                return (
                  <View key={e.id} style={styles.historyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyName}>{device?.name ?? 'Unknown device'}</Text>
                      <Text style={styles.historyMeta}>{e.sync_type === 'users' ? '👥 Users' : '🕐 Log'} · {new Date(e.requested_at).toLocaleString()}</Text>
                      {e.summary && <Text style={styles.historySummary}>{e.summary}</Text>}
                      {e.error && <Text style={styles.historyError}>{e.error}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Badge tone={e.status === 'success' ? 'good' : e.status === 'failed' ? 'critical' : e.status === 'running' ? 'info' : 'neutral'}>
                        {e.status}
                      </Badge>
                      {e.status === 'pending' && (
                        <TouchableOpacity onPress={() => cancelSync(e.id)}>
                          <Text style={styles.removeLink}>Cancel</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        }
      />

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>Add Device</Text>
            <Text style={styles.formLabel}>Name</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
            <Text style={styles.formLabel}>Branch (optional)</Text>
            <TouchableOpacity style={styles.input} onPress={() => setBranchPickerOpen(true)}>
              <Text style={{ color: form.branch_id ? colors.ink : colors.slate400 }}>
                {branches.find(b => b.id === form.branch_id)?.name ?? 'Unassigned'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.formLabel}>IP address</Text>
            <TextInput style={styles.input} value={form.ip_address} onChangeText={v => setForm(f => ({ ...f, ip_address: v }))} />
            <Text style={styles.formLabel}>Port</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={form.port} onChangeText={v => setForm(f => ({ ...f, port: v }))} />
            <Text style={styles.formLabel}>Serial number</Text>
            <TextInput style={styles.input} value={form.serial_number} onChangeText={v => setForm(f => ({ ...f, serial_number: v }))} placeholder="Printed on the unit" />
            {formError && <Text style={styles.errorText}>{formError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreate} disabled={saving} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Add device'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={branchPickerOpen} transparent animationType="fade" onRequestClose={() => setBranchPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setBranchPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={[{ id: '', name: 'Unassigned' }, ...branches]}
              keyExtractor={item => item.id || 'unassigned'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setForm(f => ({ ...f, branch_id: item.id }));
                    setBranchPickerOpen(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  intro: { fontSize: 12, color: colors.slate500, marginBottom: 12, lineHeight: 18 },
  addBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  addBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.slate200 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  deviceName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  address: { fontSize: 12, color: colors.slate500, marginBottom: 6 },
  detail: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate100 },
  fetched: { fontSize: 12, fontWeight: '700', color: colors.accent },
  removeLink: { fontSize: 11, fontWeight: '600', color: colors.criticalText },
  syncRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  syncBtn: { flex: 1, borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  syncBtnText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  empty: { textAlign: 'center', marginTop: 20, marginBottom: 20, color: colors.slate400 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 8, marginBottom: 8 },
  historyRow: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginBottom: 8, gap: 8 },
  historyName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  historyMeta: { fontSize: 11, color: colors.slate500, marginTop: 2 },
  historySummary: { fontSize: 11, color: colors.slate500, marginTop: 4 },
  historyError: { fontSize: 11, color: colors.criticalText, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  formLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink, justifyContent: 'center' },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
