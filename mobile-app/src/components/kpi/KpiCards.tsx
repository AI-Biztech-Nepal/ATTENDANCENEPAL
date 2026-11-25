import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme';
import { attendanceRates, type AttendanceKpi, type KpiGroup } from '../../lib/kpi';
import { compare, compareServices, lowerFirst } from '../../lib/compareKpi';
import { isKpiOn, type KpiId, type KpiSettings } from '../../lib/kpiSettings';
import { numberText } from '../../lib/ownKpi';
import { serviceWord, type WeekBar } from '../../lib/serviceKpi';
import type { PersonTasks } from '../../lib/useTaskKpi';
import { utilisationPct } from '../../lib/taskKpi';
import { rebookingPct } from '../../lib/rebookingKpi';
import { averageText, feedbackState, formWord } from '../../lib/feedbackKpi';
import { npsState, scoreText, scoreWords, sharePct } from '../../lib/npsKpi';
import { RELATION_OF_KPI, reviewWord, roleState } from '../../lib/colleagueKpi';
import type { PersonColleagues } from '../../lib/useColleagueKpi';
import type { PersonFeedback } from '../../lib/useFeedbackKpi';
import type { PersonRebooking } from '../../lib/useRebookingKpi';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { Bars, KPI_COLORS, Pie, Ring } from './KpiCharts';
import { Card, CardLink, Compare, LegendRow, Message, SLATE, Stat, UNREAD, useCardMode } from './KpiUi';

// The KPI cards of the phone app: the same cards, numbers and words as the website's (admin-web/components/kpi/EmployeeKpiCards.tsx), one under
// the other. A card with nothing to show draws its own chart empty instead of writing a sentence; a card whose numbers could not be read says so.

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** What a ring card draws when there is nothing to show yet: the ring itself, empty, with dashes for the numbers. */
function EmptyRingBody({ aria, small, rows }: { aria: string; small?: string; rows: { color: string; label: string; bordered?: boolean }[] }) {
  return (
    <View>
      <View style={{ alignItems: 'center' }}>
        <Ring pct={0} size={156} stroke={16} aria={aria} big="–" small={small} />
      </View>
      <View style={st.legend}>
        {rows.map(r => (
          <LegendRow key={r.label} color={r.color} bordered={r.bordered} label={r.label} value="–" />
        ))}
      </View>
    </View>
  );
}

/** A bar for each rating from 5 stars to 1, with how many gave it. All empty when no form has a rating yet. */
function StarRows({ counts }: { counts: number[] }) {
  const top = Math.max(...counts, 1);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Ratings: ${[5, 4, 3, 2, 1].map(n => `${n} ${n === 1 ? 'star' : 'stars'} ${counts[n - 1]}`).join(', ')}`} style={[st.legend, { marginTop: 14 }]}>
      {[5, 4, 3, 2, 1].map(n => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ width: 54, fontSize: 12.5, color: SLATE[700] }}>
            {n} {n === 1 ? 'star' : 'stars'}
          </Text>
          <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.slate200, overflow: 'hidden' }}>
            <View style={{ width: `${(counts[n - 1] / top) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: KPI_COLORS.accent }} />
          </View>
          <Text style={{ width: 24, textAlign: 'right', fontSize: 12.5, fontWeight: '800', color: colors.ink }}>{counts[n - 1]}</Text>
        </View>
      ))}
    </View>
  );
}

/** A big number with a small caption beside it ("18 services this month so far"). */
function BigNumber({ value, caption, faint = false, suffix, label }: { value: string; caption?: string; faint?: boolean; suffix?: string; label?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <Text accessibilityLabel={label} style={[st.big, faint && { color: SLATE[300] }]}>
        {value}
      </Text>
      {suffix ? <Text style={st.bigSuffix}>{suffix}</Text> : null}
      {caption ? <Text style={st.caption}>{caption}</Text> : null}
    </View>
  );
}

/** A KPI the company added itself: the number typed in for this person for the month, as it was typed in, with a plain comparison against last
 * month's. There is nothing to chart: it is one number, so it is shown as one. */
