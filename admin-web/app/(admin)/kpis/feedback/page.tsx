'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { useCompanyName } from '@/lib/companyName';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { nepalTodayIso } from '@/lib/shift';
import { weekdayName } from '@/lib/taskSchedule';
import { otherCalendarSpan } from '@/lib/kpi';
import { FEEDBACK_COLUMNS, FEEDBACK_PAGE_SIZE, emptyDraft, feedbackRow, rangeText, validateFeedback, type FeedbackDraft } from '@/lib/customerFeedback';
import type { CustomerFeedback, Employee } from '@/lib/types';
import KpiTabs from '@/components/kpi/KpiTabs';
import MonthStepper from '@/components/kpi/MonthStepper';
import FeedbackFields, { type StaffOption } from '@/components/kpi/FeedbackFields';
import FeedbackEditDialog from '@/components/kpi/FeedbackEditDialog';
import BlankFeedbackForm from '@/components/kpi/BlankFeedbackForm';

type Person = Pick<Employee, 'id' | 'name' | 'department' | 'status'>;

// Customers do not use the app: they fill in a paper form, and staff type each one in here. The same form
// counts toward two KPIs, the 1-5 service rating (customer feedback) and the 0-10 would-recommend number (NPS).
// The page has the typing card, the forms typed in for a month (change or delete one with Edit), and a blank
// form to print.
export default function CustomerFeedbackPage() {
  usePageTitle('KPIs');
  const { system } = useCalendarSystem();
  const today = useMemo(nepalTodayIso, []);
  const companyName = useCompanyName();

  const [people, setPeople] = useState<Person[]>([]);
  const staff = useMemo(() => people.filter(p => p.status === 'active'), [people]);

  // --- the typing card ---
  const [draft, setDraft] = useState<FeedbackDraft>(() => emptyDraft(today));
  const [keep, setKeep] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const employeeRef = useRef<HTMLSelectElement>(null);
  const ratingRef = useRef<HTMLInputElement>(null);

  // --- the forms typed in for a month ---
  const [anchor, setAnchor] = useState(todayAnchor);
  const [listEmployee, setListEmployee] = useState('');
  const [page, setPage] = useState(0);
  // `page` is the page these rows belong to, so the footer always describes what is on screen even while the next page loads.
  const [list, setList] = useState<{ rows: CustomerFeedback[]; total: number; page: number } | null>(null);
  const [listError, setListError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<CustomerFeedback | null>(null);

  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, name, department, status')
      .then(({ data }) => setPeople(((data as Person[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))));
  }, []);

  useEffect(() => {
    let live = true;
    let q = supabase.from('customer_feedback').select(FEEDBACK_COLUMNS, { count: 'exact' }).gte('given_on', start).lte('given_on', end);
    if (listEmployee) q = q.eq('employee_id', listEmployee);
    q.order('given_on', { ascending: false })
      .order('created_at', { ascending: false })
      .range(page * FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE + FEEDBACK_PAGE_SIZE - 1)
      .then(({ data, count, error }: { data: unknown; count: number | null; error: { message: string } | null }) => {
        if (!live) return;
        if (error) {
          setListError(`Could not load the forms: ${error.message}`);
          setList({ rows: [], total: 0, page });
          return;
        }
        setListError('');
        const rows = (data as CustomerFeedback[] | null) ?? [];
        // The last form on the last page was deleted: go back a page instead of showing an empty one.
        if (rows.length === 0 && page > 0) setPage(page - 1);
        else setList({ rows, total: count ?? rows.length, page });
      });
    return () => {
      live = false;
    };
  }, [start, end, listEmployee, page, reloadKey]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const personName = (id: string) => people.find(p => p.id === id)?.name ?? 'Unknown';
  const dayText = (d: string) => `${weekdayName(d)} ${formatAdDate(d, system)}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const problem = validateFeedback(draft, today);
    if (problem) {
      setFormError(problem);
      setNotice('');
      return;
    }
    setSaving(true);
    setFormError('');
    const { error } = await supabase.from('customer_feedback').insert(feedbackRow(draft));
    setSaving(false);
    if (error) {
      setFormError(`Could not save: ${error.message}`);
      return;
    }
    setNotice(`Saved for ${personName(draft.employeeId)} · ${dayText(draft.date)}.`);
    // Ready for the next paper form: the answers are cleared, and the employee and date stay when asked to.
    setDraft(keep ? { ...emptyDraft(today), employeeId: draft.employeeId, date: draft.date } : emptyDraft(today));
    setReloadKey(k => k + 1);
    requestAnimationFrame(() => (keep ? ratingRef : employeeRef).current?.focus());
  }

  function clear() {
    setDraft(emptyDraft(today));
    setFormError('');
    setNotice('');
    employeeRef.current?.focus();
  }

  const closeEdit = useCallback(() => setEditing(null), []);
  const changed = useCallback(() => {
    setEditing(null);
    setReloadKey(k => k + 1);
  }, []);

  // A person who is no longer active can still have forms to fix, so the edit box lists them too.
  const editStaff: StaffOption[] = useMemo(() => {
    if (!editing || staff.some(s => s.id === editing.employee_id)) return staff;
    const gone = people.find(p => p.id === editing.employee_id);
    return gone ? [...staff, gone] : staff;
  }, [editing, staff, people]);

  const total = list?.total ?? 0;
  const rows = list?.rows ?? [];
  const lastPage = Math.max(0, Math.ceil(total / FEEDBACK_PAGE_SIZE) - 1);
  const FILTER = 'h-10 rounded-[10px] border border-slate-300 bg-white pl-3 pr-8 text-[13px] font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

  return (
    <>
      <div className="flex flex-col gap-5 print:hidden">
        <KpiTabs />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="m-0 max-w-[680px] text-[13.5px] leading-relaxed text-slate-600">
            Customers fill in a paper form. Type each form in here, so it counts toward the right employee&apos;s KPIs. Customer feedback and NPS both come from this form.
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-teal-700 bg-white px-[18px] text-sm font-extrabold text-teal-700 hover:bg-teal-50"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z" />
            </svg>
            Print a blank form
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <form
            noValidate
            onSubmit={save}
            aria-labelledby="type-in-heading"
            className="w-full min-w-0 max-w-[520px] flex-[1_1_440px] rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 id="type-in-heading" className="m-0 mb-1 text-lg font-extrabold text-ink">
              Type in a paper form
            </h2>
            <p className="m-0 mb-[18px] text-[13px] leading-normal text-slate-600">Type the numbers the customer circled. Leave a box empty if they skipped it.</p>

            <FeedbackFields draft={draft} onChange={d => setDraft(d)} staff={staff} idPrefix="feedback" employeeRef={employeeRef} ratingRef={ratingRef} />

            <label className="mb-4 flex items-center gap-2.5 text-[13px] text-slate-700">
              <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} className="h-[18px] w-[18px] accent-teal-700" />
              Keep the employee and date for the next form
            </label>

            {formError && (
              <p role="alert" className="m-0 mb-3 text-sm font-semibold text-critical-text">
                {formError}
              </p>
            )}
            {notice && (
              <p role="status" className="m-0 mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-800">
                {notice}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <button type="button" onClick={clear} className="min-h-[44px] px-1 text-sm font-bold text-slate-600 hover:text-ink">
                Clear
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save and type the next'}
              </button>
            </div>
          </form>

          <section aria-labelledby="typed-in-heading" className="min-w-0 flex-[2_1_560px] overflow-hidden rounded-xl border border-slate-200 bg-white pt-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3.5">
              <div>
                <h2 id="typed-in-heading" className="m-0 mb-2 text-lg font-extrabold text-ink">
                  Forms typed in
                </h2>
                <MonthStepper
                  label={label}
                  subtitle={`${list ? `${total} ${total === 1 ? 'form' : 'forms'}` : 'Loading…'}${otherSpan ? ` · ${otherSpan}` : ''}`}
                  onPrevious={() => {
                    setAnchor(a => stepAnchor(system, a, -1));
                    setPage(0);
                  }}
                  onNext={() => {
                    setAnchor(a => stepAnchor(system, a, 1));
                    setPage(0);
                  }}
                />
              </div>
              <select
                aria-label="Employee"
                value={listEmployee}
                onChange={e => {
                  setListEmployee(e.target.value);
                  setPage(0);
                }}
                className={FILTER}
              >
                <option value="">All employees</option>
                {people.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {listError && (
              <p role="alert" className="m-0 border-t border-slate-200 px-6 py-3 text-sm font-semibold text-critical-text">
                {listError}
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50">
                    {['Date', 'Employee', 'Rating', 'Recommend', 'Comment'].map((h, i) => (
                      <th key={h} scope="col" className={`py-[11px] text-xs font-extrabold uppercase tracking-wider text-slate-600 ${i === 0 ? 'px-6' : 'px-3'}`}>
                        {h}
                      </th>
                    ))}
                    <th scope="col" aria-label="Actions" className="px-6 py-[11px]" />
                  </tr>
                </thead>
                <tbody>
                  {!list ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-600">
                        Loading…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-600">
                        {listEmployee ? 'No forms typed in for this employee in' : 'No forms typed in for'} {label}.
                      </td>
                    </tr>
                  ) : (
                    rows.map(r => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-6 py-[13px] text-[13px] text-slate-700">{dayText(r.given_on)}</td>
                        <td className="px-3 py-[13px] text-[13.5px] font-bold text-ink">{personName(r.employee_id)}</td>
                        <td className="px-3 py-[13px] text-sm font-extrabold tabular-nums text-ink">{r.rating ?? <Dash />}</td>
                        <td className="px-3 py-[13px] text-sm font-extrabold tabular-nums text-ink">{r.recommend ?? <Dash />}</td>
                        <td className="px-3 py-[13px] text-[13px] text-slate-700">
                          {r.comment || <Dash />}
                          {r.reference && <span className="mt-0.5 block text-xs text-slate-600">For: {r.reference}</span>}
                        </td>
                        <td className="px-6 py-[13px] text-right">
                          <button
                            type="button"
                            onClick={() => setEditing(r)}
                            aria-label={`Edit the form for ${personName(r.employee_id)} on ${dayText(r.given_on)}`}
                            className="text-[12.5px] font-bold text-accent hover:underline"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
              <div className="text-[13px] text-slate-600">{list ? rangeText(list.page, rows.length, total) : ''}</div>
              <div className="flex gap-2">
                <PagerButton disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                  Previous
                </PagerButton>
                <PagerButton disabled={page >= lastPage} onClick={() => setPage(p => Math.min(lastPage, p + 1))}>
                  Next
                </PagerButton>
              </div>
            </div>
          </section>
        </div>
      </div>

      {editing && <FeedbackEditDialog key={editing.id} row={editing} staff={editStaff} today={today} onClose={closeEdit} onChanged={changed} />}

      <BlankFeedbackForm companyName={companyName} />
    </>
  );
}

/** An empty answer: a dash that a screen reader reads as "no answer". */
function Dash() {
  return (
    <>
      <span aria-hidden="true" className="font-bold text-slate-600">
        –
      </span>
      <span className="sr-only">no answer</span>
    </>
  );
}

function PagerButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-bold text-ink hover:bg-slate-50 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
