import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate, localDateKey } from '../../lib/calendar';
import {
  SEPARATION_TYPES,
  SETTLEMENT_LABEL,
  checklist,
  formatAmount,
  isUntouched,
  noticeShortfall,
  settlementTotals,
  type EmployeeSeparation,
  type ReturnStatus,
} from '../../lib/employeeSeparation';
import { colors } from '../../theme';
import Badge from '../Badge';
import { Button, CollapsibleCard, DateField, Field, InfoRow, Notice, Sheet, SubHeading, confirmAsync } from '../hr/HrKit';

const returnWord = (s: ReturnStatus) => (s === 'returned' ? 'Returned' : s === 'not_applicable' ? 'Not applicable' : 'Pending');

/** Your exit. With nothing started you can hand in a resignation; while HR hasn't begun working on
 * one you handed in you can change or withdraw it; after that — or for an exit HR started — it is HR's
 * record and you see the checklist and settlement read only. `sep` is undefined while loading and null
 * when there is no separation. */
export default function MyExitCard({ sep, onChanged }: { sep: EmployeeSeparation | null | undefined; onChanged: () => void }) {
  if (sep === undefined) return <Text style={styles.loading}>Loading…</Text>;
  if (sep === null || (sep.requested_by_employee && isUntouched(sep))) return <Resignation sep={sep} onChanged={onChanged} />;
  return <ExitDetails sep={sep} />;
}

