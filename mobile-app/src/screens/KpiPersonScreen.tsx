import React, { useMemo, useState } from 'react';
import { isKpiOn, type KpiId } from '../lib/kpiSettings';
import { parseMonthParam } from '../lib/kpi';
import { todayAnchor } from '../lib/calendar';
import { useKpiSettings } from '../lib/useKpiSettings';
import { Page, Segmented } from '../components/kpi/KpiUi';
import PersonKpis from '../components/kpi/PersonKpis';
import CustomerFeedbackSection from '../components/kpi/CustomerFeedbackSection';
import ColleagueReviewsSection from '../components/kpi/ColleagueReviewsSection';
import ImportSection from '../components/kpi/ImportSection';

type Section = 'overview' | 'feedback' | 'reviews' | 'import';

// The sections of one person's KPIs. A section whose KPIs this company turned off is left out, unless it is the one being looked at. The month
// on screen is carried from one section to the next. Same as admin-web/components/kpi/KpiTabs.tsx.
const SECTIONS: { id: Section; label: string; uses?: KpiId[] }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'feedback', label: 'Customer feedback', uses: ['feedback', 'nps'] },
  { id: 'reviews', label: 'Colleague reviews', uses: ['peers', 'manager', 'clevel', 'training'] },
  // Import is for the whole company and is the same on every person's screen.
  { id: 'import', label: 'Import', uses: ['services', 'rebooking', 'utilisation'] },
];

/**
 * One person's KPIs, an admin's or HR's view, opened from the KPI list for the month it was looking at: Overview (the cards and the report
 * behind each), Customer feedback (typing in the paper forms), Colleague reviews (what colleagues said, with who said it, and giving or
 * removing feedback) and Import (the booking file). Same as the pages under admin-web/app/(admin)/kpis/[employeeId].
 */
export default function KpiPersonScreen({ route }: any) {
  const employeeId: string = route.params.employeeId;
  const { settings, words, loaded } = useKpiSettings();
  const [section, setSection] = useState<Section>('overview');
  const [anchor, setAnchor] = useState(() => parseMonthParam(route.params.start ?? null) ?? todayAnchor());

  const shown = useMemo(() => SECTIONS.filter(s => s.id === section || !s.uses || s.uses.some(id => isKpiOn(id, settings))), [section, settings]);

  return (
    <Page>
      {loaded ? <Segmented label="KPI sections" value={section} options={shown.map(s => ({ id: s.id, label: words.t(s.label) }))} onChange={setSection} /> : null}
      {section === 'overview' ? (
        <PersonKpis employeeId={employeeId} mine={false} anchor={anchor} onAnchor={setAnchor} typeInForm={() => setSection('feedback')} />
      ) : section === 'feedback' ? (
        <CustomerFeedbackSection employeeId={employeeId} anchor={anchor} onAnchor={setAnchor} />
      ) : section === 'reviews' ? (
        <ColleagueReviewsSection employeeId={employeeId} anchor={anchor} onAnchor={setAnchor} />
      ) : (
        <ImportSection />
      )}
    </Page>
  );
}
