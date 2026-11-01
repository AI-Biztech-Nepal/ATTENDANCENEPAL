import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate, localDateKey } from '../../lib/calendar';
import { fetchCompanyName } from '../../lib/payrollFormat';
import {
  SEPARATION_TYPES,
  SETTLEMENT_LABEL,
  checklist,
  formatAmount,
  noticeShortfall,
  servedFromDates,
  settlementTotals,
  type ClearanceStatus,
  type EmployeeSeparation,
  type ReturnStatus,
  type SeparationType,
  type SettlementStatus,
} from '../../lib/employeeSeparation';
import type { Employee } from '../../types';
import { colors } from '../../theme';
import { Button, Choice, CollapsibleCard, DateField, Field, LinkText, Notice, SubHeading, confirmAsync, notify } from './HrKit';

// Everything on the form is a string; toPayload() turns it back into numbers / nulls.
type Form = {
  separation_type: SeparationType;
  resignation_submitted_on: string;
  resignation_effective_on: string;
  last_working_on: string;
  notice_required_days: string;
  notice_served_days: string;
  separation_reason: string;
  exit_interview_status: 'pending' | 'completed';
  exit_interview_on: string;
  clearance_status: ClearanceStatus;
  clearance_note: string;
  uniform_id_status: ReturnStatus;
  asset_keys_status: ReturnStatus;
  asset_equipment_status: ReturnStatus;
  asset_device_status: ReturnStatus;
  asset_other_status: ReturnStatus;
  asset_other_note: string;
  experience_letter_status: 'pending' | 'issued';
  experience_letter_on: string;
  final_salary: string;
  leave_encashment: string;
  incentive_settlement: string;
  other_payments: string;
  outstanding_advances: string;
  other_deductions: string;
  other_dues_note: string;
  settlement_status: SettlementStatus;
  settlement_on: string;
};

const MONEY_FIELDS = ['final_salary', 'leave_encashment', 'incentive_settlement', 'other_payments', 'outstanding_advances', 'other_deductions'] as const;
const RETURN_OPTIONS: { label: string; value: ReturnStatus }[] = [
  { label: 'Pending', value: 'pending' },
  { label: 'Returned', value: 'returned' },
  { label: 'Not applicable', value: 'not_applicable' },
];
const todayKey = () => localDateKey(new Date().toISOString());

function toForm(s: EmployeeSeparation, employee: Employee): Form {
  const money = (n: number) => (n === 0 ? '' : String(n));
  const text = (v: string | null) => v ?? '';
  return {
    separation_type: s.separation_type,
    resignation_submitted_on: text(s.resignation_submitted_on),
    resignation_effective_on: text(s.resignation_effective_on),
    // For someone who has already left, the date on their record is the fallback.
    last_working_on: text(s.last_working_on ?? employee.resigned_at),
    notice_required_days: s.notice_required_days === null ? '' : String(s.notice_required_days),
    notice_served_days: s.notice_served_days === null ? '' : String(s.notice_served_days),
    separation_reason: text(s.separation_reason),
    exit_interview_status: s.exit_interview_status,
    exit_interview_on: text(s.exit_interview_on),
    clearance_status: s.clearance_status,
    clearance_note: text(s.clearance_note),
    uniform_id_status: s.uniform_id_status,
    asset_keys_status: s.asset_keys_status,
    asset_equipment_status: s.asset_equipment_status,
    asset_device_status: s.asset_device_status,
    asset_other_status: s.asset_other_status,
    asset_other_note: text(s.asset_other_note),
    experience_letter_status: s.experience_letter_status,
    experience_letter_on: text(s.experience_letter_on),
    final_salary: money(s.final_salary),
    leave_encashment: money(s.leave_encashment),
    incentive_settlement: money(s.incentive_settlement),
    other_payments: money(s.other_payments),
    outstanding_advances: money(s.outstanding_advances),
    other_deductions: money(s.other_deductions),
    other_dues_note: text(s.other_dues_note),
    settlement_status: s.settlement_status,
    settlement_on: text(s.settlement_on),
  };
}

const amount = (v: string) => (v.trim() === '' ? 0 : Number(v));
const wholeDays = (v: string) => (v.trim() === '' ? null : Number(v));
const orNull = (v: string) => v.trim() || null;

