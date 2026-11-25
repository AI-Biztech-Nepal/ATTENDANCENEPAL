import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, type CalendarAnchor } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { otherCalendarSpan } from '../../lib/kpi';
import { removeFeedback, useFeedbackAbout, useFeedbackGiving } from '../../lib/useFeedback';
import { useMyEmployeeId } from '../../lib/useMyKpi';
import { giverWords, type FeedbackItem, type FeedbackPerson } from '../../lib/colleagueFeedback';
import { Button, MonthStepper, useAsk } from './KpiUi';
import { FeedbackReport } from './FeedbackReport';
import GiveFeedbackSheet from './GiveFeedbackSheet';
import FeedbackRolesSheet, { type FeedbackRole } from './FeedbackRolesSheet';

/**
 * Colleague reviews of one person, as a report: the feedback colleagues gave them in the month on screen, with who gave each piece and what
 * kind of colleague they are. Everyone who works in the company, admin and HR accounts included, can give feedback to anyone at any time with
 * the "Give feedback" button, which opens the form on this person. An admin also chooses who counts as C-level and as training and compliance,
 * and can remove a piece of feedback (rude or mistaken), except on their own page. Same as admin-web/app/(admin)/kpis/[employeeId]/reviews/page.tsx.
 */
export default function ColleagueReviewsSection({ employeeId, anchor, onAnchor }: { employeeId: string; anchor: CalendarAnchor; onAnchor: (a: CalendarAnchor) => void }) {
  const { system } = useCalendarSystem();
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  const [name, setName] = useState('this person');
  const [refresh, setRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [rolesOpen, setRolesOpen] = useState<{ people: FeedbackPerson[]; roles: FeedbackRole[] } | null>(null);
  const [rolesError, setRolesError] = useState('');

  const read = useFeedbackAbout(employeeId, start, end, true, refresh);
  const giving = useFeedbackGiving();
  const ask = useAsk();
  // An admin or HR who is also an employee cannot remove what was said about them, so their own page has no Remove buttons.
  const myEmployeeId = useMyEmployeeId();
  const canRemove = myEmployeeId !== undefined && myEmployeeId !== employeeId;
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');

  async function remove(item: FeedbackItem) {
    const from = giverWords(item);
    const sure = await ask(`Remove the feedback from ${from} on ${formatAdDate(item.given_on, system)}? It is deleted for good and no longer counts in ${name}'s KPIs.`, 'Remove');
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
    Promise.resolve(supabase.from('employees').select('id, name').eq('id', employeeId).single()).then(({ data }) => {
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

  const problem = (text: string) => (
    <Text accessibilityRole="alert" style={{ fontSize: 14, fontWeight: '700', color: colors.criticalText }}>
      {text}
    </Text>
  );

  return (
    <>
      <MonthStepper label={label} subtitle={otherSpan} onPrevious={() => onAnchor(stepAnchor(system, anchor, -1))} onNext={() => onAnchor(stepAnchor(system, anchor, 1))} />

      <FeedbackReport
        title={`Feedback for ${name}`}
        periodLabel={label}
        read={read}
        subject={{ you: false, name }}
        onRemove={canRemove ? remove : undefined}
        removing={removing}
        actions={
          <>
            <Button label="Give feedback" onPress={() => setFormOpen(true)} disabled={giving.loading || !!giving.error} />
            <Button label="Who counts as C-level and training" kind="outline" onPress={openRoles} />
          </>
        }
      />

      {giving.error ? problem(giving.error) : null}
      {removeError ? problem(removeError) : null}
      {rolesError ? problem(rolesError) : null}
      {note ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ fontSize: 14, fontWeight: '700', color: '#065f46' }}>
          {note}
        </Text>
      ) : null}

      {formOpen && (
        <GiveFeedbackSheet
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
        <FeedbackRolesSheet
          people={rolesOpen.people}
          roles={rolesOpen.roles}
          onClose={() => setRolesOpen(null)}
          onSaved={() => {
            setRolesOpen(null);
            setNote('Saved. Feedback given from now on counts by these roles.');
          }}
        />
      )}
    </>
  );
}
