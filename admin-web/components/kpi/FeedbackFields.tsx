'use client';

import DatePicker from '@/components/DatePicker';
import { COMMENT_MAX, REFERENCE_MAX, type FeedbackDraft } from '@/lib/customerFeedback';
import type { Employee } from '@/lib/types';

export type StaffOption = Pick<Employee, 'id' | 'name' | 'department'>;

const LABEL = 'mb-1.5 block text-xs font-bold text-slate-700';
const FIELD =
  'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const NUMBER = 'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-base font-extrabold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** The boxes of one customer form: who served them, the date on the paper, what it was for, the two numbers
 * the customer circled, and the comment. Shared by the typing card and the edit dialog; `idPrefix` keeps the
 * ids of the two apart. A customer may skip a question, so the numbers and the comment can be left empty. */
export default function FeedbackFields({ draft, onChange, staff, idPrefix, employeeRef, ratingRef }: {
  draft: FeedbackDraft;
  onChange: (next: FeedbackDraft) => void;
  staff: StaffOption[];
  idPrefix: string;
  employeeRef?: React.Ref<HTMLSelectElement>;
  ratingRef?: React.Ref<HTMLInputElement>;
}) {
  const set = (patch: Partial<FeedbackDraft>) => onChange({ ...draft, ...patch });
  const optional = <span className="font-medium text-slate-600">(optional)</span>;
  return (
    <>
      <div className="mb-3.5">
        <label htmlFor={`${idPrefix}-employee`} className={LABEL}>
          Who served the customer
        </label>
        <select id={`${idPrefix}-employee`} ref={employeeRef} value={draft.employeeId} onChange={e => set({ employeeId: e.target.value })} className={FIELD}>
          <option value="">Select employee…</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.department ? ` · ${s.department}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div>
          <span className={LABEL}>Date on the form</span>
          <DatePicker value={draft.date} onChange={v => set({ date: v })} ariaLabel="Date on the form" className="h-11 rounded-[10px] border-slate-300 font-semibold" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-reference`} className={LABEL}>
            What it was for {optional}
          </label>
          <input
            id={`${idPrefix}-reference`}
            type="text"
            maxLength={REFERENCE_MAX}
            value={draft.reference}
            onChange={e => set({ reference: e.target.value })}
            placeholder="e.g. Consultation"
            className={FIELD}
          />
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <div>
          <label htmlFor={`${idPrefix}-rating`} className={LABEL}>
            Service rating, 1 to 5
          </label>
          <input
            id={`${idPrefix}-rating`}
            ref={ratingRef}
            type="number"
            inputMode="numeric"
            min={1}
            max={5}
            step={1}
            value={draft.rating}
            onChange={e => set({ rating: e.target.value })}
            className={NUMBER}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-recommend`} className={LABEL}>
            Would recommend, 0 to 10
          </label>
          <input
            id={`${idPrefix}-recommend`}
            type="number"
            inputMode="numeric"
            min={0}
            max={10}
            step={1}
            value={draft.recommend}
            onChange={e => set({ recommend: e.target.value })}
            className={NUMBER}
          />
        </div>
      </div>

      <div className="mb-3.5">
        <label htmlFor={`${idPrefix}-comment`} className={LABEL}>
          Comment {optional}
        </label>
        <textarea
          id={`${idPrefix}-comment`}
          rows={3}
          maxLength={COMMENT_MAX}
          value={draft.comment}
          onChange={e => set({ comment: e.target.value })}
          className="w-full resize-y rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-sm leading-normal text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        <p className="m-0 mt-1.5 text-xs text-slate-600">Copy the comment as written. Do not add a customer&apos;s name or phone number.</p>
      </div>
    </>
  );
}
