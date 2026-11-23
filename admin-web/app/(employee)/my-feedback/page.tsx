'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { otherCalendarSpan } from '@/lib/kpi';
import { useFeedbackGiving, useMyCustomerForms, useMyFeedback } from '@/lib/useFeedback';
import { PageBody } from '@/components/employee/parts';
import MonthStepper from '@/components/kpi/MonthStepper';
import { CustomerFormsReport, FeedbackReport } from '@/components/kpi/FeedbackReport';
import GiveFeedbackDialog from '@/components/kpi/GiveFeedbackDialog';

// Feedback, for the person signed in: what colleagues said about them, laid out as a report (by the kind of colleague, never by
// name), with a "Give feedback" button that opens the feedback form so they can give feedback to anyone they work with; and the
// customer forms typed in about them, to read only (the admin types them in and changes them).
export default function MyFeedbackPage() {
  usePageTitle('Feedback');
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(() => todayAnchor());
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  // undefined = not read yet, null = this account is not linked to an employee.
  const [employeeId, setEmployeeId] = useState<string | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from('profiles').select('employee_id').eq('id', auth.user.id).single();
      if (live) setEmployeeId((data?.employee_id as string | null) ?? null);
    })();
    return () => {
      live = false;
    };
  }, []);

  const mine = useMyFeedback(start, end, refresh);
  const forms = useMyCustomerForms(employeeId ?? null, start, end, refresh);
  const giving = useFeedbackGiving();

  return (
    <PageBody>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <MonthStepper label={label} subtitle={otherSpan} onPrevious={() => setAnchor(a => stepAnchor(system, a, -1))} onNext={() => setAnchor(a => stepAnchor(system, a, 1))} />
        </div>

        <FeedbackReport
          title="Feedback from colleagues"
          periodLabel={label}
          read={mine}
          subject={{ you: true, name: 'you' }}
          actions={
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              disabled={giving.loading || !!giving.error}
              className="min-h-[44px] rounded-[10px] bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            >
              Give feedback
            </button>
          }
        />

        {giving.error && (
          <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
            {giving.error}
          </p>
        )}
        {note && (
          <p role="status" className="m-0 text-sm font-semibold text-emerald-800">
            {note}
          </p>
        )}

        <CustomerFormsReport periodLabel={label} forms={forms.forms} loading={employeeId === undefined || forms.loading} error={forms.error} />
      </div>

      {formOpen && (
        <GiveFeedbackDialog
          colleagues={giving.colleagues}
          given={giving.given}
          onClose={() => setFormOpen(false)}
          onSent={who => {
            setNote(`Thank you. Your feedback${who ? ` for ${who}` : ''} was sent.`);
            giving.reload();
            setRefresh(k => k + 1);
          }}
        />
      )}
    </PageBody>
  );
}
