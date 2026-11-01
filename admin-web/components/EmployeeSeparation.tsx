'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DatePicker from './DatePicker';
import { useConfirm } from './ConfirmDialog';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { fetchCompanyName } from '@/lib/payrollFormat';
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
} from '@/lib/employeeSeparation';
import type { Employee } from '@/lib/types';

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
type MoneyField = (typeof MONEY_FIELDS)[number];

const INPUT_CLASS = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
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
  if (numbers.some(v => v.trim() !== '' && (Number.isNaN(Number(v)) || Number(v) < 0))) {
    return 'Amounts and notice days must be numbers, zero or more.';
  }
  if ([f.notice_required_days, f.notice_served_days].some(v => v.trim() !== '' && !Number.isInteger(Number(v)))) {
    return 'Notice days must be whole days.';
  }
  return null;
}

/** The exit checklist and final settlement for someone leaving — one record per
 * employee, started while they work out their notice or once they are marked as
 * having left. Admin / HR only: it holds what the person is owed. */
export default function EmployeeSeparation({ employee, onEmployeeChanged }: { employee: Employee; onEmployeeChanged: () => void }) {
  const confirm = useConfirm();
  const { system } = useCalendarSystem();
  const [sep, setSep] = useState<EmployeeSeparation | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

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
    if (error) {
      setMessage({ kind: 'error', text: `Could not start: ${error.message}` });
      return;
    }
    setSep(data as EmployeeSeparation);
    setForm(toForm(data as EmployeeSeparation, employee));
  }

  async function handleSave() {
    if (!sep || !form) return;
    const problem = problemWith(form);
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.from('employee_separations').update(toPayload(form)).eq('id', sep.id).select().single();
    if (error) {
      setBusy(false);
      setMessage({ kind: 'error', text: `Could not save: ${error.message}` });
      return;
    }
    // Someone who has already left keeps their last working date and
    // Resigned / Terminated label on the employee record too.
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
          setMessage({ kind: 'error', text: `Saved here, but the employee record could not be updated: ${employeeError.message}` });
          return;
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
    if (
      !(await confirm(
        `Cancel the separation process for ${employee.name}? The checklist and settlement figures are deleted. This does not change whether they are still employed.`,
        { title: 'Cancel separation?', confirmLabel: 'Delete it', tone: 'danger' }
      ))
    )
      return;
    setBusy(true);
    const { error } = await supabase.from('employee_separations').delete().eq('id', sep.id);
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: `Could not cancel: ${error.message}` });
      return;
    }
    setSep(null);
    setForm(null);
    setMessage(null);
  }

  async function downloadStatement() {
    if (!sep) return;
    setGeneratingPdf(true);
    try {
      const [{ jsPDF }, company] = await Promise.all([import('jspdf'), fetchCompanyName()]);
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const left = 18;
      const right = doc.internal.pageSize.getWidth() - 18;
      const bottom = doc.internal.pageSize.getHeight() - 18;
      let y = 20;
      const date = (key: string | null) => (key ? formatAdDate(key, system) : '—');
      const ensure = (h: number) => {
        if (y + h > bottom) {
          doc.addPage();
          y = 20;
        }
      };
      const heading = (title: string) => {
        ensure(12);
        y += 3;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(title, left, y);
        y += 1.5;
        doc.setDrawColor(200);
        doc.line(left, y, right, y);
        y += 5.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
      };
      const pair = (label: string, value: string, bold = false) => {
        ensure(6);
        doc.setFont('helvetica', 'normal');
        doc.text(label, left, y);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.text(value, right, y, { align: 'right' });
        y += 6;
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Final Settlement Statement', left, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text([company, `Prepared ${formatAdDate(todayKey(), system)}`].filter(Boolean).join('   ·   '), left, y);
      doc.setTextColor(0);
      y += 4;

      heading('Employee');
      pair('Name', employee.name);
      pair('Employee code', employee.employee_code);
      pair('Designation / department', [employee.designation, employee.department].filter(Boolean).join(' · ') || '—');
      pair('Date of joining', date(employee.date_of_joining));

      heading('Separation');
      pair('Type', SEPARATION_TYPES.find(t => t.value === sep.separation_type)?.label ?? sep.separation_type);
      pair('Resignation submitted', date(sep.resignation_submitted_on));
      pair('Resignation effective', date(sep.resignation_effective_on));
      pair('Last working date', date(sep.last_working_on ?? employee.resigned_at));
      pair('Notice required / served', `${sep.notice_required_days ?? '—'} / ${sep.notice_served_days ?? '—'} days`);
      const short = noticeShortfall(sep.notice_required_days, sep.notice_served_days);
      if (short) pair('Notice shortfall', `${short} day${short === 1 ? '' : 's'}`);
      if (sep.separation_reason) {
        ensure(6);
        doc.text('Reason', left, y);
        y += 5.5;
        const wrapped = doc.splitTextToSize(sep.separation_reason, right - left);
        ensure(wrapped.length * 5);
        doc.text(wrapped, left, y);
        y += wrapped.length * 5 + 1;
      }

      const totals = settlementTotals(sep);
      heading('Payments to the employee');
      pair('Final salary', formatAmount(sep.final_salary));
      pair('Leave encashment', formatAmount(sep.leave_encashment));
      pair('Incentive settlement', formatAmount(sep.incentive_settlement));
      pair('Other payments', formatAmount(sep.other_payments));
      pair('Total payments', formatAmount(totals.payments), true);

      heading('Deductions');
      pair('Outstanding advances / loans', formatAmount(sep.outstanding_advances));
      pair('Other deductions', formatAmount(sep.other_deductions));
      pair('Total deductions', formatAmount(totals.deductions), true);
      if (sep.other_dues_note) {
        const wrapped = doc.splitTextToSize(`Note: ${sep.other_dues_note}`, right - left);
        ensure(wrapped.length * 5);
        doc.text(wrapped, left, y);
        y += wrapped.length * 5 + 1;
      }

      y += 2;
      ensure(10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(totals.net < 0 ? 'Payable BY the employee' : 'Net payable', left, y);
      doc.text(formatAmount(Math.abs(totals.net)), right, y, { align: 'right' });
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      pair('Settlement status', `${SETTLEMENT_LABEL[sep.settlement_status]}${sep.settlement_on ? ' · ' + date(sep.settlement_on) : ''}`);

      heading('Exit checklist');
      for (const item of checklist(sep)) pair(item.label, item.done ? 'Done' : 'Pending');

      ensure(40);
      y += 18;
      const line = (x1: number, x2: number, label: string) => {
        doc.setDrawColor(120);
        doc.line(x1, y, x2, y);
        doc.setFontSize(9);
        doc.text(label, x1, y + 5);
      };
      const w = (right - left - 12) / 3;
      line(left, left + w, 'Prepared by');
      line(left + w + 6, left + 2 * w + 6, 'Employee');
      line(left + 2 * w + 12, right, 'Approved by');

      doc.save(`${employee.name.replace(/\s+/g, '_')}_final_settlement.pdf`);
    } finally {
      setGeneratingPdf(false);
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

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="employee-separation-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="employee-separation-heading" className="text-sm font-semibold text-ink">
            Separation &amp; final settlement
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            The exit checklist and what the employee is owed. Only admins and HR of your company can see this.
          </p>
        </div>
        {sep && form && (
          <span className="text-xs font-semibold text-slate-600">
            {doneCount} of {items.length} checklist items done · Settlement {SETTLEMENT_LABEL[sep.settlement_status].toLowerCase()}
          </span>
        )}
      </div>

      {status === 'unavailable' && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-text" role="alert">
          This can&apos;t be loaded yet. If this is the first time, run the latest database migration
          (20261101180000_employee_separations.sql) in Supabase. <span className="opacity-70">({loadError})</span>
        </div>
      )}

      {status === 'ready' && !sep && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-3">
          <p className="min-w-0 flex-1 text-sm text-slate-600">
            {hasLeft
              ? `${employee.name} has left, but no exit checklist was started.`
              : 'No separation in progress. Start one when a resignation is handed in, or when someone is let go.'}
          </p>
          <button
            type="button"
            onClick={handleStart}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? 'Starting…' : hasLeft ? 'Start checklist' : 'Start separation'}
          </button>
        </div>
      )}

      {status === 'ready' && sep && form && (
        <div className="mt-4 space-y-6">
          {/* ---- the separation itself ---- */}
          <Block title="Separation">
            <SelectField label="Type" value={form.separation_type} onChange={v => change({ separation_type: v as SeparationType })}>
              {SEPARATION_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </SelectField>
            <DateField label="Resignation submitted on" value={form.resignation_submitted_on} onChange={v => change({ resignation_submitted_on: v })} />
            <DateField label="Resignation effective on" value={form.resignation_effective_on} onChange={v => change({ resignation_effective_on: v })} />
            <DateField label="Last working date" value={form.last_working_on} onChange={v => change({ last_working_on: v })} />
            <div className="sm:col-span-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Reason for leaving</span>
                <textarea
                  value={form.separation_reason}
                  onChange={e => change({ separation_reason: e.target.value })}
                  rows={2}
                  className={INPUT_CLASS}
                />
              </label>
            </div>
          </Block>

          <Block title="Notice period">
            <NumberField label="Required notice (days)" value={form.notice_required_days} onChange={v => change({ notice_required_days: v })} step="1" />
            <div>
              <NumberField label="Served (days)" value={form.notice_served_days} onChange={v => change({ notice_served_days: v })} step="1" />
              {calculatedServed !== null && String(calculatedServed) !== form.notice_served_days && (
                <p className="mt-1 text-xs text-slate-500">
                  {calculatedServed} days from submission to the last working date.{' '}
                  <button type="button" onClick={() => change({ notice_served_days: String(calculatedServed) })} className="font-medium text-accent hover:underline">
                    Use this
                  </button>
                </p>
              )}
            </div>
            {shortfall !== null && shortfall > 0 && (
              <p className="self-center text-sm font-semibold text-warning-text sm:col-span-2" role="status">
                Left {shortfall} day{shortfall === 1 ? '' : 's'} short of the required notice — consider a deduction below.
              </p>
            )}
          </Block>

          {/* ---- the checklist ---- */}
          <Block title="Exit checklist" cols={1}>
            <ChecklistRow label="Exit interview" done={items[0].done}>
              <StatusSelect
                label="Exit interview"
                value={form.exit_interview_status}
                onChange={v => change({ exit_interview_status: v as Form['exit_interview_status'] })}
                options={[['pending', 'Pending'], ['completed', 'Completed']]}
              />
              {form.exit_interview_status === 'completed' && <InlineDate value={form.exit_interview_on} onChange={v => change({ exit_interview_on: v })} />}
            </ChecklistRow>
            <ChecklistRow label="Department clearance" done={items[1].done}>
              <StatusSelect
                label="Department clearance"
                value={form.clearance_status}
                onChange={v => change({ clearance_status: v as ClearanceStatus })}
                options={[['pending', 'Pending'], ['in_progress', 'In progress'], ['cleared', 'Cleared']]}
              />
              <input
                aria-label="Clearance note"
                value={form.clearance_note}
                onChange={e => change({ clearance_note: e.target.value })}
                placeholder="Who has / hasn't signed off"
                className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
            </ChecklistRow>
            <ChecklistRow label="Uniform / ID card" done={items[2].done}>
              <ReturnSelect label="Uniform / ID card" value={form.uniform_id_status} onChange={v => change({ uniform_id_status: v })} />
            </ChecklistRow>
            <ChecklistRow label="Company assets — keys" done={items[3].done}>
              <ReturnSelect label="Keys" value={form.asset_keys_status} onChange={v => change({ asset_keys_status: v })} />
            </ChecklistRow>
            <ChecklistRow label="Company assets — equipment" done={items[4].done}>
              <ReturnSelect label="Equipment" value={form.asset_equipment_status} onChange={v => change({ asset_equipment_status: v })} />
            </ChecklistRow>
            <ChecklistRow label="Company assets — device" done={items[5].done}>
              <ReturnSelect label="Device" value={form.asset_device_status} onChange={v => change({ asset_device_status: v })} />
            </ChecklistRow>
            <ChecklistRow label="Company assets — other" done={items[6].done}>
              <ReturnSelect label="Other assets" value={form.asset_other_status} onChange={v => change({ asset_other_status: v })} />
              <input
                aria-label="Other assets note"
                value={form.asset_other_note}
                onChange={e => change({ asset_other_note: e.target.value })}
                placeholder="What are they?"
                className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
            </ChecklistRow>
            <ChecklistRow label="Experience letter" done={items[7].done}>
              <StatusSelect
                label="Experience letter"
                value={form.experience_letter_status}
                onChange={v => change({ experience_letter_status: v as Form['experience_letter_status'] })}
                options={[['pending', 'Pending'], ['issued', 'Issued']]}
              />
              {form.experience_letter_status === 'issued' && <InlineDate value={form.experience_letter_on} onChange={v => change({ experience_letter_on: v })} />}
            </ChecklistRow>
            <p className="pt-1 text-xs text-slate-400">Upload the letter itself under Documents above.</p>
          </Block>

          {/* ---- the money ---- */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Final settlement</h3>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-good-text">Payments to the employee</p>
                <MoneyInput label="Final salary" field="final_salary" form={form} change={change} />
                <MoneyInput label="Leave encashment" field="leave_encashment" form={form} change={change} />
                <MoneyInput label="Incentive settlement" field="incentive_settlement" form={form} change={change} />
                <MoneyInput label="Other payments" field="other_payments" form={form} change={change} />
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold text-critical-text">Deductions</p>
                <MoneyInput label="Outstanding advances / loans" field="outstanding_advances" form={form} change={change} />
                <MoneyInput label="Other deductions" field="other_deductions" form={form} change={change} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Note on other payments and deductions</span>
                  <textarea
                    value={form.other_dues_note}
                    onChange={e => change({ other_dues_note: e.target.value })}
                    rows={2}
                    placeholder="e.g. notice pay recovered, uniform charge, referral bonus"
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
              {totals ? (
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Total payments</dt>
                    <dd className="font-semibold text-ink">{formatAmount(totals.payments)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Total deductions</dt>
                    <dd className="font-semibold text-ink">{formatAmount(totals.deductions)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{totals.net < 0 ? 'Payable by the employee' : 'Net payable'}</dt>
                    <dd className={`text-base font-extrabold ${totals.net < 0 ? 'text-critical-text' : 'text-good-text'}`}>
                      {formatAmount(Math.abs(totals.net))}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-critical">Fix the amounts above to see the total.</p>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Settlement status"
                value={form.settlement_status}
                onChange={v => change({ settlement_status: v as SettlementStatus })}
              >
                <option value="pending">Pending</option>
                <option value="processed">Processed</option>
                <option value="completed">Completed</option>
              </SelectField>
              {settling && <DateField label={form.settlement_status === 'completed' ? 'Paid on' : 'Processed on'} value={form.settlement_on} onChange={v => change({ settlement_on: v })} />}
            </div>
            {settling && openItems.length > 0 && (
              <p className="mt-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-text" role="status">
                {openItems.length} checklist item{openItems.length === 1 ? ' is' : 's are'} still open: {openItems.map(i => i.label).join(', ')}.
              </p>
            )}
          </div>

          {message && (
            <p className={`text-sm ${message.kind === 'error' ? 'text-critical' : 'text-good-text'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !dirty}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setForm(initial);
                  setMessage(null);
                }}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Discard changes
              </button>
            )}
            <button
              type="button"
              onClick={downloadStatement}
              disabled={generatingPdf || dirty}
              title={dirty ? 'Save your changes first — the statement is made from what is saved' : undefined}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {generatingPdf ? 'Preparing…' : '⬇ Settlement statement (PDF)'}
            </button>
            <button type="button" onClick={handleCancelSeparation} disabled={busy} className="ml-auto text-xs font-medium text-critical hover:underline">
              Cancel separation
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// --- small building blocks ----------------------------------------------------------

function Block({ title, cols = 2, children }: { title: string; cols?: 1 | 2; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className={cols === 2 ? 'grid gap-3 sm:grid-cols-2' : 'divide-y divide-slate-100'}>{children}</div>
    </div>
  );
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLASS}>
        {children}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <DatePicker value={value} onChange={onChange} />
    </div>
  );
}

function NumberField({ label, value, onChange, step = '0.01' }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input type="number" min="0" step={step} inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder="0" className={INPUT_CLASS} />
    </label>
  );
}

function MoneyInput({ label, field, form, change }: { label: string; field: MoneyField; form: Form; change: (p: Partial<Form>) => void }) {
  return <NumberField label={label} value={form[field]} onChange={v => change({ [field]: v } as Partial<Form>)} />;
}

function ChecklistRow({ label, done, children }: { label: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${done ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white'}`}
        role="img"
        aria-label={done ? 'Done' : 'Open'}
      >
        {done && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className="h-2.5 w-2.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
          </svg>
        )}
      </span>
      <span className="min-w-[10rem] text-sm font-medium text-ink">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function StatusSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

function ReturnSelect({ label, value, onChange }: { label: string; value: ReturnStatus; onChange: (v: ReturnStatus) => void }) {
  return (
    <StatusSelect
      label={label}
      value={value}
      onChange={v => onChange(v as ReturnStatus)}
      options={[['pending', 'Pending'], ['returned', 'Returned'], ['not_applicable', 'Not applicable']]}
    />
  );
}

function InlineDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="w-44">
      <DatePicker value={value} onChange={onChange} />
    </div>
  );
}