export function OwnKpiCard({ eyebrow, name, data, monthName, previousName, notStarted }: {
  eyebrow: string;
  name: string;
  data: { loading: boolean; current: number | null; previous: number | null; error: string };
  monthName: string;
  previousName: string;
  notStarted: boolean;
}) {
  const mode = useCardMode();
  let body: React.ReactNode;
  if (!data.loading && !data.error && (notStarted || data.current == null)) {
    body = <BigNumber value="–" faint caption={`for ${monthName}`} label={notStarted ? 'This month has not started' : `Nothing typed in for ${mode.mine ? 'you in ' : ''}${monthName}`} />;
  } else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (data.current != null) body = <BigNumber value={numberText(data.current)} caption={`typed in for ${monthName}`} />;
  const footer = !notStarted && !data.loading && !data.error && data.current != null && data.previous != null ? <Compare change={compare(data.current, data.previous, { name: previousName, unit: 'number' })} /> : null;
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer}>
      {body}
    </Card>
  );
}

/** Attendance and punctuality: the month's working days as a pie of on time / late / absent, with the two percentages beside it. */
export function AttendanceCard({ eyebrow, name, current, previous, previousName, loading, notStarted }: {
  eyebrow: string;
  name: string;
  current: AttendanceKpi | null;
  previous: AttendanceKpi | null;
  previousName: string;
  loading: boolean;
  notStarted: boolean;
}) {
  const mode = useCardMode();
  let body: React.ReactNode;
  if (loading || !current) body = <Message title="Loading…" />;
  else if (!current.tracked) body = <Message title="Not tracked" text={mode.mine ? 'You are excused from attendance.' : 'This person is excused from attendance.'} />;
  else {
    const rates = attendanceRates(current);
    const onTime = current.presentDays - current.lateDays;
    const absent = current.expectedDays - current.presentDays;
    body = (
      <View style={{ gap: 16 }}>
        <View style={{ alignItems: 'center' }}>
          <Pie
            size={168}
            label
            aria={current.expectedDays === 0 ? 'No working days counted yet' : `Of ${dayCount(current.expectedDays)} of work: ${onTime} on time, ${current.lateDays} late, ${absent} absent`}
            slices={[
              { value: onTime, color: KPI_COLORS.good },
              { value: current.lateDays, color: KPI_COLORS.warn },
              { value: absent, color: KPI_COLORS.bad },
            ]}
          />
        </View>
        <View style={st.legend}>
          <LegendRow color={KPI_COLORS.good} label="On time" value={dayCount(onTime)} />
          <LegendRow color={KPI_COLORS.warn} label="Late" value={dayCount(current.lateDays)} />
          <LegendRow color={KPI_COLORS.bad} label="Absent" value={dayCount(absent)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 36 }}>
          <Stat big={rates.present == null ? '–' : `${rates.present}%`} label="present" />
          <Stat big={rates.onTime == null ? '–' : `${rates.onTime}%`} label="on time" />
        </View>
      </View>
    );
  }
  let footer: React.ReactNode = null;
  if (!loading && previous?.tracked) {
    if (previous.expectedDays === 0) footer = `${previousName}: no working days`;
    else {
      const pr = attendanceRates(previous);
      const cr = current && current.tracked && current.expectedDays > 0 ? attendanceRates(current) : null;
      footer =
        cr && cr.present != null && pr.present != null ? (
          <View style={{ gap: 4 }}>
            <Compare label="Present" change={compare(cr.present, pr.present, { name: previousName, unit: 'points', shown: `${pr.present}%` })} />
            {cr.onTime != null && pr.onTime != null && <Compare label="On time" change={compare(cr.onTime, pr.onTime, { name: previousName, unit: 'points', shown: `${pr.onTime}%` })} />}
          </View>
        ) : (
          `${previousName}: ${pr.present}% present, ${pr.onTime == null ? '–' : `${pr.onTime}%`} on time`
        );
    }
  }
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer} report="attendance" reportable={!loading && !notStarted && !!current?.tracked}>
      {body}
    </Card>
  );
}

