'use client';

import { useEffect, useState } from 'react';
import { StatusTag, type TagTone } from '@/components/employee/parts';
import { supabase } from '@/lib/supabase';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { HISTORY_FIELDS, entryTags, formatMoney, percentChange, type EmployeeHistoryEntry, type HistoryChange } from '@/lib/employeeHistory';
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
} from '@/lib/employeeRecords';
import type { EmployeeTraining } from '@/lib/types';
import { Card, Empty, SubHeading, Unavailable } from './ui';

const KIND_TONE: Record<ConductKind, TagTone> = { warning: 'warning', disciplinary: 'critical', grievance: 'info' };
const STATUS_TONE: Record<ConductStatus, TagTone> = { open: 'warning', under_review: 'info', closed: 'neutral' };

type Loaded = {
  history: EmployeeHistoryEntry[] | null;
  appraisals: Appraisal[] | null;
  awards: Award[] | null;
  conduct: ConductRecord[] | null;
  training: EmployeeTraining[] | null;
};

/** Your own file, read only: transfers / promotions / increments, appraisals and
 * awards, conduct records and training. Each list loads on its own; one that can't
 * be read (null) says so without taking the others down with it. */
export default function MyRecords({ employeeId, joinedOn }: { employeeId: string; joinedOn: string | null }) {
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
      supabase.from('employee_training').select('*').eq('employee_id', employeeId).order('start_date', { ascending: false }),
    ]).then(([h, a, w, c, t]) => {
      if (!live) return;
      setData({
        history: list<EmployeeHistoryEntry>(h),
        appraisals: list<Appraisal>(a),
        awards: list<Award>(w),
        conduct: list<ConductRecord>(c),
        training: list<EmployeeTraining>(t),
      });
    });
    return () => {
      live = false;
    };
  }, [employeeId]);

  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : '—');

  if (!data) return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;

  const average = data.appraisals ? averageRating(data.appraisals) : null;
  const latest = data.appraisals?.[0];
  const openConduct = data.conduct?.filter(r => r.status !== 'closed').length ?? 0;

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-3 lg:gap-6">
        <Card title="Transfers, promotions & increments" note="Recorded when your branch, designation, department, manager or pay changes.">
          {data.history === null ? (
            <Unavailable />
          ) : (
            <ol className="mt-4">
              {data.history.length === 0 && <li className="pb-3 text-[13px] text-slate-600">Nothing recorded yet. A transfer, promotion or pay change will appear here.</li>}
              {data.history.map(entry => (
                <li key={entry.id} className="relative border-l-2 border-slate-200 pb-5 pl-4">
                  <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold">{date(entry.effective_date)}</span>
                    {entryTags(entry.changes).map(t => (
                      <StatusTag key={t.label} tone={t.tone}>
                        {t.label}
                      </StatusTag>
                    ))}
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-sm">
                    {HISTORY_FIELDS.map(field => {
                      const change = entry.changes[field.key];
                      return change ? <ChangeLine key={field.key} label={field.label} money={field.money} change={change} /> : null;
                    })}
                  </ul>
                  {(entry.reason || entry.remark) && (
                    <div className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                      {entry.reason && (
                        <p>
                          <span className="font-bold text-slate-500">Reason:</span> {entry.reason}
                        </p>
                      )}
                      {entry.remark && (
                        <p>
                          <span className="font-bold text-slate-500">Remark:</span> {entry.remark}
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.source === 'manual' ? 'Added by HR' : 'Recorded automatically'} · {date(localDateKey(entry.created_at))}
                  </p>
                </li>
              ))}
              {joinedOn && (
                <li className="relative border-l-2 border-transparent pl-4">
                  <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
                  <span className="text-sm font-extrabold">{date(joinedOn)}</span>
                  <span className="ml-2 text-xs font-semibold text-slate-500">Joined</span>
                </li>
              )}
            </ol>
          )}
        </Card>

        <Card title="Training & certification">
          {data.training === null ? (
            <Unavailable />
          ) : data.training.length === 0 ? (
            <Empty>No training recorded yet.</Empty>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {data.training.map(t => (
                <li key={t.id} className="py-3">
                  <div className="text-sm font-extrabold">{t.title}</div>
                  {t.provider && <div className="text-xs font-medium text-slate-600">{t.provider}</div>}
                  {(t.start_date || t.end_date) && (
                    <div className="mt-0.5 text-xs font-medium text-slate-500">
                      {date(t.start_date)}
                      {t.end_date ? ` – ${date(t.end_date)}` : ''}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:gap-6">
        <Card title="Performance & recognition">
          {data.appraisals === null || data.awards === null ? (
            <Unavailable />
          ) : (
            <>
              {average !== null && latest && (
                <p className="mt-2 text-[13px] font-semibold text-slate-600">
                  Average <span className="font-extrabold text-ink">{average} / 5</span> over {data.appraisals.length} appraisal{data.appraisals.length === 1 ? '' : 's'} · latest{' '}
                  <span className="font-extrabold text-ink">{latest.rating}</span> on {date(latest.appraisal_date)}
                </p>
              )}
              <SubHeading>Appraisals</SubHeading>
              {data.appraisals.length === 0 && <Empty>No appraisals recorded yet.</Empty>}
              <ul className="divide-y divide-slate-100">
                {data.appraisals.map(a => (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold">{date(a.appraisal_date)}</span>
                      <StatusTag tone="neutral">{periodLabel(a.period_type)}</StatusTag>
                    </div>
                    <p className="mt-1 text-sm" title={`${a.rating} out of 5`}>
                      <span aria-hidden="true" className="tracking-wider text-[#f97316]">
                        {starString(Number(a.rating))}
                      </span>{' '}
                      <span className="font-extrabold">{a.rating} / 5</span>
                      <span className="font-semibold text-slate-600"> · {ratingLabel(Number(a.rating))}</span>
                    </p>
                    {(a.period_start || a.period_end) && (
                      <p className="mt-0.5 text-xs font-medium text-slate-500">
                        Period: {date(a.period_start)} – {date(a.period_end)}
                      </p>
                    )}
                    {a.evaluated_by && <p className="mt-0.5 text-xs font-medium text-slate-500">Evaluated by {a.evaluated_by}</p>}
                    {a.remarks && (
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                        <span className="text-xs font-bold text-slate-500">Remarks: </span>
                        {a.remarks}
                      </p>
                    )}
                    {a.skills_assessment && (
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                        <span className="text-xs font-bold text-slate-500">Skills assessment: </span>
                        {a.skills_assessment}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <SubHeading>Awards & recognition</SubHeading>
              {data.awards.length === 0 && <Empty>No awards recorded yet.</Empty>}
              <ul className="divide-y divide-slate-100">
                {data.awards.map(w => (
                  <li key={w.id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-extrabold">{w.title}</span>
                      <span className="text-xs font-medium text-slate-500">{date(w.awarded_on)}</span>
                    </div>
                    {w.description && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{w.description}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="Conduct records"
          note="Warnings, disciplinary actions and grievances, with the final decision."
          right={openConduct > 0 ? <span className="shrink-0 text-xs font-extrabold text-[#c2410c]">{openConduct} still open</span> : undefined}
        >
          {data.conduct === null ? (
            <Unavailable />
          ) : data.conduct.length === 0 ? (
            <Empty>Nothing on file.</Empty>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {data.conduct.map(r => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold">{date(r.record_date)}</span>
                    <StatusTag tone={KIND_TONE[r.kind]}>
                      {r.kind === 'warning' ? warningLevelLabel(r.warning_level as WarningLevel | null) : CONDUCT_KINDS.find(k => k.value === r.kind)!.label}
                    </StatusTag>
                    <StatusTag tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</StatusTag>
                  </div>
                  <p className="mt-1 text-sm font-bold">{r.title}</p>
                  {r.details && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{r.details}</p>}
                  {r.final_decision && (
                    <p className="mt-1.5 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <span className="text-xs font-bold text-slate-500">
                        Final decision{r.decided_on ? ` · ${date(r.decided_on)}` : ''}:{' '}
                      </span>
                      {r.final_decision}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function ChangeLine({ label, money, change }: { label: string; money?: boolean; change: HistoryChange }) {
  const show = (v: string | number | null) => (money ? formatMoney(v) : v === null || v === '' ? '(none)' : String(v));
  const pct = money ? percentChange(change) : null;
  const hadBefore = change.from !== null && change.from !== '';
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-slate-500">{label}:</span>
      {hadBefore && (
        <>
          <span className="text-slate-500">{show(change.from)}</span>
          <span className="text-slate-400" aria-label="changed to">
            →
          </span>
        </>
      )}
      <span className="font-extrabold">{show(change.to)}</span>
      {pct && <span className={`text-xs font-bold ${pct.startsWith('+') ? 'text-[#14532d]' : 'text-[#b91c1c]'}`}>({pct})</span>}
    </li>
  );
}
