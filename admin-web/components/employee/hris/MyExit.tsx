'use client';

import { Fact, FactGrid } from '@/components/profile/ProfileParts';
import { StatusTag } from '@/components/employee/parts';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  SEPARATION_TYPES,
  SETTLEMENT_LABEL,
  checklist,
  formatAmount,
  noticeShortfall,
  settlementTotals,
  type EmployeeSeparation,
  type ReturnStatus,
} from '@/lib/employeeSeparation';
import { Card, SubHeading } from './ui';

const returnWord = (s: ReturnStatus) => (s === 'returned' ? 'Returned' : s === 'not_applicable' ? 'Not applicable' : 'Pending');

/** Your exit: the checklist HR works through and what you are owed, read only. Only
 * shown when HR has started a separation for you. */
export default function MyExit({ sep }: { sep: EmployeeSeparation }) {
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
    <div className={`flex justify-between gap-3 border-t border-slate-100 py-2.5 text-sm ${strong ? 'font-extrabold' : ''}`}>
      <dt className={strong ? '' : 'text-slate-600'}>{label}</dt>
      <dd className="m-0 tabular-nums">{formatAmount(value)}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-3 lg:gap-6">
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
            <p role="status" className="mt-3 text-[13px] font-bold text-[#c2410c]">
              {shortfall} day{shortfall === 1 ? '' : 's'} short of the required notice.
            </p>
          )}
        </Card>

        <Card title="Exit checklist">
          <ul className="mt-2 divide-y divide-slate-100">
            {rows.map(r => (
              <li key={r.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-extrabold">{r.label}</div>
                  <div className="text-xs font-medium text-slate-600">{r.detail}</div>
                </div>
                <StatusTag tone={done(r.key) ? 'good' : 'warning'}>{done(r.key) ? 'Done' : 'Pending'}</StatusTag>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Final settlement" right={<StatusTag tone={sep.settlement_status === 'pending' ? 'warning' : 'good'}>{SETTLEMENT_LABEL[sep.settlement_status]}</StatusTag>}>
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
        <div className="mt-4 rounded-xl bg-brand-light px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold text-[#065f46]">{totals.net >= 0 ? 'Net payable to you' : 'Net owed to the company'}</span>
            <span className="text-lg font-extrabold tabular-nums text-[#065f46]">{formatAmount(Math.abs(totals.net))}</span>
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