/** Services performed: the tasks completed in the month (one task is one service), and bars of how many in each week. The week that is still
 * going is a pale bar. Under it, the whole of last month. With no task in the month it shows a dash. */
export function ServicesCard({ eyebrow, name, data, bars, monthName, previousName, thisMonthSoFar, notStarted }: {
  eyebrow: string;
  name: string;
  data: PersonTasks;
  bars: WeekBar[];
  monthName: string;
  previousName: string;
  thisMonthSoFar: boolean;
  notStarted: boolean;
}) {
  const total = data.dates.length;
  const partial = bars.some(b => b.partial);
  let body: React.ReactNode;
  if (!data.loading && !data.error && (notStarted || !data.monthHasData)) {
    body = (
      <View>
        <BigNumber value="–" faint caption={`services in ${monthName}`} />
        <Bars bars={bars} aria={notStarted ? `Services performed each week in ${monthName}: this month has not started` : `Services performed each week in ${monthName}: no tasks this month`} />
      </View>
    );
  } else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else {
    body = (
      <View>
        <BigNumber value={String(total)} caption={thisMonthSoFar ? `${serviceWord(total)} this month so far` : `${serviceWord(total)} in ${monthName}`} />
        <Bars bars={bars} aria={`Services performed each week in ${monthName}: ${bars.map(b => `${b.label} ${b.value}`).join(', ')}. Total ${total}.${partial ? ' The last bar is the week so far.' : ''}`} />
      </View>
    );
  }
  const showPrevious = !notStarted && !data.loading && !data.error && data.monthHasData && data.previousTotal != null;
  const footer =
    (showPrevious && data.previousTotal != null) || (partial && total > 0) ? (
      <View style={{ gap: 4 }}>
        {showPrevious && data.previousTotal != null && <Compare change={compareServices(total, data.previousTotal, previousName, !thisMonthSoFar)} />}
        {partial && total > 0 && <Text style={st.footerText}>The pale bar is the week so far.</Text>}
      </View>
    ) : null;
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer} report="services" reportable={!data.loading && !data.error && !notStarted && data.monthHasData}>
      {body}
    </Card>
  );
}

/** Rebooking rate: a ring of the share of this person's customers who booked again, with the two numbers beside it. */
export function RebookingCard({ eyebrow, name, data, monthName, previousName, notStarted }: {
  eyebrow: string;
  name: string;
  data: PersonRebooking;
  monthName: string;
  previousName: string;
  notStarted: boolean;
}) {
  const { words } = useKpiSettings();
  const cur = data.current;
  let body: React.ReactNode;
  if (!data.loading && !data.error && (notStarted || !cur)) {
    body = (
      <EmptyRingBody
        aria={notStarted ? 'This month has not started: nothing to show yet' : words.t(`0 percent: no customers served in ${monthName}`)}
        small="booked again"
        rows={[
          { color: KPI_COLORS.accent, label: 'Booked again' },
          { color: KPI_COLORS.track, label: 'Not yet', bordered: true },
        ]}
      />
    );
  } else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (cur) {
    const pct = rebookingPct(cur) ?? 0;
    body = (
      <View>
        <View style={{ alignItems: 'center' }}>
          <Ring pct={pct} size={156} stroke={16} aria={`${pct} percent: ${cur.back} of ${cur.served} ${cur.served === 1 ? words.one : words.many} booked again`} big={`${pct}%`} small="booked again" />
        </View>
        <View style={st.legend}>
          <LegendRow color={KPI_COLORS.accent} label="Booked again" value={String(cur.back)} />
          <LegendRow color={KPI_COLORS.track} bordered label="Not yet" value={String(cur.served - cur.back)} />
        </View>
      </View>
    );
  }
  const previousPct = data.previous ? rebookingPct(data.previous) : null;
  const currentPct = cur ? rebookingPct(cur) : null;
  const footer = !notStarted && !data.loading && !data.error && !data.reason && currentPct != null && previousPct != null ? <Compare change={compare(currentPct, previousPct, { name: previousName, unit: 'points', shown: `${previousPct}%` })} /> : null;
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer} report="rebooking" reportable={!data.loading && !data.error && !notStarted && !!cur}>
      {body}
    </Card>
  );
}

