import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Branch, Department, Employee, Gender } from '../types';
import { colors } from '../theme';

export default function EmployeeDetailScreen({ route, navigation }: any) {
  const { employeeId } = route.params as { employeeId: string };
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    designation: '',
    fingerprint_id: '',
    salary: '',
    pan_no: '',
    ssf_no: '',
    date_of_joining: '',
  });
  const [department, setDepartment] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);

  function reload() {
    supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        setLoading(false);
        if (!data) return;
        const emp = data as Employee;
        setEmployee(emp);
        setForm({
          name: emp.name ?? '',
          phone: emp.phone ?? '',
          email: emp.email ?? '',
          address: emp.address ?? '',
          designation: emp.designation ?? '',
          fingerprint_id: emp.fingerprint_id ?? '',
          salary: emp.salary != null ? String(emp.salary) : '',
          pan_no: emp.pan_no ?? '',
          ssf_no: emp.ssf_no ?? '',
          date_of_joining: emp.date_of_joining ?? '',
        });
        setDepartment(emp.department);
        setBranchId(emp.branch_id);
        setGender(emp.gender);
      });
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartments((data as Department[]) ?? []));
  }
  useEffect(reload, [employeeId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('employees')
      .update({
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        department,
        designation: form.designation || null,
        fingerprint_id: form.fingerprint_id || null,
        branch_id: branchId,
        gender,
        salary: form.salary ? Number(form.salary) : null,
        pan_no: form.pan_no || null,
        ssf_no: form.ssf_no || null,
        date_of_joining: form.date_of_joining || null,
      })
      .eq('id', employeeId);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    reload();
    Alert.alert('Saved', `${form.name}'s details were updated.`);
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
        <Text style={styles.warn}>Employee not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Basic Details</Text>
        <Field label="Name" value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
        <Field label="Phone" value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} keyboardType="phone-pad" />
        <Field label="Email" value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} keyboardType="email-address" />
        <Field label="Address" value={form.address} onChangeText={v => setForm(f => ({ ...f, address: v }))} multiline />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Employment</Text>
        <Field label="Designation" value={form.designation} onChangeText={v => setForm(f => ({ ...f, designation: v }))} />
        <Text style={styles.label}>Gender</Text>
        <ChipPicker
          options={[
            { label: 'Female', value: 'female' },
            { label: 'Male', value: 'male' },
            { label: 'Other', value: 'other' },
          ]}
          value={gender}
          onChange={setGender}
        />
        <Text style={styles.label}>Department</Text>
        <ChipPicker options={departments.map(d => d.name)} value={department} onChange={setDepartment} />
        <Text style={styles.label}>Branch</Text>
        <ChipPicker options={branches.map(b => ({ label: b.name, value: b.id }))} value={branchId} onChange={setBranchId} />
        <Field label="Fingerprint / Biometric ID" value={form.fingerprint_id} onChangeText={v => setForm(f => ({ ...f, fingerprint_id: v }))} />
        <Field label="Date of joining (YYYY-MM-DD)" value={form.date_of_joining} onChangeText={v => setForm(f => ({ ...f, date_of_joining: v }))} placeholder="2026-01-15" />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pay & Docs</Text>
        <Field label="Salary" value={form.salary} onChangeText={v => setForm(f => ({ ...f, salary: v }))} keyboardType="numeric" />
        <Field label="PAN No." value={form.pan_no} onChangeText={v => setForm(f => ({ ...f, pan_no: v }))} />
        <Field label="SSF No." value={form.ssf_no} onChangeText={v => setForm(f => ({ ...f, ssf_no: v }))} />
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}
      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'numeric';
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 60 }]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colors.slate400}
      />
    </>
  );
}

function ChipPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: (string | { label: string; value: T })[];
  value: T | string | null;
  onChange: (v: any) => void;
}) {
  const normalized = options.map(o => (typeof o === 'string' ? { label: o, value: o } : o));
  return (
    <View style={styles.chipsRow}>
      <TouchableOpacity style={[styles.chip, value === null && styles.chipActive]} onPress={() => onChange(null)}>
        <Text style={[styles.chipText, value === null && styles.chipTextActive]}>Unassigned</Text>
      </TouchableOpacity>
      {normalized.map(o => (
        <TouchableOpacity key={o.value} style={[styles.chip, value === o.value && styles.chipActive]} onPress={() => onChange(o.value)}>
          <Text style={[styles.chipText, value === o.value && styles.chipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 11, fontWeight: '600', color: colors.slate500 },
  chipTextActive: { color: colors.white },
  errorText: { color: colors.criticalText, fontSize: 12, marginBottom: 8, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 24 },
  saveBtnText: { color: colors.white, fontSize: 14, fontWeight: '700' },
});
