import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate } from '../../lib/calendar';
import { degreeLabel, experienceSummary, formatDuration, formatPassingYear, highestQualification } from '../../lib/employeeProfile';
import { SKILL_CATEGORIES } from '../../lib/skillCategories';
import type { Employee, EmployeeEducation, EmployeeTraining, EmployeeWorkExperience } from '../../types';
import { colors } from '../../theme';
import { Choice, CollapsibleCard, DateField, Field, InfoRow, LinkText, Notice, Sheet, confirmAsync } from '../hr/HrKit';

const DEGREES = [
  { label: 'Under SEE', value: 'Under SEE' },
  { label: 'SEE', value: 'SEE' },
  { label: 'Intermediate (+2)', value: 'Intermediate' },
  { label: 'Bachelor', value: 'Bachelors' },
  { label: 'Master', value: 'Masters' },
];

const EMPTY_EDUCATION = { degree: '', institution: '', board_university: '', year: '', year_calendar: 'AD' as 'AD' | 'BS' };
const EMPTY_TRAINING = { title: '', provider: '', start_date: '', end_date: '' };
const EMPTY_EXPERIENCE = { employer: '', role: '', description: '', start_date: '', end_date: '' };

const DAY_MS = 86400000;
function tenureDays(start: string | null, end: string | null): number | null {
  if (!start) return null;
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / DAY_MS);
}

type Table = 'employee_education' | 'employee_training' | 'employee_work_experience';

/** Loads one of the employee's own lists; `reload` re-reads it after an add, edit or removal. */
function useRows<T>(table: Table, employeeId: string, orderBy: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from(table).select('*').eq('employee_id', employeeId).order(orderBy, { ascending: false });
    if (error) return setStatus('unavailable');
    setRows((data ?? []) as T[]);
    setStatus('ready');
  }, [table, employeeId, orderBy]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { rows, status, reload };
}

/** Asks, then deletes. Resolves to an error message, '' when it worked, or null when they backed out. */
async function removeRow(table: Table, id: string, what: string): Promise<string | null> {
  if (!(await confirmAsync('Remove entry?', `Remove ${what}?`, 'Remove', true))) return null;
  const { error } = await supabase.from(table).delete().eq('id', id);
  return error ? `Could not remove: ${error.message}` : '';
}

function Unavailable() {
  return <Notice tone="warning">This isn't available right now.</Notice>;
}

/** The "+ Add" link that sits beside a card's title. */
function AddLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <LinkText label="+ Add" accessibilityLabel={`Add ${label}`} onPress={onPress} />;
}

/** One list entry: what it says on the left, Edit / Remove on the right. */
function Entry({ children, name, onEdit, onRemove }: { children: React.ReactNode; name: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <View style={styles.item}>
      <View style={{ flex: 1 }}>{children}</View>
      <View style={styles.itemActions}>
        <LinkText label="Edit" accessibilityLabel={`Edit ${name}`} onPress={onEdit} />
        <LinkText label="Remove" accessibilityLabel={`Remove ${name}`} tone="critical" onPress={onRemove} />
      </View>
    </View>
  );
}

// --- Education ---------------------------------------------------------------

