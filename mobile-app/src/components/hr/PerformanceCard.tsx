import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate } from '../../lib/calendar';
import { PERIOD_TYPES, averageRating, periodLabel, ratingLabel, starString, type Appraisal, type Award, type PeriodType } from '../../lib/employeeRecords';
import { colors } from '../../theme';
import Badge from '../Badge';
import { Choice, CollapsibleCard, DateField, Field, LinkText, Notice, Sheet, SubHeading, confirmAsync } from './HrKit';

const EMPTY_APPRAISAL = { date: '', period_type: 'annual' as PeriodType, period_start: '', period_end: '', rating: '', evaluated_by: '', remarks: '', skills_assessment: '' };
const EMPTY_AWARD = { title: '', awarded_on: '', description: '' };

type Dialog = { kind: 'appraisal'; editing: Appraisal | null } | { kind: 'award'; editing: Award | null } | null;

/** An employee's appraisals (rating, remarks, who evaluated, skills assessment) and the
 * awards they have received. Owner / HR only. */
export default function PerformanceCard({ employeeId, managerName }: { employeeId: string; managerName: string | null }) {
  const { system } = useCalendarSystem();
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [dialog, setDialog] = useState<Dialog>(null);
  const [appraisalForm, setAppraisalForm] = useState(EMPTY_APPRAISAL);
  const [awardForm, setAwardForm] = useState(EMPTY_AWARD);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    const [a, w] = await Promise.all([
      supabase.from('employee_appraisals').select('*').eq('employee_id', employeeId).order('appraisal_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('employee_awards').select('*').eq('employee_id', employeeId).order('awarded_on', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    const error = a.error ?? w.error;
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setAppraisals((a.data ?? []) as Appraisal[]);
    setAwards((w.data ?? []) as Award[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAppraisal(editing: Appraisal | null) {
    setFormError('');
    setAppraisalForm(
      editing
        ? {
            date: editing.appraisal_date,
            period_type: editing.period_type,
            period_start: editing.period_start ?? '',
            period_end: editing.period_end ?? '',
            rating: String(editing.rating),
            evaluated_by: editing.evaluated_by ?? '',
            remarks: editing.remarks ?? '',
            skills_assessment: editing.skills_assessment ?? '',
          }
        : { ...EMPTY_APPRAISAL, evaluated_by: managerName ?? '' }
    );
    setDialog({ kind: 'appraisal', editing });
  }

  function openAward(editing: Award | null) {
    setFormError('');
    setAwardForm(editing ? { title: editing.title, awarded_on: editing.awarded_on, description: editing.description ?? '' } : EMPTY_AWARD);
    setDialog({ kind: 'award', editing });
  }

  async function saveAppraisal() {
    if (dialog?.kind !== 'appraisal') return;
    const f = appraisalForm;
    const rating = Number(f.rating);
    if (!f.date) return setFormError('Pick the appraisal date.');
    if (f.rating.trim() === '' || Number.isNaN(rating) || rating < 1 || rating > 5 || rating * 2 !== Math.floor(rating * 2)) {
      return setFormError('The rating must be from 1 to 5, in half steps (e.g. 3.5).');
    }
    if (f.period_start && f.period_end && f.period_end < f.period_start) return setFormError('The period ends before it starts.');
    setSaving(true);
    setFormError('');
    const row = {
      appraisal_date: f.date,
      period_type: f.period_type,
      period_start: f.period_start || null,
      period_end: f.period_end || null,
      rating,
      evaluated_by: f.evaluated_by.trim() || null,
      remarks: f.remarks.trim() || null,
      skills_assessment: f.skills_assessment.trim() || null,
    };
    const { error } = dialog.editing
      ? await supabase.from('employee_appraisals').update(row).eq('id', dialog.editing.id)
      : await supabase.from('employee_appraisals').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setDialog(null);
    load();
  }

  async function saveAward() {
    if (dialog?.kind !== 'award') return;
    const f = awardForm;
    if (!f.title.trim()) return setFormError('Give the award a title.');
    if (!f.awarded_on) return setFormError('Pick the date it was awarded.');
    setSaving(true);
    setFormError('');
    const row = { title: f.title.trim(), awarded_on: f.awarded_on, description: f.description.trim() || null };
    const { error } = dialog.editing
      ? await supabase.from('employee_awards').update(row).eq('id', dialog.editing.id)
      : await supabase.from('employee_awards').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setDialog(null);
    load();
  }

  async function remove(table: 'employee_appraisals' | 'employee_awards', id: string, what: string) {
    if (!(await confirmAsync(`Delete ${what}?`, "This can't be undone.", 'Delete', true))) return;
    setActionError('');
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return setActionError(`Could not delete: ${error.message}`);
    load();
  }

  const average = averageRating(appraisals);
  const summary =
    status === 'ready'
      ? appraisals.length === 0 && awards.length === 0
        ? 'Nothing recorded yet'
        : [average !== null ? `Average ${average} / 5` : null, awards.length > 0 ? `${awards.length} award${awards.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
      : status === 'unavailable'
        ? 'Not set up yet'
        : 'Loading…';

  return (
    <CollapsibleCard title="Performance & recognition" summary={summary}>
      <Text style={styles.intro}>Appraisals and awards. Only the owner and HR can see these. Training is listed in the Training card.</Text>

      {status === 'unavailable' && (
        <Notice tone="warning">
          This can't be loaded yet. If this is the first time, run the latest database migration (20261101200000_employee_performance_conduct.sql) in Supabase. ({loadError})
        </Notice>
      )}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}

      {status === 'ready' && (
        <>
          <SubHeading title="Appraisals" action={<LinkText label="+ Add appraisal" onPress={() => openAppraisal(null)} />} />
          {average !== null && appraisals[0] && (
            <Text style={styles.avg}>
              Average <Text style={styles.bold}>{average} / 5</Text> over {appraisals.length} appraisal{appraisals.length === 1 ? '' : 's'} · latest <Text style={styles.bold}>{appraisals[0].rating}</Text> on{' '}
              {formatAdDate(appraisals[0].appraisal_date, system)}
            </Text>
          )}
          {appraisals.length === 0 && <Text style={styles.empty}>No appraisals recorded yet.</Text>}
          {appraisals.map(a => (
            <View key={a.id} style={styles.item}>
              <View style={styles.head}>
                <Text style={styles.date}>{formatAdDate(a.appraisal_date, system)}</Text>
                <Badge tone="neutral">{periodLabel(a.period_type)}</Badge>
              </View>
              <Text style={styles.rating}>
                <Text style={styles.stars}>{starString(Number(a.rating))} </Text>
                <Text style={styles.bold}>{a.rating} / 5</Text>
                <Text style={styles.muted}> · {ratingLabel(Number(a.rating))}</Text>
              </Text>
              {(!!a.period_start || !!a.period_end) && (
                <Text style={styles.muted}>
                  Period: {a.period_start ? formatAdDate(a.period_start, system) : '—'} – {a.period_end ? formatAdDate(a.period_end, system) : '—'}
                </Text>
              )}
              {!!a.evaluated_by && <Text style={styles.muted}>Evaluated by {a.evaluated_by}</Text>}
              {!!a.remarks && (
                <Text style={styles.body}>
                  <Text style={styles.label}>Remarks: </Text>
                  {a.remarks}
                </Text>
              )}
              {!!a.skills_assessment && (
                <Text style={styles.body}>
                  <Text style={styles.label}>Skills assessment: </Text>
                  {a.skills_assessment}
                </Text>
              )}
              <View style={styles.actions}>
                <LinkText label="Edit" onPress={() => openAppraisal(a)} />
                <LinkText label="Delete" tone="critical" onPress={() => remove('employee_appraisals', a.id, 'appraisal')} />
              </View>
            </View>
          ))}

          <SubHeading title="Awards & recognition" action={<LinkText label="+ Add award" onPress={() => openAward(null)} />} />
          {awards.length === 0 && <Text style={styles.empty}>No awards recorded yet.</Text>}
          {awards.map(w => (
            <View key={w.id} style={styles.item}>
              <View style={styles.head}>
                <Text style={styles.date}>{w.title}</Text>
                <Text style={styles.muted}>{formatAdDate(w.awarded_on, system)}</Text>
              </View>
              {!!w.description && <Text style={styles.body}>{w.description}</Text>}
              <View style={styles.actions}>
                <LinkText label="Edit" onPress={() => openAward(w)} />
                <LinkText label="Delete" tone="critical" onPress={() => remove('employee_awards', w.id, 'award')} />
              </View>
            </View>
          ))}
        </>
      )}

      <Sheet
        visible={dialog?.kind === 'appraisal'}
        title={dialog?.editing ? 'Edit appraisal' : 'Add appraisal'}
        onClose={() => setDialog(null)}
        onSubmit={saveAppraisal}
        saving={saving}
        submitLabel={dialog?.editing ? 'Save changes' : 'Add appraisal'}
        error={formError}
      >
        <DateField label="Appraisal date" value={appraisalForm.date} onChange={v => setAppraisalForm(f => ({ ...f, date: v }))} />
        <Choice label="Period" options={PERIOD_TYPES} value={appraisalForm.period_type} onChange={v => v && setAppraisalForm(f => ({ ...f, period_type: v }))} />
        <DateField label="Period from (optional)" value={appraisalForm.period_start} onChange={v => setAppraisalForm(f => ({ ...f, period_start: v }))} />
        <DateField label="Period to (optional)" value={appraisalForm.period_end} onChange={v => setAppraisalForm(f => ({ ...f, period_end: v }))} />
        <Field
          label="Rating (1–5)"
          value={appraisalForm.rating}
          onChangeText={v => setAppraisalForm(f => ({ ...f, rating: v }))}
          keyboardType="decimal-pad"
          hint={
            appraisalForm.rating && !Number.isNaN(Number(appraisalForm.rating)) && Number(appraisalForm.rating) >= 1 && Number(appraisalForm.rating) <= 5
              ? ratingLabel(Number(appraisalForm.rating))
              : '1 poor · 3 meets expectations · 5 outstanding, in half steps'
          }
        />
        <Field label="Evaluated by" value={appraisalForm.evaluated_by} onChangeText={v => setAppraisalForm(f => ({ ...f, evaluated_by: v }))} placeholder="Reporting manager" />
        <Field label="Remarks" value={appraisalForm.remarks} onChangeText={v => setAppraisalForm(f => ({ ...f, remarks: v }))} multiline placeholder="Strengths, areas to improve, goals" />
        <Field label="Skills assessment" value={appraisalForm.skills_assessment} onChangeText={v => setAppraisalForm(f => ({ ...f, skills_assessment: v }))} multiline placeholder="Job-related skills and how they were assessed" />
      </Sheet>

      <Sheet
        visible={dialog?.kind === 'award'}
        title={dialog?.editing ? 'Edit award' : 'Add award'}
        onClose={() => setDialog(null)}
        onSubmit={saveAward}
        saving={saving}
        submitLabel={dialog?.editing ? 'Save changes' : 'Add award'}
        error={formError}
      >
        <Field label="Award / recognition" value={awardForm.title} onChangeText={v => setAwardForm(f => ({ ...f, title: v }))} placeholder="e.g. Employee of the month" />
        <DateField label="Awarded on" value={awardForm.awarded_on} onChange={v => setAwardForm(f => ({ ...f, awarded_on: v }))} />
        <Field label="Achievement" value={awardForm.description} onChangeText={v => setAwardForm(f => ({ ...f, description: v }))} multiline placeholder="What it was for" />
      </Sheet>
    </CollapsibleCard>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  avg: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  empty: { fontSize: 12, color: colors.slate400, marginTop: 6 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  date: { fontSize: 13, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  rating: { fontSize: 13, marginTop: 4, color: colors.ink },
  stars: { color: colors.warning, letterSpacing: 1 },
  bold: { fontWeight: '700', color: colors.ink },
  muted: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  body: { fontSize: 13, color: colors.ink, marginTop: 5, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6 },
});
