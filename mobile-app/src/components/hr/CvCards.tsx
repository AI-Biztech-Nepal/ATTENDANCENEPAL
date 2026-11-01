import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate } from '../../lib/calendar';
import { degreeLabel, experienceSummary, formatDuration, formatPassingYear, highestQualification } from '../../lib/employeeProfile';
import type { Employee, EmployeeEducation, EmployeeTraining, EmployeeWorkExperience } from '../../types';
import { colors } from '../../theme';
import { Choice, CollapsibleCard, DateField, Field, InfoRow, LinkText, Notice, Sheet, confirmAsync } from './HrKit';

const DEGREES = [
  { label: 'Under SEE', value: 'Under SEE' },
  { label: 'SEE', value: 'SEE' },
  { label: 'Intermediate (+2)', value: 'Intermediate' },
  { label: 'Bachelor', value: 'Bachelors' },
  { label: 'Master', value: 'Masters' },
];

const DAY_MS = 86400000;
function tenureDays(start: string | null, end: string | null): number | null {
  if (!start) return null;
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / DAY_MS);
}

/** Loads one list for the employee; `reload` re-reads it after an add or delete. */
function useRows<T>(table: string, employeeId: string, orderBy: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const { data, error: err } = await supabase.from(table).select('*').eq('employee_id', employeeId).order(orderBy, { ascending: false });
    if (err) {
      setError(err.message);
      setStatus('unavailable');
      return;
    }
    setRows((data ?? []) as T[]);
    setStatus('ready');
  }, [table, employeeId, orderBy]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { rows, status, error, reload };
}

async function removeRow(table: string, id: string, what: string): Promise<string | null> {
  if (!(await confirmAsync('Remove entry?', `Remove this ${what} entry?`, 'Remove', true))) return null;
  const { error } = await supabase.from(table).delete().eq('id', id);
  return error ? `Could not remove: ${error.message}` : '';
}

function Unavailable({ message }: { message: string }) {
  return <Notice tone="warning">{`This can't be loaded right now. (${message})`}</Notice>;
}

// --- Education ---------------------------------------------------------------

export function EducationCard({ employeeId }: { employeeId: string }) {
  const { rows, status, error, reload } = useRows<EmployeeEducation>('employee_education', employeeId, 'year');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ degree: '', institution: '', board_university: '', year: '', year_calendar: 'AD' as 'AD' | 'BS' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  const highest = highestQualification(rows);

  async function add() {
    if (!form.degree) return setFormError('Pick the qualification.');
    if (form.year.trim() && !/^\d{4}$/.test(form.year.trim())) return setFormError('Enter the year as four digits.');
    setSaving(true);
    setFormError('');
    const { error: err } = await supabase.from('employee_education').insert({
      employee_id: employeeId,
      degree: form.degree,
      institution: form.institution.trim() || null,
      year: form.year.trim() ? Number(form.year) : null,
      // Only sent when used, so a plain entry still works before the HR-profile migration is run.
      ...(form.board_university.trim() ? { board_university: form.board_university.trim() } : {}),
      ...(form.year_calendar === 'BS' ? { year_calendar: 'BS' } : {}),
    });
    setSaving(false);
    if (err) return setFormError(`Could not add: ${err.message}`);
    setOpen(false);
    setForm({ degree: '', institution: '', board_university: '', year: '', year_calendar: 'AD' });
    reload();
  }

  async function remove(id: string) {
    const result = await removeRow('employee_education', id, 'education');
    if (result === null) return;
    setActionError(result);
    if (!result) reload();
  }

  const summary = status !== 'ready' ? (status === 'loading' ? 'Loading…' : 'Unavailable') : rows.length === 0 ? 'None added' : highest ? `Highest: ${degreeLabel(highest.degree)}` : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;

  return (
    <CollapsibleCard title="Education" summary={summary}>
      {status === 'unavailable' && <Unavailable message={error} />}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      {status === 'ready' && (
        <>
          <View style={styles.addRow}>
            <LinkText label="+ Add" onPress={() => { setFormError(''); setOpen(true); }} />
          </View>
          {rows.length === 0 && <Text style={styles.empty}>No education entries yet.</Text>}
          {rows.map(ed => (
            <View key={ed.id} style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{degreeLabel(ed.degree)}</Text>
                {(ed.institution || ed.board_university || ed.year) && <Text style={styles.sub}>{[ed.institution, ed.board_university, formatPassingYear(ed)].filter(Boolean).join(', ')}</Text>}
              </View>
              <LinkText label="Remove" tone="critical" onPress={() => remove(ed.id)} />
            </View>
          ))}
        </>
      )}
      <Sheet visible={open} title="Add education" onClose={() => setOpen(false)} onSubmit={add} saving={saving} submitLabel="Add" error={formError}>
        <Choice label="Qualification" options={DEGREES} value={form.degree} onChange={v => v && setForm(f => ({ ...f, degree: v }))} />
        <Field label="Institution" value={form.institution} onChangeText={v => setForm(f => ({ ...f, institution: v }))} />
        <Field label="Board / University" value={form.board_university} onChangeText={v => setForm(f => ({ ...f, board_university: v }))} placeholder="e.g. NEB, Tribhuvan University" />
        <Field label="Passing year" value={form.year} onChangeText={v => setForm(f => ({ ...f, year: v }))} keyboardType="number-pad" placeholder="e.g. 2078" />
        <Choice
          label="Year is in"
          options={[{ label: 'AD', value: 'AD' }, { label: 'BS', value: 'BS' }]}
          value={form.year_calendar}
          onChange={v => v && setForm(f => ({ ...f, year_calendar: v }))}
        />
      </Sheet>
    </CollapsibleCard>
  );
}