export function MyEducationCard({ employeeId }: { employeeId: string }) {
  const { rows, status, reload } = useRows<EmployeeEducation>('employee_education', employeeId, 'year');
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState(EMPTY_EDUCATION);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  const highest = highestQualification(rows);

  function open(ed: EmployeeEducation | null) {
    setForm(
      ed
        ? { degree: ed.degree, institution: ed.institution ?? '', board_university: ed.board_university ?? '', year: ed.year ? String(ed.year) : '', year_calendar: ed.year_calendar === 'BS' ? 'BS' : 'AD' }
        : EMPTY_EDUCATION
    );
    setFormError('');
    setEditing({ id: ed?.id ?? null });
  }

  async function save() {
    if (!editing) return;
    if (!form.degree) return setFormError('Pick the qualification.');
    if (form.year.trim() && !/^\d{4}$/.test(form.year.trim())) return setFormError('Enter the year as four digits.');
    const row = {
      degree: form.degree,
      institution: form.institution.trim() || null,
      board_university: form.board_university.trim() || null,
      year: form.year.trim() ? Number(form.year) : null,
      year_calendar: form.year_calendar,
    };
    setSaving(true);
    setFormError('');
    const { error } = editing.id ? await supabase.from('employee_education').update(row).eq('id', editing.id) : await supabase.from('employee_education').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setEditing(null);
    reload();
  }

  async function remove(id: string) {
    const result = await removeRow('employee_education', id, 'this education entry');
    if (result === null) return;
    setActionError(result);
    if (!result) reload();
  }

  const summary = status !== 'ready' ? (status === 'loading' ? 'Loading…' : 'Not available') : rows.length === 0 ? 'None added' : highest ? `Highest: ${degreeLabel(highest.degree)}` : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;

  return (
    <CollapsibleCard title="Education" summary={summary} right={status === 'ready' ? <AddLink label="education" onPress={() => open(null)} /> : undefined}>
      {status === 'unavailable' && <Unavailable />}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      {status === 'ready' && (
        <>
          {rows.length === 0 && <Text style={styles.empty}>No education entries yet.</Text>}
          {rows.map(ed => (
            <Entry key={ed.id} name={degreeLabel(ed.degree)} onEdit={() => open(ed)} onRemove={() => remove(ed.id)}>
              <Text style={styles.title}>{degreeLabel(ed.degree)}</Text>
              {(!!ed.institution || !!ed.board_university || !!ed.year) && <Text style={styles.sub}>{[ed.institution, ed.board_university, formatPassingYear(ed)].filter(Boolean).join(', ')}</Text>}
            </Entry>
          ))}
        </>
      )}
      <Sheet visible={!!editing} title={editing?.id ? 'Edit education' : 'Add education'} onClose={() => !saving && setEditing(null)} onSubmit={save} saving={saving} submitLabel={editing?.id ? 'Save' : 'Add'} error={formError}>
        <Choice label="Qualification" options={DEGREES} value={form.degree} onChange={v => v && setForm(f => ({ ...f, degree: v }))} />
        <Field label="Institution" value={form.institution} onChangeText={v => setForm(f => ({ ...f, institution: v }))} />
        <Field label="Board / University" value={form.board_university} onChangeText={v => setForm(f => ({ ...f, board_university: v }))} placeholder="e.g. NEB, Tribhuvan University" />
        <Field label="Passing year" value={form.year} onChangeText={v => setForm(f => ({ ...f, year: v }))} keyboardType="number-pad" placeholder="e.g. 2078" />
        <Choice label="Year is in" options={[{ label: 'AD', value: 'AD' }, { label: 'BS', value: 'BS' }]} value={form.year_calendar} onChange={v => v && setForm(f => ({ ...f, year_calendar: v }))} />
      </Sheet>
    </CollapsibleCard>
  );
}

// --- Training ----------------------------------------------------------------