function Resignation({ sep, onChanged }: { sep: EmployeeSeparation | null; onChanged: () => void }) {
  const { system } = useCalendarSystem();
  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ submitted: '', last: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function start() {
    setForm({ submitted: sep?.resignation_submitted_on ?? localDateKey(new Date().toISOString()), last: sep?.last_working_on ?? '', reason: sep?.separation_reason ?? '' });
    setError('');
    setOpen(true);
  }

  async function save() {
    if (!form.submitted || !form.last) return setError('Pick the day you are handing it in and your last working day.');
    if (form.last < form.submitted) return setError('Your last working day cannot be before the day you hand it in.');
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('submit_my_resignation', {
      p_submitted_on: form.submitted,
      p_last_working_on: form.last,
      p_reason: form.reason,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    setOpen(false);
    onChanged();
  }

  async function withdraw() {
    if (!(await confirmAsync('Withdraw resignation?', 'HR will no longer see your resignation.', 'Withdraw', true))) return;
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('withdraw_my_resignation');
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    onChanged();
  }

  return (
    <>
      <CollapsibleCard
        title={sep ? 'Your resignation' : 'Exit'}
        summary={sep ? `Last working day ${date(sep.last_working_on) ?? '—'}` : 'Nothing started'}
        defaultOpen
      >
        <Text style={styles.intro}>
          {sep
            ? 'HR has it. You can change or withdraw it until they start working on it — after that, contact HR.'
            : 'Nothing has been started. If you are leaving, you can hand in your resignation here and HR will take it from there.'}
        </Text>
        {sep && (
          <View style={{ marginTop: 6 }}>
            <InfoRow label="Handed in on" value={date(sep.resignation_submitted_on)} />
            <InfoRow label="Last working day" value={date(sep.last_working_on)} />
            <InfoRow label="Reason" value={sep.separation_reason} />
          </View>
        )}
        {!!error && !open && <Notice tone="error">{error}</Notice>}
        <View style={styles.buttons}>
          <Button label={sep ? 'Change' : 'Hand in resignation'} onPress={start} disabled={busy} />
          {sep && <Button label={busy ? 'Withdrawing…' : 'Withdraw'} tone="danger" onPress={withdraw} disabled={busy} />}
        </View>
      </CollapsibleCard>

      <Sheet
        visible={open}
        title={sep ? 'Change resignation' : 'Hand in resignation'}
        subtitle="This tells HR you are leaving. HR sets the notice period and the exit checklist."
        onClose={() => !saving && setOpen(false)}
        onSubmit={save}
        saving={saving}
        submitLabel={sep ? 'Save' : 'Hand in'}
        error={error}
      >
        <DateField label="Handing in on" value={form.submitted} onChange={v => setForm(f => ({ ...f, submitted: v }))} />
        <DateField label="Last working day" value={form.last} onChange={v => setForm(f => ({ ...f, last: v }))} />
        <Field label="Reason (optional)" value={form.reason} onChangeText={v => setForm(f => ({ ...f, reason: v }))} multiline />
      </Sheet>
    </>
  );
}

/** HR's record of the exit — the checklist HR works through and what you are owed, read only. */
function ExitDetails({ sep }: { sep: EmployeeSeparation }) {
  const { system } = useCalendarSystem();
  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : null);
  const items = checklist(sep);
  const done = (key: string) => items.find(i => i.key === key)!.done;
  const shortfall = noticeShortfall(sep.notice_required_days, sep.notice_served_days);
  const totals = settlementTotals(sep);
  const doneCount = items.filter(i => i.done).length;

  const rows: { key: string; label: string; detail: string }[] = [
    { key: 'exit', label: 'Exit interview', detail: sep.exit_interview_status === 'completed' ? ['Completed', date(sep.exit_interview_on)].filter(Boolean).join(' · ') : 'Pending' },
    {
      key: 'clearance',
      label: 'Department clearance',
      detail: [sep.clearance_status === 'cleared' ? 'Cleared' : sep.clearance_status === 'in_progress' ? 'In progress' : 'Pending', sep.clearance_note].filter(Boolean).join(' · '),
    },
    { key: 'uniform', label: 'Uniform / ID card', detail: returnWord(sep.uniform_id_status) },
    { key: 'keys', label: 'Company assets — keys', detail: returnWord(sep.asset_keys_status) },
    { key: 'equipment', label: 'Company assets — equipment', detail: returnWord(sep.asset_equipment_status) },
    { key: 'device', label: 'Company assets — device', detail: returnWord(sep.asset_device_status) },
    { key: 'other', label: 'Company assets — other', detail: [returnWord(sep.asset_other_status), sep.asset_other_note].filter(Boolean).join(' · ') },
    { key: 'letter', label: 'Experience letter', detail: sep.experience_letter_status === 'issued' ? ['Issued', date(sep.experience_letter_on)].filter(Boolean).join(' · ') : 'Pending' },
  ];

  return (
    <>
      <CollapsibleCard title="Separation" summary={`${doneCount} of ${items.length} checklist items done · Settlement ${SETTLEMENT_LABEL[sep.settlement_status].toLowerCase()}`} defaultOpen>
        <InfoRow label="Type" value={SEPARATION_TYPES.find(t => t.value === sep.separation_type)?.label} />
        <InfoRow label="Resignation submitted" value={date(sep.resignation_submitted_on)} />
        <InfoRow label="Effective from" value={date(sep.resignation_effective_on)} />
        <InfoRow label="Last working day" value={date(sep.last_working_on)} />
        <InfoRow label="Notice required" value={sep.notice_required_days !== null ? `${sep.notice_required_days} days` : null} />
        <InfoRow label="Notice served" value={sep.notice_served_days !== null ? `${sep.notice_served_days} days` : null} />
        {!!sep.separation_reason && <InfoRow label="Reason" value={sep.separation_reason} />}
        {shortfall !== null && shortfall > 0 && (
          <Notice tone="warning">
            {shortfall} day{shortfall === 1 ? '' : 's'} short of the required notice.
          </Notice>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Exit checklist" summary={`${doneCount} of ${items.length} done`}>
        {rows.map(r => (
          <View key={r.key} style={styles.checkRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkLabel}>{r.label}</Text>
              <Text style={styles.checkDetail}>{r.detail}</Text>
            </View>
            <Badge tone={done(r.key) ? 'good' : 'warning'}>{done(r.key) ? 'Done' : 'Pending'}</Badge>
          </View>
        ))}
      </CollapsibleCard>

      <CollapsibleCard title="Final settlement" summary={SETTLEMENT_LABEL[sep.settlement_status]} defaultOpen>
        <SubHeading title="You are owed" />
        <Money label="Final salary" value={sep.final_salary} />
        <Money label="Leave encashment" value={sep.leave_encashment} />
        <Money label="Incentive settlement" value={sep.incentive_settlement} />
        <Money label="Other payments" value={sep.other_payments} />
        <Money label="Total payments" value={totals.payments} strong />
        <SubHeading title="Deductions" />
        <Money label="Outstanding advances" value={sep.outstanding_advances} />
        <Money label="Other deductions" value={sep.other_deductions} />
        <Money label="Total deductions" value={totals.deductions} strong />
        <View style={styles.net}>
          <Text style={styles.netLabel}>{totals.net >= 0 ? 'Net payable to you' : 'Net owed to the company'}</Text>
          <Text style={styles.netValue}>{formatAmount(Math.abs(totals.net))}</Text>
        </View>
        {!!sep.settlement_on && sep.settlement_status !== 'pending' && (
          <Text style={styles.paidOn}>
            {sep.settlement_status === 'completed' ? 'Paid' : 'Processed'} on {date(sep.settlement_on)}
          </Text>
        )}
        {!!sep.other_dues_note && <Text style={styles.note}>{sep.other_dues_note}</Text>}
      </CollapsibleCard>
    </>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.money}>
      <Text style={[styles.moneyLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.moneyValue, strong && styles.strong]}>{formatAmount(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { fontSize: 13, color: colors.slate500, textAlign: 'center', padding: 16 },
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  checkLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  checkDetail: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  money: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  moneyLabel: { fontSize: 13, color: colors.slate500 },
  moneyValue: { fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '800', color: colors.ink },
  net: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, backgroundColor: colors.goodBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginTop: 14 },
  netLabel: { fontSize: 13, fontWeight: '700', color: colors.goodText, flexShrink: 1 },
  netValue: { fontSize: 18, fontWeight: '800', color: colors.goodText },
  paidOn: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginTop: 6 },
  note: { fontSize: 13, color: colors.ink, marginTop: 10, lineHeight: 18 },
});
