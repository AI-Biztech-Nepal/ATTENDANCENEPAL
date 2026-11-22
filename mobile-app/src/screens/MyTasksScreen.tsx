import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Task, TaskStatus, TaskTimeLog } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import SimpleBarChart from '../components/SimpleBarChart';

const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export default function MyTasksScreen() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<TaskTimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase.from('tasks').select('*').eq('assigned_to', empId).order('created_at', { ascending: false }).then(({ data }) => setTasks((data as Task[]) ?? []));
    supabase.from('task_time_logs').select('*').eq('employee_id', empId).then(({ data }) => setLogs((data as TaskTimeLog[]) ?? []));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (profile?.employee_id) {
        setEmployeeId(profile.employee_id);
        reload(profile.employee_id);
      }
    });
  }, []);

  const runningLog = logs.find(l => l.ended_at === null) ?? null;

  useEffect(() => {
    if (!runningLog) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [runningLog]);

  const taskHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of logs) {
      if (!log.ended_at) continue;
      const mins = (new Date(log.ended_at).getTime() - new Date(log.started_at).getTime()) / 60000;
      map.set(log.task_id, (map.get(log.task_id) ?? 0) + mins);
    }
    return map;
  }, [logs]);

  async function startTimer(taskId: string) {
    setBusyId(taskId);
    const { error } = await supabase.rpc('start_task_timer', { p_task_id: taskId });
    setBusyId(null);
    if (error) Alert.alert('Could not start', error.message);
    if (employeeId) reload(employeeId);
  }
  async function stopTimer(logId: string) {
    setBusyId(logId);
    const { error } = await supabase.rpc('stop_task_timer', { p_log_id: logId });
    setBusyId(null);
    if (error) Alert.alert('Could not stop', error.message);
    if (employeeId) reload(employeeId);
  }
  async function submitTask(id: string) {
    setBusyId(id);
    const { error } = await supabase.rpc('submit_task', { p_task_id: id, p_work_notes: noteDraft[id] || null });
    setBusyId(null);
    if (error) Alert.alert('Could not submit', error.message);
    if (employeeId) reload(employeeId);
  }

  async function handleCreateTask() {
    if (!employeeId) return;
    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }
    setFormError(null);
    setCreating(true);
    const { error } = await supabase.from('tasks').insert({
      title,
      description: description || null,
      due_date: dueDate || null,
      assigned_to: employeeId,
      assigned_by: userId,
      // Nothing shows points any more, but the database's security rule only lets an employee create a task
      // that carries 0 of them, so the insert still says so.
      points: 0,
      status: 'pending',
      source: 'self',
    });
    setCreating(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setTitle('');
    setDescription('');
    setDueDate('');
    setShowForm(false);
    reload(employeeId);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employeeId) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Your account isn't linked to an employee record yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={tasks}
        keyExtractor={item => item.id}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.sectionHeading}>Tasks</Text>
            <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
              <Text style={styles.newBtnText}>+ New Task</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item: t }) => {
          const isRunningHere = runningLog?.task_id === t.id;
          const hours = Math.round(((taskHours.get(t.id) ?? 0) / 60) * 10) / 10;
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.title}>
                  {t.title}
                  {t.source === 'self' ? <Text style={styles.selfTag}> (self-created)</Text> : null}
                </Text>
                <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
              </View>
              {t.description ? <Text style={styles.desc}>{t.description}</Text> : null}
              {t.due_date || hours > 0 ? (
                <Text style={styles.meta}>
                  {[t.due_date ? `Due ${formatAdDate(t.due_date, system)}` : null, hours > 0 ? `${hours} hrs logged` : null].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {t.review_note ? (
                <Text style={styles.feedback}>
                  <Text style={{ fontWeight: '700' }}>Feedback: </Text>
                  {t.review_note}
                </Text>
              ) : null}

              {t.status === 'pending' && (
                <TouchableOpacity style={styles.acceptBtn} disabled={busyId === t.id} onPress={() => startTimer(t.id)}>
                  <Text style={styles.acceptBtnText}>✅ Accept Task</Text>
                </TouchableOpacity>
              )}

              {t.status === 'in_progress' && (
                <View style={{ gap: 8 }}>
                  {isRunningHere ? (
                    <TouchableOpacity style={styles.holdBtn} disabled={busyId === runningLog!.id} onPress={() => stopTimer(runningLog!.id)}>
                      <Text style={styles.acceptBtnText}>⏸ {formatElapsed(runningLog!.started_at, now)} · Hold</Text>
                    </TouchableOpacity>
                  ) : runningLog ? (
                    <Text style={styles.dim}>Timer running on another task — hold it first to resume this one.</Text>
                  ) : (
                    <TouchableOpacity style={styles.resumeBtn} disabled={busyId === t.id} onPress={() => startTimer(t.id)}>
                      <Text style={styles.resumeBtnText}>▶ Resume</Text>
                    </TouchableOpacity>
                  )}
                  <TextInput
                    style={styles.noteInput}
                    placeholder="What did you do? (optional)"
                    placeholderTextColor={colors.slate400}
                    multiline
                    value={noteDraft[t.id] ?? ''}
                    onChangeText={v => setNoteDraft(d => ({ ...d, [t.id]: v }))}
                  />
                  <TouchableOpacity style={styles.completeBtn} disabled={busyId === t.id} onPress={() => submitTask(t.id)}>
                    <Text style={styles.acceptBtnText}>Complete Task</Text>
                  </TouchableOpacity>
                </View>
              )}

              {t.status === 'submitted' && <Text style={styles.dim}>Awaiting review.</Text>}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No tasks yet.</Text>}
        ListFooterComponent={
          <View style={{ marginTop: 8, gap: 16 }}>
            {taskHours.size > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Hours by Task</Text>
                <SimpleBarChart
                  data={Array.from(taskHours.entries()).map(([taskId, mins]) => ({
                    label: tasks.find(t => t.id === taskId)?.title ?? 'Deleted task',
                    value: Math.round((mins / 60) * 10) / 10,
                  }))}
                />
              </View>
            )}
          </View>
        }
      />

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <Text style={styles.formTitle}>New Task</Text>
            <Text style={styles.label}>Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} />
            <Text style={styles.label}>Description (optional)</Text>
            <TextInput style={[styles.input, { height: 60 }]} multiline value={description} onChangeText={setDescription} />
            <Text style={styles.label}>Due date (YYYY-MM-DD, optional)</Text>
            <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="2026-08-20" placeholderTextColor={colors.slate400} />
            {formError && <Text style={styles.errorText}>{formError}</Text>}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateTask} disabled={creating} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{creating ? 'Creating…' : 'Create task'}</Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionHeading: { fontSize: 14, fontWeight: '700', color: colors.ink },
  chartCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14 },
  chartTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  newBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  newBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1, marginRight: 8 },
  selfTag: { fontSize: 11, fontWeight: '400', color: colors.slate400 },
  desc: { fontSize: 12, color: colors.slate500, marginBottom: 6 },
  meta: { fontSize: 11, color: colors.slate400, marginBottom: 6 },
  feedback: { fontSize: 12, color: colors.slate500, backgroundColor: colors.slate50, borderRadius: 8, padding: 8, marginBottom: 8 },
  dim: { fontSize: 12, color: colors.slate400 },
  acceptBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  acceptBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  holdBtn: { backgroundColor: colors.warning, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  resumeBtn: { borderWidth: 1, borderColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  resumeBtnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  completeBtn: { backgroundColor: colors.good, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  noteInput: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, padding: 10, fontSize: 13, color: colors.ink, minHeight: 50 },
  empty: { textAlign: 'center', marginTop: 20, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
