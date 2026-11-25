'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { otherCalendarSpan, parseMonthParam } from '@/lib/kpi';
import { useMonthInUrl } from '@/lib/useMonthInUrl';
import { removeFeedback, useFeedbackAbout, useFeedbackGiving } from '@/lib/useFeedback';
import { useMyEmployeeId } from '@/lib/useMyKpi';
import { giverWords, type FeedbackItem, type FeedbackPerson } from '@/lib/colleagueFeedback';
import { useConfirm } from '@/components/ConfirmDialog';
import MonthStepper from '@/components/kpi/MonthStepper';
import { FeedbackReport } from '@/components/kpi/FeedbackReport';
import GiveFeedbackDialog from '@/components/kpi/GiveFeedbackDialog';
import FeedbackRolesDialog, { type FeedbackRole } from '@/components/kpi/FeedbackRolesDialog';

const SECONDARY = 'min-h-[44px] rounded-[10px] border border-teal-700 bg-white px-[18px] text-sm font-extrabold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';
const PRIMARY = 'min-h-[44px] rounded-[10px] bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

// Colleague reviews of one person, as a report: the feedback colleagues gave them in the month on screen, with who gave each piece
// and what kind of colleague they are. Everyone who works in the company, admin and HR accounts included, can give feedback to anyone at
// any time, with the "Give feedback" button, which opens the feedback form on this person. An admin also chooses who counts as
// C-level and as training and compliance, and can remove a piece of feedback (rude or mistaken), except on their own page.
// Employees give and read their own feedback on their own Feedback page.
export default function ColleagueReviewsPage() {
  // useSearchParams needs a Suspense boundary, like the other pages that read the address.
  return (
    <Suspense fallback={null}>
      <ReviewsSection />
    </Suspense>
  );
}

function ReviewsSection() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const { system } = useCalendarSystem();

  const [anchor, setAnchor] = useState(() => parseMonthParam(params.get('date')) ?? todayAnchor());
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);
  useMonthInUrl(start);

  const [name, setName] = useState('this person');
  const [refresh, setRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [rolesOpen, setRolesOpen] = useState<{ people: FeedbackPerson[]; roles: FeedbackRole[] } | null>(null);
  const [rolesError, setRolesError] = useState('');

  const read = useFeedbackAbout(employeeId, start, end, true, refresh);
  const giving = useFeedbackGiving();
  const confirm = useConfirm();
  // An admin or HR who is also an employee cannot remove what was said about them, so their own page has no Remove buttons.
  const myEmployeeId = useMyEmployeeId();
  const canRemove = myEmployeeId !== undefined && myEmployeeId !== employeeId;
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');

  async function remove(item: FeedbackItem) {
    const from = giverWords(item);
    const sure = await confirm(`Remove the feedback from ${from} on ${formatAdDate(item.given_on, system)}? It is deleted for good and no longer counts in ${name}'s KPIs.`, {
      title: 'Remove this feedback?',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!sure) return;
    setRemoving(item.id);
    setRemoveError('');
    setNote('');
    const problem = await removeFeedback(item.id);
    setRemoving(null);
    if (problem) return setRemoveError(problem);
    setNote(`Removed the feedback from ${from}.`);
    setRefresh(k => k + 1);
    giving.reload();
  }

  useEffect(() => {
    let live = true;
    supabase
      .from('employees')
      .select('id, name')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        if (live && data) setName((data as { name: string }).name);
      });
    return () => {
      live = false;
    };
  }, [employeeId]);

  async function openRoles() {
    setRolesError('');
    const [emp, roles] = await Promise.all([supabase.from('employees').select('id, name, department, status'), supabase.from('feedback_roles').select('employee_id, role')]);
    const failed = emp.error ?? roles.error;
    if (failed) return setRolesError(`Could not load the list: ${failed.message}`);
    setRolesOpen({ people: (emp.data as FeedbackPerson[] | null) ?? [], roles: (roles.data as FeedbackRole[] | null) ?? [] });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthStepper label={label} subtitle={otherSpan} onPrevious={() => setAnchor(a => stepAnchor(system, a, -1))} onNext={() => setAnchor(a => stepAnchor(system, a, 1))} />
      </div>

      <FeedbackReport
        title={`Feedback for ${name}`}
        periodLabel={label}
        read={read}
        subject={{ you: false, name }}
        onRemove={canRemove ? remove : undefined}
        removing={removing}
        actions={
          <>
            <button type="button" onClick={() => setFormOpen(true)} disabled={giving.loading || !!giving.error} className={PRIMARY}>
              Give feedback
            </button>
            <button type="button" onClick={openRoles} className={SECONDARY}>
              Who counts as C-level and training
            </button>
          </>
        }
      />

      {giving.error && (
        <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
          {giving.error}
        </p>
      )}
      {removeError && (
        <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
          {removeError}
        </p>
      )}
      {rolesError && (
        <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
          {rolesError}
        </p>
      )}
      {note && (
        <p role="status" className="m-0 text-sm font-semibold text-emerald-800">
          {note}
        </p>
      )}

      {formOpen && (
        <GiveFeedbackDialog
          colleagues={giving.colleagues}
          given={giving.given}
          subjectId={employeeId}
          onClose={() => setFormOpen(false)}
          onSent={who => {
            setNote(`Thank you. Your feedback${who ? ` for ${who}` : ''} was sent.`);
            giving.reload();
            setRefresh(k => k + 1);
          }}
          onRemoved={who => {
            setNote(`Your feedback${who ? ` for ${who}` : ''} was taken back.`);
            giving.reload();
            setRefresh(k => k + 1);
          }}
        />
      )}
      {rolesOpen && (
        <FeedbackRolesDialog
          people={rolesOpen.people}
          roles={rolesOpen.roles}
          onClose={() => setRolesOpen(null)}
          onSaved={() => {
            setRolesOpen(null);
            setNote('Saved. Feedback given from now on counts by these roles.');
          }}
        />
      )}
    </div>
  );
}
