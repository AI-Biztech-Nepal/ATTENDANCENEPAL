import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate, localDateKey } from '../../lib/calendar';
import { HISTORY_FIELDS, entryTags, formatMoney, percentChange, type EmployeeHistoryEntry, type HistoryChange } from '../../lib/employeeHistory';
import {
  CONDUCT_KINDS,
  averageRating,
  periodLabel,
  ratingLabel,
  starString,
  statusLabel,
  warningLevelLabel,
  type Appraisal,
  type Award,
  type ConductKind,
  type ConductRecord,
  type ConductStatus,
  type WarningLevel,
} from '../../lib/employeeRecords';
import { colors } from '../../theme';
import Badge from '../Badge';
import { CollapsibleCard, Notice, SubHeading } from '../hr/HrKit';

const KIND_TONE: Record<ConductKind, 'warning' | 'critical' | 'info'> = { warning: 'warning', disciplinary: 'critical', grievance: 'info' };
const STATUS_TONE: Record<ConductStatus, 'warning' | 'info' | 'neutral'> = { open: 'warning', under_review: 'info', closed: 'neutral' };

type Loaded = {
  history: EmployeeHistoryEntry[] | null;
  appraisals: Appraisal[] | null;
  awards: Award[] | null;
  conduct: ConductRecord[] | null;
};

const UNAVAILABLE = "This isn't available right now.";

/** The records HR keeps on the employee — transfers / promotions / increments, appraisals and awards,
 * conduct — read only, as on the website's Records tab. Each list loads on its own; one that can't be
 * read (null) says so without taking the others down with it. */
