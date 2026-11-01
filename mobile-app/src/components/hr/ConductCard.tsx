import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate, localDateKey } from '../../lib/calendar';
import {
  CONDUCT_KINDS,
  CONDUCT_STATUSES,
  WARNING_LEVELS,
  statusLabel,
  warningLevelLabel,
  type ConductKind,
  type ConductRecord,
  type ConductStatus,
  type WarningLevel,
} from '../../lib/employeeRecords';
import { colors } from '../../theme';
import Badge from '../Badge';
import { Choice, CollapsibleCard, DateField, Field, LinkText, Notice, Sheet, confirmAsync } from './HrKit';

type FormState = { kind: ConductKind; record_date: string; title: string; details: string; warning_level: WarningLevel | ''; status: ConductStatus; final_decision: string; decided_on: string };
const EMPTY_FORM: FormState = { kind: 'warning', record_date: '', title: '', details: '', warning_level: '', status: 'open', final_decision: '', decided_on: '' };

const KIND_TONE: Record<ConductKind, 'warning' | 'critical' | 'info'> = { warning: 'warning', disciplinary: 'critical', grievance: 'info' };
const STATUS_TONE: Record<ConductStatus, 'warning' | 'info' | 'neutral'> = { open: 'warning', under_review: 'info', closed: 'neutral' };

/** Warnings, disciplinary actions and grievances on an employee's file, each with what
 * was decided in the end. Owner / HR only. */