export function MyTrainingCard({ employeeId }: { employeeId: string }) {
  const { system } = useCalendarSystem();
  const { rows, status, reload } = useRows<EmployeeTraining>('employee_training', employeeId, 'start_date');
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState(EMPTY_TRAINING);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  function open(t: EmployeeTraining | null) {
    setForm(t ? { title: t.title, provider: t.provider ?? '', start_date: t.start_date ?? '', end_date: t.end_date ?? '' } : EMPTY_TRAINING);
    setFormError('');
    setEditing({ id: t?.id ?? null });
  }

  async function save() {
    if (!editing) return;
    if (!form.title.trim()) return setFormError('Enter the course or certificate.');
    if (form.start_date && form.end_date && form.end_date < form.start_date) return setFormError('The end date is before the start date.');
    const row = { title: form.title.trim(), provider: form.provider.trim() || null, start_date: form.start_date || null, end_date: form.end_date || null };
    setSaving(true);
    setFormError('');
    const { error } = editing.id ? await supabase.from('employee_training').update(row).eq('id', editing.id) : await supabase.from('employee_training').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setEditing(null);
    reload();
  }

  async function remove(t: EmployeeTraining) {
    const result = await removeRow('employee_training', t.id, `"${t.title}"`);
    if (result === null) return;
    setActionError(result);
    if (!result) reload();
  }

  const summary = status !== 'ready' ? (status === 'loading' ? 'Loading…' : 'Not available') : rows.length === 0 ? 'None recorded' : `${rows.length} recorded`;

  return (
    <CollapsibleCard title="Training & certification" summary={summary} right={status === 'ready' ? <AddLink label="training" onPress={() => open(null)} /> : undefined}>
      {status === 'unavailable' && <Unavailable />}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      {status === 'ready' && (
        <>
          {rows.length === 0 && <Text style={styles.empty}>No training recorded yet.</Text>}
          {rows.map(t => (
            <Entry key={t.id} name={t.title} onEdit={() => open(t)} onRemove={() => remove(t)}>
              <Text style={styles.title}>{t.title}</Text>
              {!!t.provider && <Text style={styles.sub}>{t.provider}</Text>}
              {(!!t.start_date || !!t.end_date) && (
                <Text style={styles.dates}>
                  {t.start_date ? formatAdDate(t.start_date, system) : '—'}
                  {t.end_date ? ` – ${formatAdDate(t.end_date, system)}` : ''}
                </Text>
              )}
            </Entry>
          ))}
        </>
      )}
      <Sheet visible={!!editing} title={editing?.id ? 'Edit training' : 'Add training'} onClose={() => !saving && setEditing(null)} onSubmit={save} saving={saving} submitLabel={editing?.id ? 'Save' : 'Add'} error={formError}>
        <Field label="Course or certificate" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. First aid certificate" />
        <Field label="Provider" value={form.provider} onChangeText={v => setForm(f => ({ ...f, provider: v }))} />
        <DateField label="Start date" value={form.start_date} onChange={v => setForm(f => ({ ...f, start_date: v }))} />
        <DateField label="End date" value={form.end_date} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
      </Sheet>
    </CollapsibleCard>
  );
}

// --- Work experience ---------------------------------------------------------

export function MyExperienceCard({ employee }: { employee: Pick<Employee, 'id' | 'date_of_joining' | 'resigned_at'> }) {
  const { system } = useCalendarSystem();
  const { rows, status, reload } = useRows<EmployeeWorkExperience>('employee_work_experience', employee.id, 'start_date');
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState(EMPTY_EXPERIENCE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  const totals = experienceSummary(rows, employee.date_of_joining, employee.resigned_at);

  function open(x: EmployeeWorkExperience | null) {
    setForm(x ? { employer: x.employer, role: x.role ?? '', description: x.description ?? '', start_date: x.start_date ?? '', end_date: x.end_date ?? '' } : EMPTY_EXPERIENCE);
    setFormError('');
    setEditing({ id: x?.id ?? null });
  }

  async function save() {
    if (!editing) return;
    if (!form.employer.trim()) return setFormError('Enter the employer.');
    if (form.start_date && form.end_date && form.end_date < form.start_date) return setFormError('The end date is before the start date.');
    const row = {
      employer: form.employer.trim(),
      role: form.role.trim() || null,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    setSaving(true);
    setFormError('');
    const { error } = editing.id
      ? await supabase.from('employee_work_experience').update(row).eq('id', editing.id)
      : await supabase.from('employee_work_experience').insert({ ...row, employee_id: employee.id });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setEditing(null);
    reload();
  }

  async function remove(x: EmployeeWorkExperience) {
    const result = await removeRow('employee_work_experience', x.id, 'this work experience entry');
    if (result === null) return;
    setActionError(result);
    if (!result) reload();
  }

  const summary = status !== 'ready' ? (status === 'loading' ? 'Loading…' : 'Not available') : totals.total > 0 ? `Total ${formatDuration(totals.total)}` : 'None added';

  return (
    <CollapsibleCard title="Work experience" summary={summary} right={status === 'ready' ? <AddLink label="work experience" onPress={() => open(null)} /> : undefined}>
      {status === 'unavailable' && <Unavailable />}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      {status === 'ready' && (
        <>
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
              <Entry key={x.id} name={x.role || x.employer} onEdit={() => open(x)} onRemove={() => remove(x)}>
                <Text style={styles.title}>
                  {x.employer}
                  {x.role ? <Text style={styles.sub}> — {x.role}</Text> : null}
                </Text>
                {!!x.description && <Text style={styles.sub}>{x.description}</Text>}
                {(!!x.start_date || !!x.end_date) && (
                  <Text style={styles.dates}>
                    {x.start_date ? formatAdDate(x.start_date, system) : '—'} – {x.end_date ? formatAdDate(x.end_date, system) : 'Present'}
                    {days !== null ? ` · ${days} days` : ''}
                  </Text>
                )}
              </Entry>
            );
          })}
        </>
      )}
      <Sheet visible={!!editing} title={editing?.id ? 'Edit work experience' : 'Add work experience'} onClose={() => !saving && setEditing(null)} onSubmit={save} saving={saving} submitLabel={editing?.id ? 'Save' : 'Add'} error={formError}>
        <Field label="Employer" value={form.employer} onChangeText={v => setForm(f => ({ ...f, employer: v }))} />
        <Field label="Role" value={form.role} onChangeText={v => setForm(f => ({ ...f, role: v }))} />
        <Field label="Description" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline />
        <DateField label="Start date" value={form.start_date} onChange={v => setForm(f => ({ ...f, start_date: v }))} />
        <DateField label="End date (empty if still there)" value={form.end_date} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
      </Sheet>
    </CollapsibleCard>
  );
}

