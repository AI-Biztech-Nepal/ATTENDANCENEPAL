import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import type { Task } from '../types';
import { colors } from '../theme';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { nepalDateKey } from '../lib/shift';
import { daysBetween, formatDuration, formatSlot, slotEndMs, slotLength, slotStartMs, taskSlot, timeLeft, weekdayName, withTimeStatus } from '../lib/taskClock';

/** How many finished tasks are listed before "Show all". */
const DONE_SHOWN = 8;

/** Oldest first by day and start time; a task with no day goes last, and one with a day but no time goes after that day's timed tasks. */
const when = (t: Task) => `${t.due_date ?? '9999-12-31'}T${t.start_time ?? '99:99'}`;

/** The employee's own tasks, to look at. The manager enters the work and the clock does the rest (a task starts when its time begins and is
 * done when its time ends), so there is nothing to accept, start or finish here: what they are working on now, what is coming up, and what
 * is done. A new task is announced in the bell. Kept in step with admin-web/app/(employee)/my-tasks/page.tsx. */
export default function MyTasksScreen() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  // The tasks as stored. `tasks` (below) is what is shown by the clock.
  const [rawTasks, setRawTasks] = useState<Task[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showAllDone, setShowAllDone] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      if (!active) return;
      setEmployeeId((profile?.employee_id as string | null) ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!employeeId) return;
    Promise.resolve(supabase.from('tasks').select('*').eq('assigned_to', employeeId).order('due_date', { ascending: true })).then(({ data, error }) => {
      if (error) setLoadError(`Could not load your tasks: ${error.message}`);
      else {
        setLoadError('');
        setRawTasks((data as Task[] | null) ?? []);
      }
    });
  }, [employeeId]);

  // Read again every time this tab is opened (a notice takes you here), when the app comes back to the foreground, and every 5 minutes,
  // so a task the manager has just entered shows up.
  useFocusEffect(load);
  useEffect(() => {
    const timer = setInterval(load, 5 * 60 * 1000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') load();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  // The clock moves once a minute: a task that begins moves to "working on now", one whose time ends moves to "done".
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const today = nepalDateKey(new Date(clock).toISOString());
  const tasks = useMemo(() => rawTasks.map(t => withTimeStatus(t, clock)), [rawTasks, clock]);
  const working = useMemo(() => tasks.filter(t => t.status === 'in_progress').sort((a, b) => when(a).localeCompare(when(b))), [tasks]);
  const upcoming = useMemo(() => tasks.filter(t => t.status === 'pending').sort((a, b) => when(a).localeCompare(when(b))), [tasks]);
  const done = useMemo(() => tasks.filter(t => t.status === 'approved' || t.status === 'submitted' || t.status === 'rejected').sort((a, b) => when(b).localeCompare(when(a))), [tasks]);

  /** "Today", "Tomorrow" or "Fri 27 Nov 2026", then "· 2:00–3:00 PM · 1 h" when it has a time. */
  function whenText(t: Task): string {
    let day = 'No day set yet';
    if (t.due_date) {
      const n = daysBetween(today, t.due_date);
      day = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${weekdayName(t.due_date)} ${formatAdDate(t.due_date, system)}`;
    }
    const slot = taskSlot(t);
    return slot ? `${day} · ${formatSlot(slot)} · ${formatDuration(slotLength(slot))}` : `${day} · no time set yet`;
  }

  function card(t: Task, kind: 'working' | 'upcoming' | 'done') {
    const start = slotStartMs(t);
    const end = slotEndMs(t);
    const pct = kind === 'working' && start !== null && end !== null ? Math.min(100, Math.max(0, Math.round(((clock - start) / (end - start)) * 100))) : null;
    const left = kind === 'working' && end !== null ? Math.max(0, Math.ceil((end - clock) / 60000)) : null;
    return (
      <View key={t.id} style={[styles.card, kind === 'working' && styles.cardNow]}>
        <View style={styles.cardTop}>
          <Text style={styles.title}>{t.title}</Text>
          {kind === 'done' && t.status === 'approved' && <Text style={[styles.tag, { color: colors.goodText }]}>✓ Done</Text>}
          {kind === 'done' && t.status === 'submitted' && <Text style={[styles.tag, { color: colors.warningText }]}>Under review</Text>}
          {kind === 'done' && t.status === 'rejected' && <Text style={[styles.tag, { color: colors.criticalText }]}>Sent back</Text>}
        </View>
        <Text style={styles.meta}>{whenText(t)}</Text>
        {t.description ? <Text style={styles.desc}>{t.description}</Text> : null}
        {pct !== null && left !== null ? (
          <View style={{ marginTop: 10 }}>
            <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={`${t.title}: ${pct}% of its time has passed`} accessibilityValue={{ min: 0, max: 100, now: pct }}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.left}>{timeLeft(left)}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  function section(title: string, list: Task[], kind: 'working' | 'upcoming' | 'done', empty: string, shown: Task[] = list) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.count}>
            <Text style={styles.countText}>{list.length}</Text>
          </View>
        </View>
        {list.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>{empty}</Text>
          </View>
        ) : (
          shown.map(t => card(t, kind))
        )}
        {kind === 'done' && list.length > DONE_SHOWN ? (
          <TouchableOpacity style={styles.moreBtn} onPress={() => setShowAllDone(s => !s)} accessibilityRole="button" accessibilityLabel={showAllDone ? 'Show fewer' : `Show all ${list.length}`}>
            <Text style={styles.moreBtnText}>{showAllDone ? 'Show fewer' : `Show all ${list.length}`}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
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
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
      {section('Working on now', working, 'working', 'Nothing in progress right now.')}
      {section('Upcoming', upcoming, 'upcoming', 'No tasks coming up. When your manager gives you one, you will be told here.')}
      {section('Done', done, 'done', 'No finished tasks yet.', showAllDone ? done : done.slice(0, DONE_SHOWN))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  error: { color: colors.criticalText, fontSize: 13, backgroundColor: colors.criticalBg, borderRadius: 8, padding: 10, marginBottom: 12 },
  section: { marginBottom: 22 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  count: { backgroundColor: colors.slate100, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 10 },
  cardNow: { borderColor: colors.accent },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink, flex: 1 },
  tag: { fontSize: 12, fontWeight: '800' },
  meta: { fontSize: 12, color: colors.slate500, marginTop: 3 },
  desc: { fontSize: 12, color: colors.slate500, marginTop: 6, lineHeight: 17 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.slate100, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  left: { fontSize: 12, fontWeight: '700', color: colors.slate500, marginTop: 4 },
  emptyBox: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.slate200, borderRadius: 12, paddingVertical: 18, paddingHorizontal: 14 },
  empty: { textAlign: 'center', fontSize: 13, color: colors.slate500 },
  moreBtn: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  moreBtnText: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
