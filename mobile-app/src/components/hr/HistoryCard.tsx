import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate, localDateKey } from '../../lib/calendar';
import {
  HISTORY_FIELDS,
  buildManualChanges,
  entryTags,
  formatMoney,
  percentChange,
  type EmployeeHistoryEntry,
  type HistoryChange,
  type HistoryField,
} from '../../lib/employeeHistory';
import { colors } from '../../theme';
import Badge from '../Badge';
import { Choice, CollapsibleCard, DateField, Field, LinkText, Notice, Sheet, SubHeading, confirmAsync } from './HrKit';

type Pairs = Partial<Record<HistoryField, { from: string; to: string }>>;
type Kind = 'transfer' | 'promotion' | 'increment';

// What each kind of past record asks for.
const KINDS: { value: Kind; label: string; fields: HistoryField[] }[] = [
  { value: 'transfer', label: 'Transfer', fields: ['branch'] },
  { value: 'promotion', label: 'Promotion', fields: ['designation', 'department', 'reports_to'] },
  { value: 'increment', label: 'Salary increment', fields: ['salary', 'allowance'] },
];

/** The log of an employee's transfers, promotions and pay changes. Entries are written
 * by the database whenever branch, designation, department, reporting-to, basic salary
 * or allowance is edited — from the website or from this app. Here HR fills in the
 * reason, corrects the effective date, or adds something from before the system was
 * used. What was recorded as changed can't be edited; only the note and the date. */