// --- Skills ------------------------------------------------------------------

/** Skills are kept on the employee row, so `onSave` is the profile screen's save (update_my_profile);
 * it resolves to an error message, or null when it worked. */
export function MySkillsCard({ skills, onSave }: { skills: string[]; onSave: (skills: string[]) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof SKILL_CATEGORIES)[number]>(SKILL_CATEGORIES[0]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  async function add() {
    const value = input.trim();
    if (!value) return setFormError('Type the skill.');
    const skill = `${category}: ${value}`;
    if (!skills.includes(skill)) {
      setSaving(true);
      const message = await onSave([...skills, skill]);
      setSaving(false);
      if (message) return setFormError(`Could not add skill: ${message}`);
    }
    setOpen(false);
  }

  async function remove(skill: string) {
    setActionError('');
    const message = await onSave(skills.filter(s => s !== skill));
    if (message) setActionError(`Could not remove skill: ${message}`);
  }

  return (
    <CollapsibleCard
      title="Skills"
      summary={skills.length === 0 ? 'None added' : `${skills.length} added`}
      right={
        <LinkText
          label="+ Add"
          accessibilityLabel="Add skill"
          onPress={() => {
            setInput('');
            setFormError('');
            setOpen(true);
          }}
        />
      }
    >
      {!!actionError && <Notice tone="error">{actionError}</Notice>}
      <View style={styles.chipsRow}>
        {skills.map(skill => (
          <View key={skill} style={styles.skillChip}>
            <Text style={styles.skillChipText}>{skill}</Text>
            <LinkText label="×" accessibilityLabel={`Remove ${skill}`} tone="critical" onPress={() => remove(skill)} />
          </View>
        ))}
        {skills.length === 0 && <Text style={styles.empty}>No skills added yet.</Text>}
      </View>
      <Sheet visible={open} title="Add skill" onClose={() => !saving && setOpen(false)} onSubmit={add} saving={saving} submitLabel="Add" error={formError}>
        <Choice label="Category" options={SKILL_CATEGORIES.map(c => ({ label: c, value: c }))} value={category} onChange={v => v && setCategory(v)} />
        <Field label="Skill" value={input} onChangeText={setInput} placeholder="e.g. English, Forklift license…" />
      </Sheet>
    </CollapsibleCard>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 12, color: colors.slate400, marginTop: 10 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  itemActions: { alignItems: 'flex-end', gap: 12 },
  title: { fontSize: 13, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12, fontWeight: '400', color: colors.slate500, marginTop: 2 },
  dates: { fontSize: 11, color: colors.slate400, marginTop: 3 },
  summaryBox: { backgroundColor: colors.slate50, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, marginTop: 10, marginBottom: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  skillChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.goodBg, borderRadius: 20, paddingLeft: 10, paddingRight: 8, paddingVertical: 4 },
  skillChipText: { fontSize: 11, color: colors.goodText, fontWeight: '600' },
});
