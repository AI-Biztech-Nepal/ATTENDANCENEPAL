import React, { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { otherCalendarSpan } from '../lib/kpi';
import { useFeedbackGiving, useMyCustomerForms, useMyFeedback } from '../lib/useFeedback';
import { useMyEmployeeId } from '../lib/useMyKpi';
import { colors } from '../theme';
import { Button, Message, MonthStepper, Page, Segmented, SLATE } from '../components/kpi/KpiUi';
import PersonKpis from '../components/kpi/PersonKpis';
import { CustomerFormsReport, FeedbackReport } from '../components/kpi/FeedbackReport';
import GiveFeedbackSheet from '../components/kpi/GiveFeedbackSheet';
import { GuestHistoryProvider } from '../components/kpi/GuestHistory';

type Section = 'kpis' | 'feedback';

/**
 * The employee's KPIs tab: My KPIs (their own numbers from the owner's sheet, each with the chart that suits it, next to last month) and
 * Feedback (what colleagues and customers said, with who said it, and giving feedback to a colleague). Read only except for giving
 * feedback, and only ever their own: nothing is added up, ranked or set against a colleague. Same as admin-web/app/(employee)/my-kpis and my-feedback.
 */
export default function MyKpisScreen() {
  const employeeId = useMyEmployeeId();
  const [section, setSection] = useState<Section>('kpis');
  // Each section keeps its own month, so going back and forth does not lose where you were.
  const [anchor, setAnchor] = useState(() => todayAnchor());

  if (employeeId === undefined) {
    return (
      <Page>
        <Text style={{ fontSize: 14, color: SLATE[600] }}>Loading…</Text>
      </Page>
    );
  }
  if (employeeId === null) {
    return (
      <Page>
        <Message title="Your account is not linked to an employee record, so there are no KPIs to show. Ask your admin to link it." />
      </Page>
    );
  }

  return (
    <Page>
      <Segmented
        label="KPIs sections"
        value={section}
        options={[
          { id: 'kpis', label: 'My KPIs' },
          { id: 'feedback', label: 'Feedback' },
        ]}
        onChange={setSection}
      />
      {section === 'kpis' ? (
        <PersonKpis employeeId={employeeId} mine anchor={anchor} onAnchor={setAnchor} openFeedback={() => setSection('feedback')} />
      ) : (
        <MyFeedback employeeId={employeeId} anchor={anchor} onAnchor={setAnchor} />
      )}
    </Page>
  );
}

/** What colleagues said about the person, with who gave each piece and a "Give feedback" button, and the customer forms typed in about them (read only). */
function MyFeedback({ employeeId, anchor, onAnchor }: { employeeId: string; anchor: ReturnType<typeof todayAnchor>; onAnchor: (a: ReturnType<typeof todayAnchor>) => void }) {
  const { system } = useCalendarSystem();
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);
  const [refresh, setRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');

  const mine = useMyFeedback(start, end, refresh);
  const forms = useMyCustomerForms(employeeId, start, end, refresh);
  const giving = useFeedbackGiving();

  return (
    <>
      <MonthStepper label={label} subtitle={otherSpan} onPrevious={() => onAnchor(stepAnchor(system, anchor, -1))} onNext={() => onAnchor(stepAnchor(system, anchor, 1))} />

      <FeedbackReport
        title="Feedback from colleagues"
        periodLabel={label}
        read={mine}
        subject={{ you: true, name: 'you' }}
        actions={<Button label="Give feedback" onPress={() => setFormOpen(true)} disabled={giving.loading || !!giving.error} />}
      />

      {giving.error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, fontWeight: '700', color: colors.criticalText }}>
          {giving.error}
        </Text>
      ) : null}
      {note ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ fontSize: 14, fontWeight: '700', color: '#065f46' }}>
          {note}
        </Text>
      ) : null}

      <GuestHistoryProvider>
        <CustomerFormsReport periodLabel={label} forms={forms.forms} loading={forms.loading} error={forms.error} namesError={forms.namesError} />
      </GuestHistoryProvider>

      {formOpen && (
        <GiveFeedbackSheet
          colleagues={giving.colleagues}
          given={giving.given}
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
    </>
  );
}