export default function MyRecordsCards({ employeeId, joinedOn }: { employeeId: string; joinedOn: string | null }) {
  const { system } = useCalendarSystem();
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    const list = <T,>(r: { data: unknown; error: unknown }) => (r.error ? null : ((r.data ?? []) as T[]));
    Promise.all([
      supabase.from('employee_history').select('*').eq('employee_id', employeeId).order('effective_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('employee_appraisals').select('*').eq('employee_id', employeeId).order('appraisal_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('employee_awards').select('*').eq('employee_id', employeeId).order('awarded_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('employee_conduct_records').select('*').eq('employee_id', employeeId).order('record_date', { ascending: false }).order('created_at', { ascending: false }),
    ]).then(([h, a, w, c]) => {
      if (!live) return;
      setData({ history: list<EmployeeHistoryEntry>(h), appraisals: list<Appraisal>(a), awards: list<Award>(w), conduct: list<ConductRecord>(c) });
    });
    return () => {
      live = false;
    };
  }, [employeeId]);

  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : '—');

  if (!data) return <Text style={styles.loading}>Loading…</Text>;

  const average = data.appraisals ? averageRating(data.appraisals) : null;
  const latest = data.appraisals?.[0];
  const openConduct = data.conduct?.filter(r => r.status !== 'closed').length ?? 0;

  const historySummary = data.history === null ? 'Not available' : data.history.length === 0 ? 'Nothing recorded yet' : `${data.history.length} entr${data.history.length === 1 ? 'y' : 'ies'}`;
  const performanceSummary =
    data.appraisals === null || data.awards === null
      ? 'Not available'
      : average !== null
        ? `Average ${average} / 5 · ${data.awards.length} award${data.awards.length === 1 ? '' : 's'}`
        : `${data.awards.length} award${data.awards.length === 1 ? '' : 's'}`;
  const conductSummary = data.conduct === null ? 'Not available' : data.conduct.length === 0 ? 'Nothing on file' : openConduct > 0 ? `${openConduct} still open` : `${data.conduct.length} on file`;

  return (
    <>
      <CollapsibleCard title="Transfers, promotions & increments" summary={historySummary}>
        <Text style={styles.intro}>Recorded automatically when your branch, designation, department, reporting-to or pay is edited. Kept by HR — read only.</Text>
        {data.history === null ? (
          <Notice tone="warning">{UNAVAILABLE}</Notice>
        ) : (
          <>
            {data.history.length === 0 && <Text style={styles.empty}>Nothing recorded yet. A transfer, promotion or pay change will appear here.</Text>}
            {data.history.map(entry => (
              <View key={entry.id} style={styles.entry}>
                <View style={styles.entryHead}>
                  <Text style={styles.entryDate}>{date(entry.effective_date)}</Text>
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
                <Text style={styles.footText}>
                  {entry.source === 'manual' ? 'Added by HR' : 'Recorded automatically'} · {date(localDateKey(entry.created_at))}
                </Text>
              </View>
            ))}
            {!!joinedOn && (
              <View style={styles.joined}>
                <Text style={styles.entryDate}>{date(joinedOn)}</Text>
                <Text style={styles.footText}> Joined</Text>
              </View>
            )}
          </>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Performance & recognition" summary={performanceSummary}>
        <Text style={styles.intro}>Appraisals and awards, entered by HR — read only.</Text>
        {data.appraisals === null || data.awards === null ? (
          <Notice tone="warning">{UNAVAILABLE}</Notice>
        ) : (
          <>
            <SubHeading title="Appraisals" />
            {average !== null && latest && (
              <Text style={styles.muted}>
                Average <Text style={styles.bold}>{average} / 5</Text> over {data.appraisals.length} appraisal{data.appraisals.length === 1 ? '' : 's'} · latest{' '}
                <Text style={styles.bold}>{latest.rating}</Text> on {date(latest.appraisal_date)}
              </Text>
            )}
            {data.appraisals.length === 0 && <Text style={styles.empty}>No appraisals recorded yet.</Text>}
            {data.appraisals.map(a => (
              <View key={a.id} style={styles.item}>
                <View style={styles.head}>
                  <Text style={styles.date}>{date(a.appraisal_date)}</Text>
                  <Badge tone="neutral">{periodLabel(a.period_type)}</Badge>
                </View>
                <Text style={styles.rating}>
                  <Text style={styles.stars}>{starString(Number(a.rating))}</Text> <Text style={styles.bold}>{a.rating} / 5</Text>
                  <Text style={styles.muted}> · {ratingLabel(Number(a.rating))}</Text>
                </Text>
                {(!!a.period_start || !!a.period_end) && (
                  <Text style={styles.muted}>
                    Period: {date(a.period_start)} – {date(a.period_end)}
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
              </View>
            ))}

            <SubHeading title="Awards & recognition" />
            {data.awards.length === 0 && <Text style={styles.empty}>No awards recorded yet.</Text>}
            {data.awards.map(w => (
              <View key={w.id} style={styles.item}>
                <View style={styles.head}>
                  <Text style={styles.date}>{w.title}</Text>
                  <Text style={styles.muted}>{date(w.awarded_on)}</Text>
                </View>
                {!!w.description && <Text style={styles.body}>{w.description}</Text>}
              </View>
            ))}
          </>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Conduct records" summary={conductSummary}>
        <Text style={styles.intro}>Warnings, disciplinary actions and grievances, with the final decision. Entered by HR — read only.</Text>
        {data.conduct === null ? (
          <Notice tone="warning">{UNAVAILABLE}</Notice>
        ) : data.conduct.length === 0 ? (
          <Text style={styles.empty}>Nothing on file.</Text>
        ) : (
          data.conduct.map(r => (
            <View key={r.id} style={styles.item}>
              <View style={styles.head}>
                <Text style={styles.date}>{date(r.record_date)}</Text>
                <Badge tone={KIND_TONE[r.kind]}>{r.kind === 'warning' ? warningLevelLabel(r.warning_level as WarningLevel | null) : CONDUCT_KINDS.find(k => k.value === r.kind)!.label}</Badge>
                <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge>
              </View>
              <Text style={[styles.body, { fontWeight: '700' }]}>{r.title}</Text>
              {!!r.details && <Text style={styles.body}>{r.details}</Text>}
              {!!r.final_decision && (
                <Text style={styles.decision}>
                  <Text style={styles.label}>
                    Final decision{r.decided_on ? ` · ${date(r.decided_on)}` : ''}:{' '}
                  </Text>
                  {r.final_decision}
                </Text>
              )}
            </View>
          ))
        )}
      </CollapsibleCard>
    </>
  );
}

function ChangeLine({ label, money, change }: { label: string; money?: boolean; change: HistoryChange }) {
  const show = (v: string | number | null) => (money ? formatMoney(v) : v === null || v === '' ? '(none)' : String(v));
  const pct = money ? percentChange(change) : null;
  const hadBefore = change.from !== null && change.from !== '';
  return (
    <Text style={styles.line}>
      <Text style={styles.lineLabel}>{label}: </Text>
      {hadBefore && <Text style={styles.lineLabel}>{show(change.from)} → </Text>}
      <Text style={styles.lineTo}>{show(change.to)}</Text>
      {!!pct && <Text style={[styles.pct, { color: pct.startsWith('+') ? colors.goodText : colors.criticalText }]}> ({pct})</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  loading: { fontSize: 13, color: colors.slate500, textAlign: 'center', padding: 16 },
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  empty: { fontSize: 12, color: colors.slate400, marginTop: 6 },
  entry: { borderLeftWidth: 2, borderLeftColor: colors.slate200, paddingLeft: 12, marginTop: 12 },
  entryHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  entryDate: { fontSize: 13, fontWeight: '800', color: colors.ink },
  line: { fontSize: 13, marginTop: 4, color: colors.ink },
  lineLabel: { color: colors.slate500 },
  lineTo: { fontWeight: '700', color: colors.ink },
  pct: { fontSize: 11, fontWeight: '700' },
  note: { fontSize: 12, color: colors.slate500, marginTop: 5, lineHeight: 17 },
  noteLabel: { fontWeight: '700' },
  footText: { fontSize: 11, color: colors.slate400, marginTop: 6 },
  joined: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14, paddingLeft: 12 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  date: { fontSize: 13, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  rating: { fontSize: 13, marginTop: 4, color: colors.ink },
  stars: { color: colors.warning, letterSpacing: 1 },
  bold: { fontWeight: '700', color: colors.ink },
  muted: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  body: { fontSize: 13, color: colors.ink, marginTop: 5, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  decision: { fontSize: 13, color: colors.ink, marginTop: 8, lineHeight: 18, backgroundColor: colors.slate50, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
