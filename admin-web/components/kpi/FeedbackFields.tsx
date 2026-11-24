'use client';

import DatePicker from '@/components/DatePicker';
import { Question, circleClasses } from '@/components/kpi/FormParts';
import { COMMENT_MAX, GUEST_EMAIL_MAX, GUEST_NAME_MAX, GUEST_PHONE_MAX, REFERENCE_MAX, type FeedbackDraft } from '@/lib/customerFeedback';
import { useKpiSettings } from '@/lib/useKpiSettings';
import type { Employee } from '@/lib/types';

export type StaffOption = Pick<Employee, 'id' | 'name' | 'department'>;

const LABEL = 'mb-1.5 block text-xs font-bold text-slate-700';
const FIELD =
  'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const NUMBER = 'h-11 w-[84px] rounded-[10px] border border-slate-300 bg-white px-3 text-base font-extrabold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** The numbers the customer could circle, as buttons to click. They are a second way in: the box beside them takes the same
 * number typed, and the buttons are left out of the Tab order so typing one form after another stays as fast as before. */
function Circles({ from, to, value, onPick, name, words }: { from: number; to: number; value: string; onPick: (v: string) => void; name: string; words?: string[] }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-1.5">
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n, i) => {
        const on = value.trim() === String(n);
        return (
          <button
            key={n}
            type="button"
            tabIndex={-1}
            aria-pressed={on}
            aria-label={words ? `${n}, ${words[i]}` : String(n)}
            onClick={() => onPick(on ? '' : String(n))}
            className={circleClasses(on)}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** The boxes of one customer form, in the order of the paper form: who served them, the date of the visit, what it was for, who the
 * guest is (name and phone are required, the email is optional), 1. the service rating the customer circled, 2. how likely they are
 * to recommend, 3. the comment. Shared by the typing card and the edit dialog; `idPrefix` keeps the ids of the two apart. A customer
 * may skip a question, so the numbers and the comment can be left empty. */
export default function FeedbackFields({ draft, onChange, staff, idPrefix, employeeRef, ratingRef, employeeLocked = false }: {
  /** The employee is fixed (the form is typed in on that person's own page). */
  employeeLocked?: boolean;
  draft: FeedbackDraft;
  onChange: (next: FeedbackDraft) => void;
  staff: StaffOption[];
  idPrefix: string;
  employeeRef?: React.Ref<HTMLSelectElement>;
  ratingRef?: React.Ref<HTMLInputElement>;
}) {
  const { words } = useKpiSettings();
  const set = (patch: Partial<FeedbackDraft>) => onChange({ ...draft, ...patch });
  const optional = <span className="font-medium text-slate-600">(optional)</span>;
  return (
    <>
      <div className="mb-3.5">
        <label htmlFor={`${idPrefix}-employee`} className={LABEL}>
          {words.t('Who served the customer')}
        </label>
        <select id={`${idPrefix}-employee`} ref={employeeRef} value={draft.employeeId} disabled={employeeLocked} onChange={e => set({ employeeId: e.target.value })} className={FIELD}>
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
          <span className={LABEL}>Date of visit</span>
          <DatePicker value={draft.date} onChange={v => set({ date: v })} ariaLabel="Date of visit" className="h-11 rounded-[10px] border-slate-300 font-semibold" />
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

      <div className="mb-3.5">
        <label htmlFor={`${idPrefix}-guest-name`} className={LABEL}>
          {words.One} name
        </label>
        <input id={`${idPrefix}-guest-name`} type="text" maxLength={GUEST_NAME_MAX} autoComplete="off" aria-required="true" value={draft.guestName} onChange={e => set({ guestName: e.target.value })} className={FIELD} />
      </div>
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-guest-phone`} className={LABEL}>
            Phone
          </label>
          <input id={`${idPrefix}-guest-phone`} type="tel" inputMode="tel" maxLength={GUEST_PHONE_MAX} autoComplete="off" aria-required="true" value={draft.guestPhone} onChange={e => set({ guestPhone: e.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-guest-email`} className={LABEL}>
            Email {optional}
          </label>
          <input id={`${idPrefix}-guest-email`} type="email" inputMode="email" maxLength={GUEST_EMAIL_MAX} autoComplete="off" value={draft.guestEmail} onChange={e => set({ guestEmail: e.target.value })} className={FIELD} />
        </div>
      </div>

      <Question n={1} htmlFor={`${idPrefix}-rating`} title="How was the service you received?" range="Rating, 1 to 5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
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
          <Circles from={1} to={5} value={draft.rating} onPick={v => set({ rating: v })} name="Rating" words={RATING_WORDS} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11.5px] text-slate-600">
          <span>1 = Poor</span>
          <span>5 = Excellent</span>
        </div>
      </Question>

      <Question n={2} htmlFor={`${idPrefix}-recommend`} title="How likely are you to recommend us to a friend or family member?" range="Would recommend, 0 to 10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
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
          <Circles from={0} to={10} value={draft.recommend} onPick={v => set({ recommend: v })} name="Would recommend" />
        </div>
        <div className="mt-1.5 flex justify-between text-[11.5px] text-slate-600">
          <span>0 = Not at all likely</span>
          <span>10 = Extremely likely</span>
        </div>
      </Question>

      <Question n={3} htmlFor={`${idPrefix}-comment`} title="Anything else you would like to tell us?" range="Comment (optional)">
        <textarea
          id={`${idPrefix}-comment`}
          rows={3}
          maxLength={COMMENT_MAX}
          value={draft.comment}
          onChange={e => set({ comment: e.target.value })}
          className="w-full resize-y rounded-[10px] border border-slate-300 bg-white px-3 py-2.5 text-sm leading-normal text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </Question>
    </>
  );
}