// --- Training ----------------------------------------------------------------

export function TrainingCard({ employeeId }: { employeeId: string }) {
  const { system } = useCalendarSystem();
  const { rows, status, error, reload } = useRows<EmployeeTraining>('employee_training', employeeId, 'start_date');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', provider: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  async function add() {
    if (!form.title.trim()) return setFormError('Enter the training title.');
    if (form.start_date && form.end_date && form.end_date < form.start_date) return setFormError('The end date is before the start date.');
    setSaving(true);
    setFormError('');
    const { error: err } = await supabase.from('employee_training').insert({
      employee_id: employeeId,
      title: form.title.trim(),
      provider: form.provider.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });
    setSaving(false);
    if (err) return setFormError(`Could not add: ${err.message}`);
    setOpen(false);
    setForm({ title: '', provider: '', start_date: '', end_date: '' });
    reload();
  }

  async function remove(id: string) {
    const result = await removeRow('employee_training', id, 'training');
    if (result === null) return;
    setActionError(result);
    if (!result) reload();
  }

  const summary = status !== 'ready' ? (status === 'loading' ? 'Loading…' : 'Unavailable') : rows.length === 0 ? 'None recorded' : `${rows.length} recorded`;

  return (
    <CollapsibleCard title="Training & certification" summary={summary}>
      {status === 'unavailable' && <Unavailable message={error} />}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      {status === 'ready' && (
        <>
          <View style={styles.addRow}>
            <LinkText label="+ Add" onPress={() => { setFormError(''); setOpen(true); }} />
          </View>
          {rows.length === 0 && <Text style={styles.empty}>No training recorded yet.</Text>}
          {rows.map(t => (
            <View key={t.id} style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t.title}</Text>
                {!!t.provider && <Text style={styles.sub}>{t.provider}</Text>}
                {(t.start_date || t.end_date) && (
                  <Text style={styles.dates}>
                    {t.start_date ? formatAdDate(t.start_date, system) : '—'}
                    {t.end_date ? ` – ${formatAdDate(t.end_date, system)}` : ''}
                  </Text>
                )}
              </View>
              <LinkText label="Remove" tone="critical" onPress={() => remove(t.id)} />
            </View>
          ))}
        </>
      )}
      <Sheet visible={open} title="Add training" onClose={() => setOpen(false)} onSubmit={add} saving={saving} submitLabel="Add" error={formError}>
        <Field label="Title" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. First aid certificate" />
        <Field label="Provider" value={form.provider} onChangeText={v => setForm(f => ({ ...f, provider: v }))} />
        <DateField label="Start date" value={form.start_date} onChange={v => setForm(f => ({ ...f, start_date: v }))} />
        <DateField label="End date" value={form.end_date} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
      </Sheet>
    </CollapsibleCard>
  );
}