/** Hour utilisation per day: a ring of the share of this person's tasks that are done, out of the tasks that should be done by now (one task is
 * one service, however long it takes), with the two numbers beside it. Under it, last month. */
export function UtilisationCard({ eyebrow, name, data, monthName, previousName, notStarted }: {
  eyebrow: string;
  name: string;
  data: PersonTasks;
  monthName: string;
  previousName: string;
  notStarted: boolean;
}) {
  const cur = data.current;
  const pct = utilisationPct(cur);
  const prevPct = utilisationPct(data.previous);
  let body: React.ReactNode;
  if (!data.loading && !data.error && (notStarted || pct == null || !cur)) {
    body = (
      <EmptyRingBody
        aria={notStarted ? 'This month has not started: nothing to show yet' : `0 percent: no tasks due in ${monthName}`}
        small="of tasks"
        rows={[
          { color: KPI_COLORS.accent, label: 'Done' },
          { color: KPI_COLORS.track, label: 'Not done', bordered: true },
        ]}
      />
    );
  } else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (cur && pct != null) {
    body = (
      <View>
        <View style={{ alignItems: 'center' }}>
          <Ring pct={pct} size={156} stroke={16} aria={`${pct} percent: ${cur.done} of ${cur.assigned} tasks done`} big={`${pct}%`} small={`${cur.done} of ${cur.assigned} tasks`} />
        </View>
        <View style={st.legend}>
          <LegendRow color={KPI_COLORS.accent} label="Done" value={String(cur.done)} />
          <LegendRow color={KPI_COLORS.track} bordered label="Not done" value={String(cur.assigned - cur.done)} />
        </View>
      </View>
    );
  }
  const footer = !notStarted && !data.loading && !data.error && pct != null && prevPct != null ? <Compare change={compare(pct, prevPct, { name: previousName, unit: 'points', shown: `${prevPct}%` })} /> : null;
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer} report="utilisation" reportable={!data.loading && !data.error && !notStarted && pct != null}>
      {body}
    </Card>
  );
}

/** Customer feedback: the average rating out of 5 with how many forms it comes from, and a bar for each rating. It shows from the first form. */
export function FeedbackCard({ eyebrow, name, data, monthName, previousName, notStarted }: {
  eyebrow: string;
  name: string;
  data: PersonFeedback;
  monthName: string;
  previousName: string;
  notStarted: boolean;
}) {
  const mode = useCardMode();
  const state = feedbackState(data.current);
  let body: React.ReactNode;
  if (!data.loading && !data.error && (notStarted || !data.monthHasForms || state.kind === 'none')) {
    body = (
      <View>
        <BigNumber value="–" faint suffix="/ 5" label={notStarted ? 'This month has not started' : `No customer forms ${mode.mine ? 'for you ' : ''}in ${monthName}`} />
        <StarRows counts={[0, 0, 0, 0, 0]} />
      </View>
    );
  } else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (state.kind === 'ok') {
    const sm = state.summary;
    body = (
      <View>
        <BigNumber value={averageText(sm.average)} suffix="/ 5" caption={`from ${sm.count} ${formWord(sm.count)}`} />
        <StarRows counts={sm.byRating} />
      </View>
    );
  }
  const previous = feedbackState(data.previous);
  const footer = !notStarted && !data.loading && state.kind === 'ok' && previous.kind === 'ok' ? <Compare change={compare(state.summary.average, previous.summary.average, { name: previousName, unit: 'rating' })} /> : null;
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer} report="feedback" reportable={!data.loading && !data.error && !notStarted && state.kind === 'ok'}>
      {body}
      {!mode.mine && mode.typeInForm ? (
        <CardLink plus onPress={mode.typeInForm}>
          Type in a form
        </CardLink>
      ) : null}
      {mode.mine && mode.openFeedback ? <CardLink onPress={mode.openFeedback}>See your forms</CardLink> : null}
    </Card>
  );
}