function toPayload(f: Form) {
  return {
    separation_type: f.separation_type,
    resignation_submitted_on: orNull(f.resignation_submitted_on),
    resignation_effective_on: orNull(f.resignation_effective_on),
    last_working_on: orNull(f.last_working_on),
    notice_required_days: wholeDays(f.notice_required_days),
    notice_served_days: wholeDays(f.notice_served_days),
    separation_reason: orNull(f.separation_reason),
    exit_interview_status: f.exit_interview_status,
    exit_interview_on: orNull(f.exit_interview_on),
    clearance_status: f.clearance_status,
    clearance_note: orNull(f.clearance_note),
    uniform_id_status: f.uniform_id_status,
    asset_keys_status: f.asset_keys_status,
    asset_equipment_status: f.asset_equipment_status,
    asset_device_status: f.asset_device_status,
    asset_other_status: f.asset_other_status,
    asset_other_note: orNull(f.asset_other_note),
    experience_letter_status: f.experience_letter_status,
    experience_letter_on: orNull(f.experience_letter_on),
    final_salary: amount(f.final_salary),
    leave_encashment: amount(f.leave_encashment),
    incentive_settlement: amount(f.incentive_settlement),
    other_payments: amount(f.other_payments),
    outstanding_advances: amount(f.outstanding_advances),
    other_deductions: amount(f.other_deductions),
    other_dues_note: orNull(f.other_dues_note),
    settlement_status: f.settlement_status,
    settlement_on: orNull(f.settlement_on),
  };
}