export default function HistoryCard({ employeeId, joinedOn, reloadKey = 0 }: { employeeId: string; joinedOn: string | null; reloadKey?: number }) {
  const { system } = useCalendarSystem();
  const [entries, setEntries] = useState<EmployeeHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [editing, setEditing] = useState<EmployeeHistoryEntry | null>(null);
  const [editForm, setEditForm] = useState({ date: '', reason: '', remark: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>('transfer');
  const [pairs, setPairs] = useState<Pairs>({});
  const [addForm, setAddForm] = useState({ date: '', reason: '', remark: '' });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_history')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setEntries((data ?? []) as EmployeeHistoryEntry[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  function startEdit(entry: EmployeeHistoryEntry) {
    setEditing(entry);
    setEditForm({ date: entry.effective_date, reason: entry.reason ?? '', remark: entry.remark ?? '' });
    setEditError('');
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.date) return setEditError('Pick the effective date.');
    setSavingEdit(true);
    const { error } = await supabase
      .from('employee_history')
      .update({ effective_date: editForm.date, reason: editForm.reason.trim() || null, remark: editForm.remark.trim() || null })
      .eq('id', editing.id);
    setSavingEdit(false);
    if (error) return setEditError(`Could not save: ${error.message}`);
    setEditing(null);
    load();
  }

  async function handleDelete(entry: EmployeeHistoryEntry) {
    if (!(await confirmAsync('Delete entry?', 'Use this for an entry made by a typo fix, not to hide a real change.', 'Delete', true))) return;
    setActionError('');
    const { error } = await supabase.from('employee_history').delete().eq('id', entry.id);
    if (error) return setActionError(`Could not delete: ${error.message}`);
    load();
  }

  function openAdd() {
    setAdding(true);
    setKind('transfer');
    setPairs({});
    setAddForm({ date: '', reason: '', remark: '' });
    setAddError('');
  }

  function setPair(field: HistoryField, side: 'from' | 'to', value: string) {
    setPairs(p => ({ ...p, [field]: { from: '', to: '', ...p[field], [side]: value } }));
  }

  async function saveAdd() {
    setAddError('');
    const fields = KINDS.find(k => k.value === kind)!.fields;
    const used: Pairs = {};
    for (const f of fields) used[f] = pairs[f];
    const changes = buildManualChanges(used);
    if (!addForm.date) return setAddError('Pick the date it took effect.');
    if (!Object.values(changes).some(c => c.to !== null && c.to !== '')) return setAddError('Fill in what it changed to.');
    const badNumber = HISTORY_FIELDS.some(f => {
      const c = changes[f.key];
      return f.money && c && [c.from, c.to].some(v => v !== null && (typeof v !== 'number' || Number.isNaN(v) || v < 0));
    });
    if (badNumber) return setAddError('Salary and allowance must be numbers, zero or more.');
    setSavingAdd(true);
    const { error } = await supabase.from('employee_history').insert({
      employee_id: employeeId,
      changes,
      effective_date: addForm.date,
      reason: addForm.reason.trim() || null,
      remark: addForm.remark.trim() || null,
      source: 'manual',
    });
    setSavingAdd(false);
    if (error) return setAddError(`Could not save: ${error.message}`);
    setAdding(false);
    load();
  }

  const activeFields = KINDS.find(k => k.value === kind)!.fields;
  const summary =
    status === 'ready' ? (entries.length === 0 ? 'Nothing recorded yet' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`) : status === 'unavailable' ? 'Not set up yet' : 'Loading…';

  return (
    <CollapsibleCard title="Transfers, promotions & increments" summary={summary}>
      <Text style={styles.intro}>Recorded automatically when the branch, designation, department, reporting-to or pay is edited. Add the reason and the date it took effect here.</Text>

      {status === 'unavailable' && (
        <Notice tone="warning">
          History can't be loaded yet. If this is the first time, run the latest database migration (20261101160000_employee_history.sql) in Supabase. ({loadError})
        </Notice>
      )}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}

      {status === 'ready' && (
        <>
          <SubHeading title="Log" action={<LinkText label="+ Add past record" onPress={openAdd} />} />
          {entries.length === 0 && <Text style={styles.empty}>Nothing recorded yet. When this person is transferred, promoted or given a pay change, it appears here by itself.</Text>}
          {entries.map(entry => (
            <View key={entry.id} style={styles.entry}>
              <View style={styles.entryHead}>
                <Text style={styles.entryDate}>{formatAdDate(entry.effective_date, system)}</Text>
                {entryTags(entry.changes).map(t => (
                  <Badge key={t.label} tone={t.tone}>
                    {t.label}
                  </Badge>
                ))}
              </View>
              {HISTORY_FIELDS.map(field => {
                const change = entry.changes[field.key];
                return change ? <ChangeLine key={field.key} label={field.label} money={field.money} change={change} /> : null;
              })}
              {!!entry.reason && (
                <Text style={styles.note}>
                  <Text style={styles.noteLabel}>Reason: </Text>
                  {entry.reason}
                </Text>
              )}
              {!!entry.remark && (
                <Text style={styles.note}>
                  <Text style={styles.noteLabel}>Remark: </Text>
                  {entry.remark}
                </Text>
              )}
              <View style={styles.entryFoot}>
                <Text style={styles.footText}>
                  {entry.source === 'manual' ? 'Added by hand' : 'Recorded automatically'} · {formatAdDate(localDateKey(entry.created_at), system)}
                </Text>
              </View>
              <View style={styles.actions}>
                <LinkText label="Edit reason & date" onPress={() => startEdit(entry)} />
                <LinkText label="Delete" tone="critical" onPress={() => handleDelete(entry)} />
              </View>
            </View>
          ))}
          {!!joinedOn && (
            <View style={styles.joined}>
              <Text style={styles.entryDate}>{formatAdDate(joinedOn, system)}</Text>
              <Text style={styles.footText}> Joined</Text>
            </View>
          )}
        </>
      )}

      <Sheet visible={!!editing} title="Edit reason & date" onClose={() => setEditing(null)} onSubmit={saveEdit} saving={savingEdit} submitLabel="Save" error={editError}>
        <DateField label="Effective date" value={editForm.date} onChange={v => setEditForm(f => ({ ...f, date: v }))} />
        <Field label="Reason" value={editForm.reason} onChangeText={v => setEditForm(f => ({ ...f, reason: v }))} placeholder="e.g. Annual review, opening of new outlet" />
        <Field label="Remark" value={editForm.remark} onChangeText={v => setEditForm(f => ({ ...f, remark: v }))} multiline />
      </Sheet>

      <Sheet
        visible={adding}
        title="Add a past record"
        subtitle="For something that happened before this system was used. It doesn't change the employee's current details."
        onClose={() => setAdding(false)}
        onSubmit={saveAdd}
        saving={savingAdd}
        submitLabel="Add record"
        error={addError}
      >
        <Choice label="What happened" options={KINDS.map(k => ({ label: k.label, value: k.value }))} value={kind} onChange={v => v && (setKind(v), setAddError(''))} />
        <DateField label="Effective date" value={addForm.date} onChange={v => setAddForm(f => ({ ...f, date: v }))} />
        {activeFields.map(key => {
          const field = HISTORY_FIELDS.find(f => f.key === key)!;
          const pair = pairs[key] ?? { from: '', to: '' };
          const toOnly = key === 'reports_to';
          const kb = field.money ? 'numeric' : 'default';
          return (
            <View key={key}>
              {!toOnly && <Field label={`${field.label} — from`} value={pair.from} onChangeText={v => setPair(key, 'from', v)} keyboardType={kb} />}
              <Field label={toOnly ? `${field.label} — name` : `${field.label} — to`} value={pair.to} onChangeText={v => setPair(key, 'to', v)} keyboardType={kb} />
            </View>
          );
        })}
        <Field label="Reason" value={addForm.reason} onChangeText={v => setAddForm(f => ({ ...f, reason: v }))} />
        <Field label="Remark" value={addForm.remark} onChangeText={v => setAddForm(f => ({ ...f, remark: v }))} multiline />
      </Sheet>
    </CollapsibleCard>
  );
}

function ChangeLine({ label, money, change }: { label: string; money?: boolean; change: HistoryChange }) {
  const show = (v: string | number | null) => (money ? formatMoney(v) : v === null || v === '' ? '(none)' : String(v));
  const pct = money ? percentChange(change) : null;
  const hadBefore = change.from !== null && change.from !== '';
  return (
    <Text style={styles.line}>
      <Text style={styles.lineLabel}>{label}: </Text>
      {hadBefore && <Text style={styles.lineFrom}>{show(change.from)} → </Text>}
      <Text style={styles.lineTo}>{show(change.to)}</Text>
      {!!pct && <Text style={[styles.pct, { color: pct.startsWith('+') ? colors.goodText : colors.criticalText }]}> ({pct})</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  empty: { fontSize: 12, color: colors.slate400, marginTop: 6 },
  entry: { borderLeftWidth: 2, borderLeftColor: colors.slate200, paddingLeft: 12, marginTop: 12 },
  entryHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  entryDate: { fontSize: 13, fontWeight: '800', color: colors.ink },
  line: { fontSize: 13, marginTop: 4, color: colors.ink },
  lineLabel: { color: colors.slate500 },
  lineFrom: { color: colors.slate500 },
  lineTo: { fontWeight: '700', color: colors.ink },
  pct: { fontSize: 11, fontWeight: '700' },
  note: { fontSize: 12, color: colors.slate500, marginTop: 5, lineHeight: 17 },
  noteLabel: { fontWeight: '700' },
  entryFoot: { marginTop: 6 },
  footText: { fontSize: 11, color: colors.slate400 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  joined: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14, paddingLeft: 12 },
});
