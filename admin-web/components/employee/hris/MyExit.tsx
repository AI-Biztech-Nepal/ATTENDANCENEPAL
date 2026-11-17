'use client';

import { useState } from 'react';
import DatePicker from '@/components/DatePicker';
import FormDialog from '@/components/employee/FormDialog';
import { Fact, FactGrid } from '@/components/profile/ProfileParts';
import Badge from '@/components/Badge';
import { useConfirm } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
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
} from '@/lib/employeeSeparation';
import { Card, SubHeading } from './ui';

const returnWord = (s: ReturnStatus) => (s === 'returned' ? 'Returned' : s === 'not_applicable' ? 'Not applicable' : 'Pending');

const INPUT = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

/** Your exit. With nothing started you can hand in a resignation; while HR hasn't begun working
 * on one you handed in you can change or withdraw it; after that — or for an exit HR started —
 * it is HR's record and you see the checklist and settlement read only. `sep` is undefined while
 * loading and null when there is no separation. */
export default function MyExit({ sep, onChanged }: { sep: EmployeeSeparation | null | undefined; onChanged: () => void }) {
  if (sep === undefined) return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;
  if (sep === null || (sep.requested_by_employee && isUntouched(sep))) return <Resignation sep={sep} onChanged={onChanged} />;
  return <ExitDetails sep={sep} />;
}

function Resignation({ sep, onChanged }: { sep: EmployeeSeparation | null; onChanged: () => void }) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
    if (!(await confirm('Withdraw your resignation? HR will no longer see it.', { title: 'Withdraw resignation?', confirmLabel: 'Withdraw', tone: 'danger' }))) return;
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('withdraw_my_resignation');
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    onChanged();
  }

  return (
    <div className="max-w-3xl">
      <Card
        title={sep ? 'Your resignation' : 'Exit'}
        note={
          sep
            ? 'HR has it. You can change or withdraw it until they start working on it — after that, contact HR.'
            : 'Nothing has been started. If you are leaving, you can hand in your resignation here and HR will take it from there.'
        }
      >
        {sep && (
          <FactGrid>
            <Fact label="Handed in on">{date(sep.resignation_submitted_on)}</Fact>
            <Fact label="Last working day">{date(sep.last_working_on)}</Fact>
            <Fact label="Reason" wide>
              {sep.separation_reason}
            </Fact>
          </FactGrid>
        )}
        {error && !open && (
          <p role="alert" className="mt-3 text-xs font-semibold text-critical">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={start} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
            {sep ? 'Change' : 'Hand in resignation'}
          </button>
          {sep && (
            <button type="button" onClick={withdraw} disabled={busy} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-critical hover:bg-slate-50 disabled:opacity-60">
              {busy ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
        </div>
      </Card>

      {open && (
        <FormDialog
          title={sep ? 'Change resignation' : 'Hand in resignation'}
          note="This tells HR you are leaving. HR sets the notice period and the exit checklist."
          onSubmit={save}
          onClose={() => !saving && setOpen(false)}
          saving={saving}
          savingLabel="Saving…"
          submitLabel={sep ? 'Save' : 'Hand in'}
          error={error}
        >
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Handing in on</label>
              <DatePicker value={form.submitted} onChange={v => setForm(f => ({ ...f, submitted: v }))} ariaLabel="Handing in on" />
            </div>
            <div>
              <label className={LABEL}>Last working day</label>
              <DatePicker value={form.last} onChange={v => setForm(f => ({ ...f, last: v }))} ariaLabel="Last working day" />
            </div>
          </div>
          <label htmlFor="res-reason" className={LABEL}>
            Reason (optional)
          </label>
          <textarea
            id="res-reason"
            rows={3}
            value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            className={`${INPUT} h-auto py-2.5`}
          />
        </FormDialog>
      )}
    </div>
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

  const money = (label: string, value: number, strong?: boolean) => (
    <div className={`flex justify-between gap-3 border-t border-slate-100 py-2.5 text-sm ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-slate-600'}>{label}</dt>
      <dd className="m-0 tabular-nums">{formatAmount(value)}</dd>
    </div>
  );

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-5">
      <div className="min-w-0">
        <Card
          title="Separation"
          note={`${doneCount} of ${items.length} checklist items done · Settlement ${SETTLEMENT_LABEL[sep.settlement_status].toLowerCase()}`}
        >
          <FactGrid>
            <Fact label="Type">{SEPARATION_TYPES.find(t => t.value === sep.separation_type)?.label}</Fact>
            <Fact label="Resignation submitted">{date(sep.resignation_submitted_on)}</Fact>
            <Fact label="Effective from">{date(sep.resignation_effective_on)}</Fact>
            <Fact label="Last working day">{date(sep.last_working_on)}</Fact>
            <Fact label="Notice required">{sep.notice_required_days !== null ? `${sep.notice_required_days} days` : null}</Fact>
            <Fact label="Notice served">{sep.notice_served_days !== null ? `${sep.notice_served_days} days` : null}</Fact>
            {sep.separation_reason && (
              <Fact label="Reason" wide>
                {sep.separation_reason}
              </Fact>
            )}
          </FactGrid>
          {shortfall !== null && shortfall > 0 && (
            <p role="status" className="mt-3 text-xs font-semibold text-warning-text">
              {shortfall} day{shortfall === 1 ? '' : 's'} short of the required notice.
            </p>
          )}
        </Card>

        <Card title="Exit checklist">
          <ul className="mt-2 divide-y divide-slate-100">
            {rows.map(r => (
              <li key={r.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{r.label}</div>
                  <div className="text-xs font-medium text-slate-600">{r.detail}</div>
                </div>
                <Badge tone={done(r.key) ? 'good' : 'warning'}>{done(r.key) ? 'Done' : 'Pending'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Final settlement" right={<Badge tone={sep.settlement_status === 'pending' ? 'warning' : 'good'}>{SETTLEMENT_LABEL[sep.settlement_status]}</Badge>}>
        <SubHeading>You are owed</SubHeading>
        <dl>
          {money('Final salary', sep.final_salary)}
          {money('Leave encashment', sep.leave_encashment)}
          {money('Incentive settlement', sep.incentive_settlement)}
          {money('Other payments', sep.other_payments)}
          {money('Total payments', totals.payments, true)}
        </dl>
        <SubHeading>Deductions</SubHeading>
        <dl>
          {money('Outstanding advances', sep.outstanding_advances)}
          {money('Other deductions', sep.other_deductions)}
          {money('Total deductions', totals.deductions, true)}
        </dl>
        <div className="mt-4 rounded-xl bg-good-bg px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-good-text">{totals.net >= 0 ? 'Net payable to you' : 'Net owed to the company'}</span>
            <span className="text-lg font-semibold tabular-nums text-good-text">{formatAmount(Math.abs(totals.net))}</span>
          </div>
          {sep.settlement_on && sep.settlement_status !== 'pending' && (
            <p className="mt-0.5 text-xs font-semibold text-slate-600">
              {sep.settlement_status === 'completed' ? 'Paid' : 'Processed'} on {date(sep.settlement_on)}
            </p>
          )}
        </div>
        {sep.other_dues_note && <p className="mt-3 whitespace-pre-line text-[13px] text-slate-700">{sep.other_dues_note}</p>}
      </Card>
    </div>
  );
}