export default function ConductCard({ employeeId }: { employeeId: string }) {
  const { system } = useCalendarSystem();
  const [records, setRecords] = useState<ConductRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [filter, setFilter] = useState<'all' | ConductKind>('all');

  const [dialog, setDialog] = useState<{ editing: ConductRecord | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_conduct_records')
      .select('*')
      .eq('employee_id', employeeId)
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setRecords((data ?? []) as ConductRecord[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<'all' | ConductKind, number> = { all: records.length, warning: 0, disciplinary: 0, grievance: 0 };
    for (const r of records) c[r.kind]++;
    return c;
  }, [records]);
  const openCount = records.filter(r => r.status !== 'closed').length;
  const shown = filter === 'all' ? records : records.filter(r => r.kind === filter);

  function openDialog(editing: ConductRecord | null) {
    setFormError('');
    setForm(
      editing
        ? {
            kind: editing.kind,
            record_date: editing.record_date,
            title: editing.title,
            details: editing.details ?? '',
            warning_level: editing.warning_level ?? '',
            status: editing.status,
            final_decision: editing.final_decision ?? '',
            decided_on: editing.decided_on ?? '',
          }
        : { ...EMPTY_FORM, kind: filter === 'all' ? 'warning' : filter }
    );
    setDialog({ editing });
  }

  function change(patch: Partial<FormState>) {
    setForm(f => {
      const next = { ...f, ...patch };
      // Closing a record dates the decision as of today unless a date was given.
      if (patch.status === 'closed' && !next.decided_on) next.decided_on = localDateKey(new Date().toISOString());
      return next;
    });
  }

  async function save() {
    if (!dialog) return;
    if (!form.title.trim()) return setFormError('Give it a short title.');
    if (!form.record_date) return setFormError('Pick the date.');
    if (form.status === 'closed' && !form.final_decision.trim()) return setFormError('Say how it was decided before closing it.');
    setSaving(true);
    setFormError('');
    const row = {
      kind: form.kind,
      record_date: form.record_date,
      title: form.title.trim(),
      details: form.details.trim() || null,
      // A level only means something for a warning.
      warning_level: form.kind === 'warning' && form.warning_level ? form.warning_level : null,
      status: form.status,
      final_decision: form.final_decision.trim() || null,
      decided_on: form.final_decision.trim() ? form.decided_on || null : null,
    };
    const { error } = dialog.editing
      ? await supabase.from('employee_conduct_records').update(row).eq('id', dialog.editing.id)
      : await supabase.from('employee_conduct_records').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setDialog(null);
    load();
  }

  async function remove(r: ConductRecord) {
    if (!(await confirmAsync('Delete record?', `Delete "${r.title}"? This can't be undone.`, 'Delete', true))) return;
    setActionError('');
    const { error } = await supabase.from('employee_conduct_records').delete().eq('id', r.id);
    if (error) return setActionError(`Could not delete: ${error.message}`);
    load();
  }

  const kindWord = (k: ConductKind) => CONDUCT_KINDS.find(x => x.value === k)!.label;
  const summary =
    status === 'ready' ? (records.length === 0 ? 'Nothing on file' : `${records.length} on file${openCount > 0 ? ` · ${openCount} still open` : ''}`) : status === 'unavailable' ? 'Not set up yet' : 'Loading…';

  return (
    <CollapsibleCard title="Conduct records" summary={summary}>
      <Text style={styles.intro}>Warnings, disciplinary actions and grievances, with the final decision. Only the owner and HR can see these.</Text>

      {status === 'unavailable' && (
        <Notice tone="warning">
          This can't be loaded yet. If this is the first time, run the latest database migration (20261101200000_employee_performance_conduct.sql) in Supabase. ({loadError})
        </Notice>
      )}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}

      {status === 'ready' && (
        <>
          <View style={styles.filterRow}>
            {(
              [
                ['all', 'All'],
                ['warning', 'Warnings'],
                ['disciplinary', 'Disciplinary'],
                ['grievance', 'Grievances'],
              ] as const
            ).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                onPress={() => setFilter(value)}
                accessibilityRole="button"
                accessibilityLabel={`${label} (${counts[value]})`}
                accessibilityState={{ selected: filter === value }}
                style={[styles.filterChip, filter === value && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, filter === value && { color: colors.accent }]}>
                  {label} ({counts[value]})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.addRow}>
            {openCount > 0 ? <Text style={styles.open}>{openCount} still open</Text> : <View />}
            <LinkText label="+ Add record" onPress={() => openDialog(null)} />
          </View>

          {shown.length === 0 && <Text style={styles.empty}>{records.length === 0 ? 'Nothing on file.' : `No ${CONDUCT_KINDS.find(k => k.value === filter)?.plural.toLowerCase()} on file.`}</Text>}
          {shown.map(r => (
            <View key={r.id} style={styles.item}>
              <View style={styles.head}>
                <Text style={styles.date}>{formatAdDate(r.record_date, system)}</Text>
                <Badge tone={KIND_TONE[r.kind]}>{r.kind === 'warning' ? warningLevelLabel(r.warning_level) : kindWord(r.kind)}</Badge>
                <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge>
              </View>
              <Text style={styles.title}>{r.title}</Text>
              {!!r.details && <Text style={styles.body}>{r.details}</Text>}
              {!!r.final_decision && (
                <View style={styles.decision}>
                  <Text style={styles.body}>
                    <Text style={styles.label}>Final decision{r.decided_on ? ` · ${formatAdDate(r.decided_on, system)}` : ''}: </Text>
                    {r.final_decision}
                  </Text>
                </View>
              )}
              <View style={styles.actions}>
                <LinkText label="Edit" onPress={() => openDialog(r)} />
                <LinkText label="Delete" tone="critical" onPress={() => remove(r)} />
              </View>
            </View>
          ))}
        </>
      )}

      <Sheet
        visible={!!dialog}
        title={dialog?.editing ? 'Edit record' : 'Add a conduct record'}
        onClose={() => setDialog(null)}
        onSubmit={save}
        saving={saving}
        submitLabel={dialog?.editing ? 'Save changes' : 'Add record'}
        error={formError}
      >
        <Choice label="Kind" options={CONDUCT_KINDS.map(k => ({ label: k.label, value: k.value }))} value={form.kind} onChange={v => v && change({ kind: v })} />
        <DateField label="Date" value={form.record_date} onChange={v => change({ record_date: v })} />
        <Field label="Title" value={form.title} onChangeText={v => change({ title: v })} placeholder="A short summary, e.g. Late three times in a week" />
        {form.kind === 'warning' && <Choice label="Warning level" options={WARNING_LEVELS} value={form.warning_level} onChange={v => change({ warning_level: v ?? '' })} allowNone noneLabel="Not stated" />}
        <Field label="Details" value={form.details} onChangeText={v => change({ details: v })} multiline placeholder="What happened, who was involved" />
        <Choice label="Status" options={CONDUCT_STATUSES} value={form.status} onChange={v => v && change({ status: v })} />
        <Field label="Final decision" value={form.final_decision} onChangeText={v => change({ final_decision: v })} multiline placeholder="How it was decided (required to close it)" />
        {(!!form.final_decision.trim() || form.status === 'closed') && <DateField label="Decided on" value={form.decided_on} onChange={v => change({ decided_on: v })} />}
      </Sheet>
    </CollapsibleCard>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  filterChipActive: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  filterText: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  addRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  open: { fontSize: 12, fontWeight: '700', color: colors.warningText },
  empty: { fontSize: 12, color: colors.slate400, marginTop: 8 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  date: { fontSize: 13, fontWeight: '800', color: colors.ink },
  title: { fontSize: 13, fontWeight: '600', color: colors.ink, marginTop: 4 },
  body: { fontSize: 13, color: colors.ink, marginTop: 3, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  decision: { backgroundColor: colors.slate50, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6 },
});