/** NPS: a donut of who would recommend (9 or 10), who is neutral (7 or 8) and who is not likely (0 to 6), with the score in the middle (from
 * -100 to +100). It shows from the first form. */
export function NpsCard({ eyebrow, name, data, monthName, previousName, notStarted }: {
  eyebrow: string;
  name: string;
  data: PersonFeedback;
  monthName: string;
  previousName: string;
  notStarted: boolean;
}) {
  const mode = useCardMode();
  const state = npsState(data.nps);
  let body: React.ReactNode;
  if (!data.loading && !data.error && (notStarted || !data.monthHasNps || state.kind === 'none')) {
    body = (
      <View>
        <View style={{ alignItems: 'center' }}>
          <Pie size={156} hole={52} gap={3} aria={notStarted ? 'This month has not started: nothing to show yet' : `NPS: no recommend numbers ${mode.mine ? 'for you ' : ''}in ${monthName}`} slices={[]}>
            <SvgText x={78} y={80} textAnchor="middle" fontSize={28} fontWeight="800" fill="#0f172a">
              –
            </SvgText>
            <SvgText x={78} y={98} textAnchor="middle" fontSize={12} fill="#475569">
              NPS
            </SvgText>
          </Pie>
        </View>
        <View style={st.legend}>
          <LegendRow color={KPI_COLORS.good} label="Would recommend" value="–" />
          <LegendRow color={KPI_COLORS.warn} label="Neutral" value="–" />
          <LegendRow color={KPI_COLORS.bad} label="Not likely" value="–" />
        </View>
      </View>
    );
  } else if (data.loading) body = <Message title="Loading…" />;
  else if (data.error) body = <Message title={UNREAD.title} text={UNREAD.text} />;
  else if (state.kind === 'ok') {
    const sm = state.summary;
    body = (
      <View>
        <View style={{ alignItems: 'center' }}>
          <Pie
            size={156}
            hole={52}
            gap={3}
            aria={`NPS ${scoreWords(sm.score)}: ${sm.promoters} would recommend, ${sm.passives} neutral, ${sm.detractors} not likely`}
            slices={[
              { value: sm.promoters, color: KPI_COLORS.good },
              { value: sm.passives, color: KPI_COLORS.warn },
              { value: sm.detractors, color: KPI_COLORS.bad },
            ]}
          >
            <SvgText x={78} y={80} textAnchor="middle" fontSize={28} fontWeight="800" fill="#0f172a">
              {scoreText(sm.score)}
            </SvgText>
            <SvgText x={78} y={98} textAnchor="middle" fontSize={12} fill="#475569">
              NPS
            </SvgText>
          </Pie>
        </View>
        <View style={st.legend}>
          <LegendRow color={KPI_COLORS.good} label="Would recommend" value={`${sm.promoters} · ${sharePct(sm.promoters, sm.count)}%`} />
          <LegendRow color={KPI_COLORS.warn} label="Neutral" value={`${sm.passives} · ${sharePct(sm.passives, sm.count)}%`} />
          <LegendRow color={KPI_COLORS.bad} label="Not likely" value={`${sm.detractors} · ${sharePct(sm.detractors, sm.count)}%`} />
        </View>
      </View>
    );
  }
  const previous = npsState(data.npsPrevious);
  const footer = !notStarted && !data.loading && state.kind === 'ok' && previous.kind === 'ok' ? <Compare change={compare(state.summary.score, previous.summary.score, { name: previousName, unit: 'points', shown: scoreText(previous.summary.score) })} /> : null;
  return (
    <Card eyebrow={eyebrow} name={name} footer={footer} report="nps" reportable={!data.loading && !data.error && !notStarted && state.kind === 'ok'}>
      {body}
    </Card>
  );
}