// --- Work experience ---------------------------------------------------------

export function ExperienceCard({ employee }: { employee: Pick<Employee, 'id' | 'date_of_joining' | 'resigned_at'> }) {
  const { system } = useCalendarSystem();
  const { rows, status, error, reload } = useRows<EmployeeWorkExperience>('employee_work_experience', employee.id, 'start_date');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employer: '', role: '', description: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  const totals = experienceSummary(rows, employee.date_of_joining, employee.resigned_at);

  async function add() {
    if (!form.employer.trim()) return setFormError('Enter the employer.');
    if (form.start_date && form.end_date && form.end_date < form.start_date) return setFormError('The end date is before the start date.');
    setSaving(true);
    setFormError('');
    const { error: err } = await supabase.from('employee_work_experience').insert({
      employee_id: employee.id,
      employer: form.employer.trim(),
      role: form.role.trim() || null,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });
    setSaving(false);
    if (err) return setFormError(`Could not add: ${err.message}`);
    setOpen(false);
    setForm({ employer: '', role: '', description: '', start_date: '', end_date: '' });
    reload();
  }

  async function remove(id: string) {
    const result = await removeRow('employee_work_experience', id, 'work experience');
    if (result === null) return;
    setActionError(result);
    if (!result) reload();
  }

  const summary = status !== 'ready' ? (status === 'loading' ? 'Loading…' : 'Unavailable') : totals.total > 0 ? `Total ${formatDuration(totals.total)}` : 'None added';

  return (
    <CollapsibleCard title="Work experience" summary={summary}>
      {status === 'unavailable' && <Unavailable message={error} />}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      {status === 'ready' && (
        <>
          <View style={styles.addRow}>
            <LinkText label="+ Add" onPress={() => { setFormError(''); setOpen(true); }} />
          </View>
          {totals.total > 0 && (
            <View style={styles.summaryBox}>
              <InfoRow label="Before joining" value={formatDuration(totals.previous)} />
              <InfoRow label="With this company" value={formatDuration(totals.here)} />
              <InfoRow label="Total work experience" value={formatDuration(totals.total)} />
            </View>
          )}
          {rows.length === 0 && <Text style={styles.empty}>No work experience entries yet.</Text>}
          {rows.map(x => {
            const days = tenureDays(x.start_date, x.end_date);
            return (
              <View key={x.id} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {x.employer}
                    {x.role ? <Text style={styles.sub}> — {x.role}</Text> : null}
                  </Text>
                  {!!x.description && <Text style={styles.sub}>{x.description}</Text>}
                  {(x.start_date || x.end_date) && (
                    <Text style={styles.dates}>
                      {formatAdDate(x.start_date, system)} – {x.end_date ? formatAdDate(x.end_date, system) : 'Present'}
                      {days !== null ? ` · ${days} days` : ''}
                    </Text>
                  )}
                </View>
                <LinkText label="Remove" tone="critical" onPress={() => remove(x.id)} />
              </View>
            );
          })}
        </>
      )}
      <Sheet visible={open} title="Add work experience" onClose={() => setOpen(false)} onSubmit={add} saving={saving} submitLabel="Add" error={formError}>
        <Field label="Employer" value={form.employer} onChangeText={v => setForm(f => ({ ...f, employer: v }))} />
        <Field label="Role" value={form.role} onChangeText={v => setForm(f => ({ ...f, role: v }))} />
        <Field label="Description" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline />
        <DateField label="Start date" value={form.start_date} onChange={v => setForm(f => ({ ...f, start_date: v }))} />
        <DateField label="End date (empty if still there)" value={form.end_date} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
      </Sheet>
    </CollapsibleCard>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  empty: { fontSize: 12, color: colors.slate400, marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  title: { fontSize: 13, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12, fontWeight: '400', color: colors.slate500, marginTop: 2 },
  dates: { fontSize: 11, color: colors.slate400, marginTop: 3 },
  summaryBox: { backgroundColor: colors.slate50, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 6 },
});
