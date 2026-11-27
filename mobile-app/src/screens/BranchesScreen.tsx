import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import type { Branch, BranchDepartment, Department } from '../types';
import { colors } from '../theme';

const EMPTY_FORM = { name: '', branch_code: '', latitude: '', longitude: '', radius_meters: '150' };

export default function BranchesScreen() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [branchDepartments, setBranchDepartments] = useState<BranchDepartment[]>([]);
  const [employees, setEmployees] = useState<{ branch_id: string | null; department: string | null }[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  function reload() {
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartments((data as Department[]) ?? []));
    supabase.from('branch_departments').select('*').then(({ data }) => setBranchDepartments((data as BranchDepartment[]) ?? []));
    supabase.from('employees').select('branch_id, department').then(({ data }) => setEmployees((data as any) ?? []));
  }
  useEffect(reload, []);

  function linkedDepartments(branchId: string) {
    const ids = new Set(branchDepartments.filter(bd => bd.branch_id === branchId).map(bd => bd.department_id));
    return departments.filter(d => ids.has(d.id));
  }
  function employeeCount(branchId: string, departmentName: string) {
    return employees.filter(e => e.branch_id === branchId && e.department === departmentName).length;
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(b: Branch) {
    setEditing(b);
    setForm({ name: b.name, branch_code: b.branch_code, latitude: String(b.latitude ?? ''), longitude: String(b.longitude ?? ''), radius_meters: String(b.radius_meters) });
    setFormError(null);
    setShowForm(true);
  }

  async function useCurrentLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access to use this.');
        return;
      }
      // maximumAge: never reuse an earlier reading (the browser build would).
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, maximumAge: 0 } as Location.LocationOptions);
      setForm(f => ({ ...f, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) }));
    } catch (e: any) {
      Alert.alert('Could not get location', e.message ?? String(e));
    } finally {
      setLocating(false);
    }
  }

  async function handleSave() {
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.latitude || !form.longitude || Number.isNaN(lat) || Number.isNaN(lng)) {
      setFormError('Set the branch location — use "Use my current location" while standing there, or enter coordinates manually.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = { name: form.name, branch_code: form.branch_code, latitude: lat, longitude: lng, radius_meters: Number(form.radius_meters) || 150 };
    const { error } = editing ? await supabase.from('branches').update(payload).eq('id', editing.id) : await supabase.from('branches').insert(payload);
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowForm(false);
    reload();
  }

  async function handleDelete(b: Branch) {
    Alert.alert('Remove branch', `Remove ${b.name}? Employees/devices assigned to it will need reassigning.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('branches').delete().eq('id', b.id);
          if (error) Alert.alert('Could not remove', error.message);
          reload();
        },
      },
    ]);
  }

  async function handleAddDepartment() {
    const name = deptName.trim();
    if (!name) return;
    setSavingDept(true);
    setDeptError(null);
    const { error } = await supabase.from('departments').insert({ name });
    setSavingDept(false);
    if (error) {
      setDeptError(error.code === '23505' ? 'That department already exists.' : error.message);
      return;
    }
    setDeptName('');
    setShowDeptForm(false);
    reload();
  }

  async function handleDeleteDepartment(dept: Department) {
    Alert.alert('Remove department', `Remove the "${dept.name}" department? It will be unlinked from every branch.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('departments').delete().eq('id', dept.id);
          if (error) Alert.alert('Could not remove', error.message);
          reload();
        },
      },
    ]);
  }

  async function handleUnlinkDepartment(branchId: string, departmentId: string) {
    const { error } = await supabase.from('branch_departments').delete().eq('branch_id', branchId).eq('department_id', departmentId);
    if (error) Alert.alert('Could not remove', error.message);
    reload();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={branches}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
            <Text style={styles.intro}>
              Each branch's location and radius. An employee must be assigned to a branch for GPS check-in to work.
            </Text>
            <View style={styles.deptCard}>
              <View style={styles.deptHeader}>
                <Text style={styles.deptTitle}>Departments</Text>
                <TouchableOpacity style={styles.smallAddBtn} onPress={() => setShowDeptForm(true)}>
                  <Text style={styles.smallAddBtnText}>+ Add</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chipsRow}>
                {departments.map(d => (
                  <View key={d.id} style={styles.deptChip}>
                    <Text style={styles.deptChipText}>{d.name}</Text>
                    <TouchableOpacity onPress={() => handleDeleteDepartment(d)}>
                      <Text style={styles.deptChipRemove}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {departments.length === 0 && <Text style={styles.dim}>No departments yet.</Text>}
              </View>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Text style={styles.addBtnText}>+ Add Branch</Text>
            </TouchableOpacity>
          </>
        }
        renderItem={({ item: b }) => {
          const linked = linkedDepartments(b.id);
          return (
            <View style={styles.card}>
              <Text style={styles.branchName}>{b.name}</Text>
              <Text style={styles.branchCode}>{b.branch_code}</Text>
              <Text style={styles.detail}>
                📍 {b.latitude != null && b.longitude != null ? `${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}` : 'Location not set'}
              </Text>
              <Text style={styles.detail}>↔ {b.radius_meters}m radius</Text>
              <View style={styles.deptSection}>
                <Text style={styles.deptSectionLabel}>Departments</Text>
                <View style={styles.chipsRow}>
                  {linked.map(d => (
                    <View key={d.id} style={styles.deptChip}>
                      <Text style={styles.deptChipText}>
                        {d.name} · {employeeCount(b.id, d.name)}
                      </Text>
                      <TouchableOpacity onPress={() => handleUnlinkDepartment(b.id, d.id)}>
                        <Text style={styles.deptChipRemove}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {linked.length === 0 && <Text style={styles.dim}>None yet</Text>}
                </View>
              </View>
              <View style={styles.footerRow}>
                <TouchableOpacity onPress={() => openEdit(b)}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(b)}>
                  <Text style={styles.removeLink}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No branches yet — add one to enable GPS check-in.</Text>}
      />

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>{editing ? 'Edit Branch' : 'Add Branch'}</Text>
            <Text style={styles.formLabel}>Name</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
            <Text style={styles.formLabel}>Branch code</Text>
            <TextInput style={styles.input} value={form.branch_code} onChangeText={v => setForm(f => ({ ...f, branch_code: v }))} />
            <TouchableOpacity style={styles.locBtn} onPress={useCurrentLocation} disabled={locating}>
              <Text style={styles.locBtnText}>{locating ? 'Getting location…' : '📍 Use my current location'}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Latitude</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={form.latitude} onChangeText={v => setForm(f => ({ ...f, latitude: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Longitude</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={form.longitude} onChangeText={v => setForm(f => ({ ...f, longitude: v }))} />
              </View>
            </View>
            <Text style={styles.formLabel}>Radius (meters)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={form.radius_meters} onChangeText={v => setForm(f => ({ ...f, radius_meters: v }))} />
            {formError && <Text style={styles.errorText}>{formError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add branch'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showDeptForm} transparent animationType="fade" onRequestClose={() => setShowDeptForm(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowDeptForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>Add Department</Text>
            <Text style={styles.formLabel}>Name</Text>
            <TextInput style={styles.input} value={deptName} onChangeText={setDeptName} autoFocus />
            {deptError && <Text style={styles.errorText}>{deptError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setShowDeptForm(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddDepartment} disabled={savingDept} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{savingDept ? 'Saving…' : 'Add department'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  intro: { fontSize: 12, color: colors.slate500, lineHeight: 18, marginBottom: 12 },
  deptCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginBottom: 12 },
  deptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  deptTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  smallAddBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  smallAddBtnText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  deptChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  deptChipText: { fontSize: 11, color: colors.accent, fontWeight: '600' },
  deptChipRemove: { fontSize: 13, color: colors.accent, fontWeight: '700' },
  dim: { fontSize: 12, color: colors.slate400 },
  addBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  addBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.slate200 },
  branchName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  branchCode: { fontSize: 11, color: colors.slate400, marginTop: 2, marginBottom: 6 },
  detail: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  deptSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate100 },
  deptSectionLabel: { fontSize: 11, fontWeight: '600', color: colors.slate500, marginBottom: 6 },
  footerRow: { flexDirection: 'row', gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate100 },
  editLink: { fontSize: 12, fontWeight: '600', color: colors.accent },
  removeLink: { fontSize: 12, fontWeight: '600', color: colors.criticalText },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  formLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  locBtn: { borderWidth: 1, borderColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10, marginBottom: 4 },
  locBtnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