const COLLEAGUES: { id: KpiId; label: string }[] = [
  { id: 'peers', label: 'Feedback from peers' },
  { id: 'manager', label: 'Feedback from immediate manager' },
  { id: 'clevel', label: 'Feedback from C-level' },
  { id: 'training', label: 'Feedback from training and compliance' },
];

/** The four colleague-feedback KPIs on one scale of 0 to 5: the average rating from peers, from the manager, from the C-level executive and from
 * training and compliance. A role shows from its first review. Under each, how many reviews it is and last month's average. */
export function ColleagueCard({ group, settings, data, previousName, notStarted }: {
  group: KpiGroup;
  settings: KpiSettings;
  data: PersonColleagues;
  previousName: string;
  notStarted: boolean;
}) {
  const mode = useCardMode();
  const rows = COLLEAGUES.filter(c => isKpiOn(c.id, settings)).map(c => ({ id: c.id, label: settings.names[c.id] ?? c.label, relation: RELATION_OF_KPI[c.id as keyof typeof RELATION_OF_KPI] }));
  if (data.loading) {
    return (
      <Card eyebrow={group.title} name="Feedback from colleagues">
        <Message title="Loading…" />
      </Card>
    );
  }
  const anyFeedback = rows.some(r => roleState(data.current?.[r.relation]).kind === 'ok');
  return (
    <Card eyebrow={group.title} name="Feedback from colleagues" report="colleagues" reportable={!data.error && !notStarted && anyFeedback}>
      <View>
        {rows.map(({ id, label, relation }) => {
          const state = roleState(data.current?.[relation]);
          const last = roleState(data.previous?.[relation]);
          let meta: string;
          if (data.error) meta = UNREAD.title;
          else if (state.kind === 'none') meta = '';
          else meta = `${state.given} ${reviewWord(state.given)}${last.kind === 'ok' ? ` · ${lowerFirst(compare(state.average, last.average, { name: previousName, unit: 'rating' }).text)}` : ''}`;
          return (
            <View key={id} style={st.colRow}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.colName}>{label}</Text>
                  {meta ? <Text style={st.colMeta}>{meta}</Text> : null}
                </View>
                <Text style={st.colValue}>
                  {state.kind === 'ok' ? averageText(state.average) : <Text style={{ color: colors.slate400 }}>–</Text>}
                  {state.kind === 'ok' ? <Text style={{ fontSize: 13, fontWeight: '600', color: SLATE[600] }}> / 5</Text> : null}
                </Text>
              </View>
              <View style={st.track}>
                {[0, 1, 2, 3, 4, 5].map(n => (
                  <View key={n} style={[st.tick, { left: `${n * 20}%` }]} />
                ))}
                {state.kind === 'ok' && (
                  <View
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={`${label}: ${averageText(state.average)} out of 5 from ${state.given} ${reviewWord(state.given)}`}
                    style={[st.fill, { width: `${(state.average / 5) * 100}%` }]}
                  />
                )}
              </View>
            </View>
          );
        })}
      </View>
      {mode.mine && mode.openFeedback ? <CardLink onPress={mode.openFeedback}>See what colleagues said, and give feedback</CardLink> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  legend: { marginTop: 14, gap: 8 },
  big: { fontSize: 34, fontWeight: '800', color: colors.ink, lineHeight: 38 },
  bigSuffix: { fontSize: 15, fontWeight: '600', color: SLATE[600] },
  caption: { fontSize: 12.5, color: SLATE[600] },
  footerText: { fontSize: 12, color: SLATE[600] },
  colRow: { borderTopWidth: 1, borderTopColor: colors.slate200, paddingVertical: 12, gap: 8 },
  colName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  colMeta: { fontSize: 12.5, color: SLATE[600], marginTop: 2 },
  colValue: { fontSize: 24, fontWeight: '800', color: colors.ink, minWidth: 74, textAlign: 'right' },
  track: { height: 18, position: 'relative' },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.slate200 },
  fill: { position: 'absolute', left: 0, top: 3, height: 12, borderTopRightRadius: 6, borderBottomRightRadius: 6, backgroundColor: KPI_COLORS.accent },
});