/** A message if the form can't be saved, otherwise null. */
function problemWith(f: Form): string | null {
  if (f.resignation_submitted_on && f.resignation_effective_on && f.resignation_effective_on < f.resignation_submitted_on) {
    return 'The resignation takes effect before the date it was submitted.';
  }
  if (f.resignation_submitted_on && f.last_working_on && f.last_working_on < f.resignation_submitted_on) {
    return 'The last working date is before the date the resignation was submitted.';
  }
  const numbers = [...MONEY_FIELDS.map(k => f[k]), f.notice_required_days, f.notice_served_days];
  if (numbers.some(v => v.trim() !== '' && (Number.isNaN(Number(v)) || Number(v) < 0))) return 'Amounts and notice days must be numbers, zero or more.';
  if ([f.notice_required_days, f.notice_served_days].some(v => v.trim() !== '' && !Number.isInteger(Number(v)))) return 'Notice days must be whole days.';
  return null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The exit checklist and final settlement for someone leaving — one record per employee,
 * started while they work out their notice or once they are marked as having left.
 * Owner / HR only: it holds what the person is owed. */
export default function SeparationCard({ employee, onEmployeeChanged }: { employee: Employee; onEmployeeChanged: () => void }) {
  const { system } = useCalendarSystem();
  const [sep, setSep] = useState<EmployeeSeparation | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [makingPdf, setMakingPdf] = useState(false);

  const hasLeft = employee.status === 'inactive';

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('employee_separations').select('*').eq('employee_id', employee.id).maybeSingle();
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setSep((data as EmployeeSeparation | null) ?? null);
    setForm(data ? toForm(data as EmployeeSeparation, employee) : null);
    setStatus('ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  useEffect(() => {
    load();
  }, [load]);

  const initial = useMemo(() => (sep ? toForm(sep, employee) : null), [sep, employee]);
  const dirty = !!form && !!initial && JSON.stringify(form) !== JSON.stringify(initial);

  /** Update fields, filling in today's date for a step that has just been ticked off. */
  function change(patch: Partial<Form>) {
    setMessage(null);
    setForm(f => {
      if (!f) return f;
      const next = { ...f, ...patch };
      const today = todayKey();
      if (patch.exit_interview_status === 'completed' && !next.exit_interview_on) next.exit_interview_on = today;
      if (patch.experience_letter_status === 'issued' && !next.experience_letter_on) next.experience_letter_on = today;
      if (patch.settlement_status && patch.settlement_status !== 'pending' && !next.settlement_on) next.settlement_on = today;
      return next;
    });
  }

  async function handleStart() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase
      .from('employee_separations')
      .insert({
        employee_id: employee.id,
        separation_type: employee.employment_status === 'terminated' ? 'termination' : 'resignation',
        last_working_on: employee.resigned_at,
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: `Could not start: ${error.message}` });
    setSep(data as EmployeeSeparation);
    setForm(toForm(data as EmployeeSeparation, employee));
  }

  async function handleSave() {
    if (!sep || !form) return;
    const problem = problemWith(form);
    if (problem) return setMessage({ kind: 'error', text: problem });
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.from('employee_separations').update(toPayload(form)).eq('id', sep.id).select().single();
    if (error) {
      setBusy(false);
      return setMessage({ kind: 'error', text: `Could not save: ${error.message}` });
    }
    // Someone who has already left keeps their last working date and Resigned / Terminated label on the employee record too.
    if (hasLeft) {
      const update: Record<string, string> = {};
      if (form.last_working_on) update.resigned_at = form.last_working_on;
      if ('employment_status' in employee) update.employment_status = form.separation_type === 'termination' ? 'terminated' : 'resigned';
      if (Object.keys(update).length > 0) {
        const { error: employeeError } = await supabase.from('employees').update(update).eq('id', employee.id);
        if (employeeError) {
          setBusy(false);
          setSep(data as EmployeeSeparation);
          setForm(toForm(data as EmployeeSeparation, employee));
          return setMessage({ kind: 'error', text: `Saved here, but the employee record could not be updated: ${employeeError.message}` });
        }
        onEmployeeChanged();
      }
    }
    setBusy(false);
    setSep(data as EmployeeSeparation);
    setForm(toForm(data as EmployeeSeparation, { ...employee, resigned_at: hasLeft && form.last_working_on ? form.last_working_on : employee.resigned_at }));
    setMessage({ kind: 'ok', text: 'Saved.' });
  }

  async function handleCancelSeparation() {
    if (!sep) return;
    const ok = await confirmAsync(
      'Cancel separation?',
      `Cancel the separation process for ${employee.name}? The checklist and settlement figures are deleted. This does not change whether they are still employed.`,
      'Delete it',
      true
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('employee_separations').delete().eq('id', sep.id);
    setBusy(false);
    if (error) return setMessage({ kind: 'error', text: `Could not cancel: ${error.message}` });
    setSep(null);
    setForm(null);
    setMessage(null);
  }

  async function downloadStatement() {
    if (!sep) return;
    setMakingPdf(true);
    try {
      const company = await fetchCompanyName();
      const date = (key: string | null) => (key ? formatAdDate(key, system) : '—');
      const totals = settlementTotals(sep);
      const short = noticeShortfall(sep.notice_required_days, sep.notice_served_days);
      const row = (label: string, value: string, bold = false) => `<tr><td>${esc(label)}</td><td class="r${bold ? ' b' : ''}">${esc(value)}</td></tr>`;
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Helvetica,Arial,sans-serif;color:#0f172a;padding:28px;font-size:13px}
        h1{font-size:22px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
        table{width:100%;border-collapse:collapse} td{padding:3px 0} td.r{text-align:right} .b{font-weight:700}
        .muted{color:#64748b} .net{font-size:16px;font-weight:700;margin-top:10px;display:flex;justify-content:space-between}
        .sign{display:flex;gap:24px;margin-top:60px} .sign div{flex:1;border-top:1px solid #64748b;padding-top:4px;font-size:11px}
      </style></head><body>
        <h1>Final Settlement Statement</h1>
        <div class="muted">${esc([company, `Prepared ${formatAdDate(todayKey(), system)}`].filter(Boolean).join('  ·  '))}</div>
        <h2>Employee</h2><table>
          ${row('Name', employee.name)}${row('Employee code', employee.employee_code)}
          ${row('Designation / department', [employee.designation, employee.department].filter(Boolean).join(' · ') || '—')}
          ${row('Date of joining', date(employee.date_of_joining))}
        </table>
        <h2>Separation</h2><table>
          ${row('Type', SEPARATION_TYPES.find(t => t.value === sep.separation_type)?.label ?? sep.separation_type)}
          ${row('Resignation submitted', date(sep.resignation_submitted_on))}${row('Resignation effective', date(sep.resignation_effective_on))}
          ${row('Last working date', date(sep.last_working_on ?? employee.resigned_at))}
          ${row('Notice required / served', `${sep.notice_required_days ?? '—'} / ${sep.notice_served_days ?? '—'} days`)}
          ${short ? row('Notice shortfall', `${short} day${short === 1 ? '' : 's'}`) : ''}
        </table>${sep.separation_reason ? `<p><span class="muted">Reason: </span>${esc(sep.separation_reason)}</p>` : ''}
        <h2>Payments to the employee</h2><table>
          ${row('Final salary', formatAmount(sep.final_salary))}${row('Leave encashment', formatAmount(sep.leave_encashment))}
          ${row('Incentive settlement', formatAmount(sep.incentive_settlement))}${row('Other payments', formatAmount(sep.other_payments))}
          ${row('Total payments', formatAmount(totals.payments), true)}
        </table>
        <h2>Deductions</h2><table>
          ${row('Outstanding advances / loans', formatAmount(sep.outstanding_advances))}${row('Other deductions', formatAmount(sep.other_deductions))}
          ${row('Total deductions', formatAmount(totals.deductions), true)}
        </table>${sep.other_dues_note ? `<p class="muted">Note: ${esc(sep.other_dues_note)}</p>` : ''}
        <div class="net"><span>${totals.net < 0 ? 'Payable BY the employee' : 'Net payable'}</span><span>${esc(formatAmount(Math.abs(totals.net)))}</span></div>
        <table style="margin-top:6px">${row('Settlement status', `${SETTLEMENT_LABEL[sep.settlement_status]}${sep.settlement_on ? ' · ' + date(sep.settlement_on) : ''}`)}</table>
        <h2>Exit checklist</h2><table>${checklist(sep).map(i => row(i.label, i.done ? 'Done' : 'Pending')).join('')}</table>
        <div class="sign"><div>Prepared by</div><div>Employee</div><div>Approved by</div></div>
      </body></html>`;
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${employee.name} — final settlement` });
        else notify('Statement ready', uri);
      }
    } catch (e) {
      notify('Could not make the statement', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setMakingPdf(false);
    }
  }

  // ---- render ------------------------------------------------------------------
  const items = form ? checklist(form) : [];
  const doneCount = items.filter(i => i.done).length;
  const openItems = items.filter(i => !i.done);
  const draftAmounts = form
    ? {
        final_salary: amount(form.final_salary),
        leave_encashment: amount(form.leave_encashment),
        incentive_settlement: amount(form.incentive_settlement),
        other_payments: amount(form.other_payments),
        outstanding_advances: amount(form.outstanding_advances),
        other_deductions: amount(form.other_deductions),
      }
    : null;
  const totals = draftAmounts && Object.values(draftAmounts).every(n => !Number.isNaN(n)) ? settlementTotals(draftAmounts) : null;
  const calculatedServed = form ? servedFromDates(orNull(form.resignation_submitted_on), orNull(form.last_working_on)) : null;
  const shortfall = form ? noticeShortfall(wholeDays(form.notice_required_days), wholeDays(form.notice_served_days)) : null;
  const settling = !!form && form.settlement_status !== 'pending';
  const summary =
    status === 'ready'
      ? sep
        ? `${doneCount} of ${items.length} checklist items done · Settlement ${SETTLEMENT_LABEL[sep.settlement_status].toLowerCase()}`
        : 'No separation in progress'
      : status === 'unavailable'
        ? 'Not set up yet'
        : 'Loading…';

  return (
    <CollapsibleCard title="Separation & final settlement" summary={summary}>
      <Text style={styles.intro}>The exit checklist and what the employee is owed. Only the owner and HR can see this.</Text>

      {status === 'unavailable' && (
        <Notice tone="warning">
          This can't be loaded yet. If this is the first time, run the latest database migration (20261101180000_employee_separations.sql) in Supabase. ({loadError})
        </Notice>
      )}

      {status === 'ready' && !sep && (
        <View style={styles.start}>
          <Text style={styles.startText}>
            {hasLeft ? `${employee.name} has left, but no exit checklist was started.` : 'No separation in progress. Start one when a resignation is handed in, or when someone is let go.'}
          </Text>
          <Button label={busy ? 'Starting…' : hasLeft ? 'Start checklist' : 'Start separation'} small onPress={handleStart} disabled={busy} />
        </View>
      )}

      {status === 'ready' && sep && form && (
        <>
          <SubHeading title="Separation" />
          <Choice label="Type" options={SEPARATION_TYPES} value={form.separation_type} onChange={v => v && change({ separation_type: v })} />
          <DateField label="Resignation submitted on" value={form.resignation_submitted_on} onChange={v => change({ resignation_submitted_on: v })} />
          <DateField label="Resignation effective on" value={form.resignation_effective_on} onChange={v => change({ resignation_effective_on: v })} />
          <DateField label="Last working date" value={form.last_working_on} onChange={v => change({ last_working_on: v })} />
          <Field label="Reason for leaving" value={form.separation_reason} onChangeText={v => change({ separation_reason: v })} multiline />

          <SubHeading title="Notice period" />
          <Field label="Required notice (days)" value={form.notice_required_days} onChangeText={v => change({ notice_required_days: v })} keyboardType="number-pad" />
          <Field label="Served (days)" value={form.notice_served_days} onChangeText={v => change({ notice_served_days: v })} keyboardType="number-pad" />
          {calculatedServed !== null && String(calculatedServed) !== form.notice_served_days && (
            <View style={styles.useRow}>
              <Text style={styles.hint}>{calculatedServed} days from submission to the last working date.</Text>
              <LinkText label="Use this" onPress={() => change({ notice_served_days: String(calculatedServed) })} />
            </View>
          )}
          {shortfall !== null && shortfall > 0 && <Notice tone="warning">{`Left ${shortfall} day${shortfall === 1 ? '' : 's'} short of the required notice — consider a deduction below.`}</Notice>}

          <SubHeading title="Exit checklist" />
          <ChecklistItem label="Exit interview" done={items[0].done}>
            <Choice accessibilityGroup="Exit interview" options={[{ label: 'Pending', value: 'pending' }, { label: 'Completed', value: 'completed' }]} value={form.exit_interview_status} onChange={v => v && change({ exit_interview_status: v })} />
            {form.exit_interview_status === 'completed' && <DateField label="Interview date" value={form.exit_interview_on} onChange={v => change({ exit_interview_on: v })} />}
          </ChecklistItem>
          <ChecklistItem label="Department clearance" done={items[1].done}>
            <Choice accessibilityGroup="Department clearance" options={[{ label: 'Pending', value: 'pending' }, { label: 'In progress', value: 'in_progress' }, { label: 'Cleared', value: 'cleared' }]} value={form.clearance_status} onChange={v => v && change({ clearance_status: v })} />
            <Field label="Clearance note" value={form.clearance_note} onChangeText={v => change({ clearance_note: v })} placeholder="Who has / hasn't signed off" />
          </ChecklistItem>
          <ChecklistItem label="Uniform / ID card" done={items[2].done}>
            <Choice accessibilityGroup="Uniform / ID card" options={RETURN_OPTIONS} value={form.uniform_id_status} onChange={v => v && change({ uniform_id_status: v })} />
          </ChecklistItem>
          <ChecklistItem label="Company assets — keys" done={items[3].done}>
            <Choice accessibilityGroup="Keys" options={RETURN_OPTIONS} value={form.asset_keys_status} onChange={v => v && change({ asset_keys_status: v })} />
          </ChecklistItem>
          <ChecklistItem label="Company assets — equipment" done={items[4].done}>
            <Choice accessibilityGroup="Equipment" options={RETURN_OPTIONS} value={form.asset_equipment_status} onChange={v => v && change({ asset_equipment_status: v })} />
          </ChecklistItem>
          <ChecklistItem label="Company assets — device" done={items[5].done}>
            <Choice accessibilityGroup="Device" options={RETURN_OPTIONS} value={form.asset_device_status} onChange={v => v && change({ asset_device_status: v })} />
          </ChecklistItem>
          <ChecklistItem label="Company assets — other" done={items[6].done}>
            <Choice accessibilityGroup="Other assets" options={RETURN_OPTIONS} value={form.asset_other_status} onChange={v => v && change({ asset_other_status: v })} />
            <Field label="Other assets note" value={form.asset_other_note} onChangeText={v => change({ asset_other_note: v })} placeholder="What are they?" />
          </ChecklistItem>
          <ChecklistItem label="Experience letter" done={items[7].done}>
            <Choice accessibilityGroup="Experience letter" options={[{ label: 'Pending', value: 'pending' }, { label: 'Issued', value: 'issued' }]} value={form.experience_letter_status} onChange={v => v && change({ experience_letter_status: v })} />
            {form.experience_letter_status === 'issued' && <DateField label="Issued on" value={form.experience_letter_on} onChange={v => change({ experience_letter_on: v })} />}
          </ChecklistItem>
          <Text style={styles.hint}>Upload the letter itself under Documents.</Text>

          <SubHeading title="Final settlement" />
          <Text style={styles.groupGood}>Payments to the employee</Text>
          <Field label="Final salary" value={form.final_salary} onChangeText={v => change({ final_salary: v })} keyboardType="decimal-pad" placeholder="0" />
          <Field label="Leave encashment" value={form.leave_encashment} onChangeText={v => change({ leave_encashment: v })} keyboardType="decimal-pad" placeholder="0" />
          <Field label="Incentive settlement" value={form.incentive_settlement} onChangeText={v => change({ incentive_settlement: v })} keyboardType="decimal-pad" placeholder="0" />
          <Field label="Other payments" value={form.other_payments} onChangeText={v => change({ other_payments: v })} keyboardType="decimal-pad" placeholder="0" />
          <Text style={styles.groupBad}>Deductions</Text>
          <Field label="Outstanding advances / loans" value={form.outstanding_advances} onChangeText={v => change({ outstanding_advances: v })} keyboardType="decimal-pad" placeholder="0" />
          <Field label="Other deductions" value={form.other_deductions} onChangeText={v => change({ other_deductions: v })} keyboardType="decimal-pad" placeholder="0" />
          <Field label="Note on other payments and deductions" value={form.other_dues_note} onChangeText={v => change({ other_dues_note: v })} multiline placeholder="e.g. notice pay recovered, uniform charge, referral bonus" />

          <View style={styles.totals}>
            {totals ? (
              <>
                <TotalCell label="Total payments" value={formatAmount(totals.payments)} />
                <TotalCell label="Total deductions" value={formatAmount(totals.deductions)} />
                <TotalCell label={totals.net < 0 ? 'Payable by the employee' : 'Net payable'} value={formatAmount(Math.abs(totals.net))} strong tone={totals.net < 0 ? 'bad' : 'good'} />
              </>
            ) : (
              <Text style={{ color: colors.criticalText, fontSize: 12 }}>Fix the amounts above to see the total.</Text>
            )}
          </View>

          <Choice label="Settlement status" options={[{ label: 'Pending', value: 'pending' }, { label: 'Processed', value: 'processed' }, { label: 'Completed', value: 'completed' }]} value={form.settlement_status} onChange={v => v && change({ settlement_status: v })} />
          {settling && <DateField label={form.settlement_status === 'completed' ? 'Paid on' : 'Processed on'} value={form.settlement_on} onChange={v => change({ settlement_on: v })} />}
          {settling && openItems.length > 0 && (
            <Notice tone="warning">{`${openItems.length} checklist item${openItems.length === 1 ? ' is' : 's are'} still open: ${openItems.map(i => i.label).join(', ')}.`}</Notice>
          )}

          {message && <Notice tone={message.kind === 'error' ? 'error' : 'ok'}>{message.text}</Notice>}

          <View style={styles.buttons}>
            <Button label={busy ? 'Saving…' : 'Save changes'} onPress={handleSave} disabled={busy || !dirty} />
            {dirty && (
              <Button
                label="Discard changes"
                tone="ghost"
                onPress={() => {
                  setForm(initial);
                  setMessage(null);
                }}
                disabled={busy}
              />
            )}
          </View>
          <View style={styles.buttons}>
            <Button label={makingPdf ? 'Preparing…' : 'Settlement statement (PDF)'} tone="ghost" small onPress={downloadStatement} disabled={makingPdf || dirty} />
            <LinkText label="Cancel separation" tone="critical" onPress={handleCancelSeparation} disabled={busy} />
          </View>
          {dirty && <Text style={styles.hint}>Save your changes first — the statement is made from what is saved.</Text>}
        </>
      )}
    </CollapsibleCard>
  );
}

function ChecklistItem({ label, done, children }: { label: string; done: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.checkItem}>
      <View style={styles.checkHead}>
        <View style={[styles.dot, done && styles.dotOn]} accessibilityLabel={done ? 'Done' : 'Open'}>
          {done && <Text style={styles.tick}>✓</Text>}
        </View>
        <Text style={styles.checkLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function TotalCell({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <View style={styles.totalCell}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, strong && { fontSize: 17, fontWeight: '900' }, tone === 'good' && { color: colors.goodText }, tone === 'bad' && { color: colors.criticalText }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  start: { marginTop: 10, backgroundColor: colors.slate50, borderRadius: 10, padding: 12, gap: 10 },
  startText: { fontSize: 13, color: colors.slate500, lineHeight: 18 },
  useRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  hint: { fontSize: 11, color: colors.slate400, marginTop: 6, flexShrink: 1 },
  checkItem: { marginTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  dot: { height: 18, width: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.slate400, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.white, fontSize: 11, fontWeight: '900' },
  groupGood: { fontSize: 12, fontWeight: '800', color: colors.goodText, marginTop: 10 },
  groupBad: { fontSize: 12, fontWeight: '800', color: colors.criticalText, marginTop: 14 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, backgroundColor: colors.slate50, borderRadius: 10, padding: 12, marginTop: 14 },
  totalCell: { flexGrow: 1, minWidth: 90 },
  totalLabel: { fontSize: 11, color: colors.slate500 },
  totalValue: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 2 },
  buttons: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
});
