import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { nepalTodayIso } from '../lib/shift';
import type { Employee, Task, TaskStatus } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import Leaderboard from '../components/Leaderboard';

const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};
const FILTERS: (TaskStatus | 'All')[] = ['pending', 'in_progress', 'submitted', 'approved', 'rejected', 'All'];

const EMPTY_FORM = { employee_id: '', title: '', description: '', points: '10', due_date: '' };

export default function TasksScreen() {
  const { system } = useCalendarSystem();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<TaskStatus | 'All'>('submitted');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [reviewingTask, setReviewingTask] = useState<Task | null>(null);
  const [reviewPoints, setReviewPoints] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).then(({ data }) => setTasks((data as Task[]) ?? []));
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) =>
        setEmployees(((data as Employee[]) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
      );
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';
  const filtered = useMemo(() => (filter === 'All' ? tasks : tasks.filter(t => t.status === filter)), [tasks, filter]);
  const today = useMemo(nepalTodayIso, []);
  const isOverdue = (t: Task) => (t.status === 'pending' || t.status === 'in_progress') && !!t.due_date && t.due_date < today;

  async function handleAssign() {
    if (!form.employee_id) {
      setFormError('Select an employee.');
      return;
    }
    if (!form.title.trim()) {
      setFormError('A title is required.');
      return;
    }
    if (!form.due_date) {
      setFormError('A deadline is required — pick a date this task must be finished by.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase.from('tasks').insert({
      assigned_to: form.employee_id,
      assigned_by: data.user?.id,
      title: form.title,
      description: form.description || null,
      points: Number(form.points) || 0,
      due_date: form.due_date,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  function openReview(t: Task) {
    setReviewingTask(t);
    setReviewPoints(String(t.points));
    setReviewNote('');
  }

  async function review(status: 'approved' | 'rejected') {
    if (!reviewingTask) return;
    setBusyId(reviewingTask.id);
    const { data } = await supabase.auth.getUser();
    await supabase
      .from('tasks')
      .update({
        status,
        points: status === 'approved' ? Number(reviewPoints) || reviewingTask.points : reviewingTask.points,
        review_note: reviewNote || null,
        reviewed_by: data.user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reviewingTask.id);
    setBusyId(null);
    setReviewingTask(null);
    reload();
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
          {FILTERS.map(f => (
            <TouchableOpacity key={f} style={[styles.filterChip, filter === f && styles.filterChipActive]} onPress={() => setFilter(f)}>
              <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f.replace('_', ' ')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.assignBtn} onPress={() => setShowForm(true)}>
          <Text style={styles.assignBtnText}>+ Assign</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item: t }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.employeeName}>{employeeName(t.assigned_to)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Text style={styles.title}>{t.title}</Text>
                  {t.source === 'self' && <Badge tone="info">Self-assigned</Badge>}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                {isOverdue(t) && <Badge tone="critical">Overdue</Badge>}
              </View>
            </View>
            {t.description ? <Text style={styles.desc}>{t.description}</Text> : null}
            {t.work_notes ? (
              <Text style={styles.note}>
                <Text style={styles.noteLabel}>Employee note: </Text>
                {t.work_notes}
              </Text>
            ) : null}
            {t.review_note ? (
              <Text style={styles.note}>
                <Text style={styles.noteLabel}>Review note: </Text>
                {t.review_note}
              </Text>
            ) : null}
            <Text style={styles.meta}>
              {t.points} pts · Due {t.due_date ? formatAdDate(t.due_date, system) : '—'}
            </Text>
            {t.status === 'submitted' ? (
              <TouchableOpacity style={styles.reviewBtn} onPress={() => openReview(t)}>
                <Text style={styles.reviewBtnText}>Review</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No {filter !== 'All' ? filter.replace('_', ' ') : ''} tasks.</Text>}
        ListFooterComponent={
          <View style={{ marginTop: 8 }}>
            <Leaderboard />
          </View>
        }
      />

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>Assign Task</Text>
            <Text style={styles.formLabel}>Employee</Text>
            <TouchableOpacity style={styles.input} onPress={() => setEmployeePickerOpen(true)}>
              <Text style={{ color: form.employee_id ? colors.ink : colors.slate400 }}>
                {employees.find(e => e.id === form.employee_id)?.name ?? 'Select employee…'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.formLabel}>Title</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. Website development" />
            <Text style={styles.formLabel}>Description (optional)</Text>
            <TextInput style={[styles.input, { height: 70 }]} multiline value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} />
            <Text style={styles.formLabel}>Points</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={form.points} onChangeText={v => setForm(f => ({ ...f, points: v }))} />
            <Text style={styles.formLabel}>Deadline (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={form.due_date} onChangeText={v => setForm(f => ({ ...f, due_date: v }))} placeholder="2026-08-20" />
            {formError && <Text style={styles.errorText}>{formError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAssign} disabled={saving} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{saving ? 'Assigning…' : 'Assign task'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={employeePickerOpen} transparent animationType="fade" onRequestClose={() => setEmployeePickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEmployeePickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={employees}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setForm(f => ({ ...f, employee_id: item.id }));
                    setEmployeePickerOpen(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!reviewingTask} transparent animationType="fade" onRequestClose={() => setReviewingTask(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setReviewingTask(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>Review Task</Text>
            {reviewingTask && (
              <>
                <Text style={styles.reviewSub}>
                  {reviewingTask.title} · {employeeName(reviewingTask.assigned_to)}
                </Text>
                {reviewingTask.work_notes ? (
                  <Text style={styles.note}>
                    <Text style={styles.noteLabel}>Employee note: </Text>
                    {reviewingTask.work_notes}
                  </Text>
                ) : null}
                <Text style={styles.formLabel}>Points to award</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={reviewPoints} onChangeText={setReviewPoints} />
                <Text style={styles.formLabel}>Review note (optional)</Text>
                <TextInput style={[styles.input, { height: 60 }]} multiline value={reviewNote} onChangeText={setReviewNote} />
                <View style={styles.formActions}>
                  <TouchableOpacity onPress={() => setReviewingTask(null)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => review('rejected')} disabled={busyId === reviewingTask.id} style={styles.rejectBtn}>
                    <Text style={styles.cancelBtnText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => review('approved')} disabled={busyId === reviewingTask.id} style={styles.approveBtn}>
                    <Text style={styles.saveBtnText}>{busyId === reviewingTask.id ? 'Saving…' : 'Approve'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  filterBarWrap: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate200, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  filterBar: { paddingHorizontal: 12, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterChipText: { fontSize: 12, fontWeight: '600', color: colors.slate500, textTransform: 'capitalize' },
  filterChipTextActive: { color: colors.white },
  assignBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  assignBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  employeeName: { fontSize: 11, color: colors.slate500 },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink },
  desc: { fontSize: 12, color: colors.slate400, marginTop: 4 },
  note: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  noteLabel: { fontWeight: '700' },
  meta: { fontSize: 11, color: colors.slate500, marginTop: 6 },
  reviewBtn: { marginTop: 10, backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 8, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 16 },
  reviewBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400, textTransform: 'capitalize' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  reviewSub: { fontSize: 12, color: colors.slate500, marginBottom: 10 },
  formLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink, justifyContent: 'center' },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  rejectBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  approveBtn: { backgroundColor: colors.good, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
