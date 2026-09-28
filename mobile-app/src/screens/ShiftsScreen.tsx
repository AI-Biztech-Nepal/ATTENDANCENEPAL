import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Employee, Shift } from '../types';
import { resolveShift, formatShiftHours } from '../lib/shift';
import { fetchAll } from '../lib/leaveBalance';
import { colors } from '../theme';
import Badge from '../components/Badge';

const EMPTY_FORM = { name: '', type: 'fixed' as Shift['type'], start_time: '09:00', end_time: '18:00', grace_minutes: '10', department: '' };

export default function ShiftsScreen() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rosterEmployeeIds, setRosterEmployeeIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'templates' | 'roster'>('templates');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [assignPickerFor, setAssignPickerFor] = useState<Employee | null>(null);

  function reload() {
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    supabase.from('employees').select('*').eq('status', 'active').then(({ data }) => setEmployees((data as Employee[]) ?? []));
    // Whole table, no date filter — a company with enough roster history
    // passes PostgREST's default 1000-row cap on a plain select(), which
    // silently truncates rather than erroring, so per-shift headcounts here
    // could quietly under-count. fetchAll pages through every row instead.
    fetchAll<{ employee_id: string }>((a, b) => supabase.from('employee_daily_shifts').select('employee_id').range(a, b)).then(rows =>
      setRosterEmployeeIds(new Set(rows.map(r => r.employee_id)))
    );
  }
  useEffect(reload, []);

  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);

  const countsByShift = useMemo(() => {
    const counts = new Map<string, number>();
    for (const emp of employees) {
      const shift = resolveShift(emp, shifts);
      counts.set(shift.id, (counts.get(shift.id) ?? 0) + 1);
    }
    return counts;
  }, [employees, shifts]);

  async function handleAssignShift(employeeId: string, templateId: string) {
    if (!templateId) {
      await supabase.from('shifts').delete().eq('employee_id', employeeId);
      reload();
      return;
    }
    const template = templateShifts.find(t => t.id === templateId);
    if (!template) return;
    await supabase.from('shifts').upsert(
      { employee_id: employeeId, name: template.name, type: template.type, start_time: template.start_time, end_time: template.end_time, grace_minutes: template.grace_minutes, department: null },
      { onConflict: 'employee_id' }
    );
    reload();
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      name: form.name,
      type: form.type,
      start_time: form.start_time,
      end_time: form.end_time,
      grace_minutes: Number(form.grace_minutes) || 0,
      department: form.department || null,
    };
    if (editingId) await supabase.from('shifts').update(payload).eq('id', editingId);
    else await supabase.from('shifts').insert({ ...payload, employee_id: null });
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    reload();
  }

  function openEdit(shift: Shift) {
    setForm({ name: shift.name, type: shift.type, start_time: shift.start_time.slice(0, 5), end_time: shift.end_time.slice(0, 5), grace_minutes: String(shift.grace_minutes), department: shift.department ?? '' });
    setEditingId(shift.id);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    await supabase.from('shifts').delete().eq('id', id);
    reload();
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'templates' && styles.tabBtnActive]} onPress={() => setTab('templates')}>
          <Text style={[styles.tabText, tab === 'templates' && styles.tabTextActive]}>Templates</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'roster' && styles.tabBtnActive]} onPress={() => setTab('roster')}>
          <Text style={[styles.tabText, tab === 'roster' && styles.tabTextActive]}>Weekly Roster</Text>
        </TouchableOpacity>
      </View>

      {tab === 'roster' ? (
        <View style={styles.rosterNotice}>
          <Text style={styles.rosterNoticeTitle}>Weekly Roster</Text>
          <Text style={styles.rosterNoticeText}>
            Day-by-day roster assignment (a 7-day grid per employee) isn't built for mobile yet — use the web version for
            now to set up custom weekly schedules or Week Off days. Employees already on a custom roster still show
            correctly everywhere else in the app (Attendance, Payroll, Calendar).
          </Text>
        </View>
      ) : (
        <FlatList
          data={templateShifts}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                setForm(EMPTY_FORM);
                setEditingId(null);
                setShowForm(true);
              }}
            >
              <Text style={styles.addBtnText}>+ New Shift</Text>
            </TouchableOpacity>
          }
          renderItem={({ item: shift }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.shiftName}>{shift.name}</Text>
                <Badge tone="info">Active</Badge>
              </View>
              <Text style={styles.detail}>🕐 {formatShiftHours(shift)}</Text>
              <Text style={styles.detail}>
                👥 {countsByShift.get(shift.id) ?? 0} employees{shift.department ? ` · ${shift.department}` : ''}
              </Text>
              <Text style={styles.detail}>Grace: {shift.grace_minutes} min</Text>
              <View style={styles.footerRow}>
                <TouchableOpacity onPress={() => openEdit(shift)}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(shift.id)}>
                  <Text style={styles.removeLink}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No shift templates yet — create one to get started.</Text>}
          ListFooterComponent={
            <View style={{ marginTop: 8 }}>
              <Text style={styles.sectionTitle}>Employee Shift Assignments</Text>
              <Text style={styles.sectionHint}>
                Assign one employee a fixed shift other than their department default. Employees on the Weekly Roster show
                Custom instead.
              </Text>
              {employees.map(emp => {
                const shift = resolveShift(emp, shifts);
                const onRoster = rosterEmployeeIds.has(emp.id);
                return (
                  <View key={emp.id} style={styles.assignRow}>
                    <Text style={styles.assignName} numberOfLines={1}>
                      {emp.name}
                    </Text>
                    {onRoster ? (
                      <TouchableOpacity style={styles.customBtn} onPress={() => setTab('roster')}>
                        <Text style={styles.customBtnText}>Custom — Weekly Roster</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.shiftPicker} onPress={() => setAssignPickerFor(emp)}>
                        <Text style={styles.shiftPickerName} numberOfLines={1}>
                          {shift.name}
                        </Text>
                        <Text style={styles.shiftPickerHours}>{formatShiftHours(shift)}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {employees.length === 0 && <Text style={styles.empty}>No active employees.</Text>}
            </View>
          }
        />
      )}

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>{editingId ? 'Edit Shift' : 'New Shift'}</Text>
            <Text style={styles.formLabel}>Name</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Start (24h)</Text>
                <TextInput style={styles.input} value={form.start_time} onChangeText={v => setForm(f => ({ ...f, start_time: v }))} placeholder="09:00" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>End (24h)</Text>
                <TextInput style={styles.input} value={form.end_time} onChangeText={v => setForm(f => ({ ...f, end_time: v }))} placeholder="18:00" />
              </View>
            </View>
            <Text style={styles.formLabel}>Grace (min)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={form.grace_minutes} onChangeText={v => setForm(f => ({ ...f, grace_minutes: v }))} />
            <View style={styles.formActions}>
              <TouchableOpacity
                onPress={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create shift'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!assignPickerFor} transparent animationType="fade" onRequestClose={() => setAssignPickerFor(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setAssignPickerFor(null)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={[{ id: '', name: 'Default' } as any, ...templateShifts]}
              keyExtractor={item => item.id || 'default'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    if (assignPickerFor) handleAssignShift(assignPickerFor.id, item.id);
                    setAssignPickerFor(null);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                  {item.start_time ? <Text style={styles.modalOptionHint}>{formatShiftHours(item)}</Text> : null}
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
  tabBar: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate200, padding: 10, gap: 8 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.slate50 },
  tabBtnActive: { backgroundColor: colors.accent },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  tabTextActive: { color: colors.white },
  rosterNotice: { margin: 16, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 16 },
  rosterNoticeTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  rosterNoticeText: { fontSize: 12, color: colors.slate500, lineHeight: 18 },
  addBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  addBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  shiftName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  detail: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  footerRow: { flexDirection: 'row', gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate100 },
  editLink: { fontSize: 12, fontWeight: '600', color: colors.accent },
  removeLink: { fontSize: 12, fontWeight: '600', color: colors.criticalText },
  empty: { textAlign: 'center', marginTop: 20, color: colors.slate400 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 8, marginBottom: 4 },
  sectionHint: { fontSize: 11, color: colors.slate400, marginBottom: 10, lineHeight: 16 },
  assignRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 10, marginBottom: 8, gap: 8 },
  assignName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  customBtn: { backgroundColor: colors.accentLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  customBtnText: { fontSize: 10, fontWeight: '700', color: colors.accent },
  shiftPicker: { alignItems: 'center', backgroundColor: colors.accentLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 100 },
  shiftPickerName: { fontSize: 11, fontWeight: '700', color: colors.ink },
  shiftPickerHours: { fontSize: 9, color: colors.accent, marginTop: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
  modalOptionHint: { fontSize: 11, color: colors.slate400, marginTop: 2 },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  formLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
