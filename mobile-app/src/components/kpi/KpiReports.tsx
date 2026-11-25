import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../theme';
import { formatAdDate } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { attendanceRates, type AttendanceDayStatus, type AttendanceKpi } from '../../lib/kpi';
import { kpiLabel } from '../../lib/kpiSettings';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { daysBetween } from '../../lib/rebookingKpi';
import type { ReportKind } from '../../lib/reportKpi';
import { useReportRebooking } from '../../lib/useKpiReport';
import { useReportTasks } from '../../lib/useTaskKpi';
import { countTasks, doneByTitle, tasksByDay, utilisationPct } from '../../lib/taskKpi';
import { nepalTodayIso } from '../../lib/shift';
import { weekdayName } from '../../lib/taskClock';
import { useFeedbackAbout, useMyCustomerForms, useMyFeedback, type FeedbackRead, type MyCustomerForm } from '../../lib/useFeedback';
import { averageText, formWord, summariseRatings } from '../../lib/feedbackKpi';
import { scoreText, summariseNps } from '../../lib/npsKpi';
import { RELATION_LABEL, feedbackCount, ratingWord, summariseReport } from '../../lib/colleagueFeedback';
import type { GuestAnchor } from '../../lib/guestHistory';
import { GiverLabel, NamesProblem } from './FeedbackReport';
import { GuestHistoryBody, GuestName, GuestOpenContext } from './GuestHistory';
import { KPI_COLORS } from './KpiCharts';
import { Sheet, SLATE } from './KpiUi';

// The report behind one KPI card, in a sheet: the same reports as the website's pop-ups (admin-web/components/kpi/KpiReports.tsx). Each reads
// nothing until it is open. An employee reads only their own rows; an admin reads the person's.

/** What a report needs to know about the screen it was opened from. */
export type ReportContext = {
  employeeId: string;
  /** The month on screen as AD date keys, and its name ("Mangsir 2083", "November 2026"). */
  start: string;
  end: string;
  monthLabel: string;
  /** Whose KPIs: a name on an admin's screen, "You" on the employee's own. */
  personName: string;
  mine: boolean;
  today: string;
  attendance: AttendanceKpi | null;
};

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

function useDayLabel() {
  const { system } = useCalendarSystem();
  return (date: string) => `${weekdayName(date)}, ${formatAdDate(date, system)}`;
}

/** "9:05 AM" from a punch time. */
const clock = (value: string | null | undefined) => (value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–');

function Tiles({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <View style={r.tiles}>
      {items.map(t => (
        <View key={t.label} style={r.tile}>
          <Text style={r.tileValue}>{t.value}</Text>
          <Text style={r.tileLabel}>{t.label}</Text>
          {t.note ? <Text style={r.tileNote}>{t.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Bar({ pct, color = KPI_COLORS.accent }: { pct: number; color?: string }) {
  return (
    <View style={r.barTrack}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

const Heading = ({ children }: { children: string }) => (
  <Text style={r.heading} accessibilityRole="header">
    {children}
  </Text>
);

/** Loading, or why it could not be read, or the report itself. */
function Gate({ loading, error, children }: { loading: boolean; error: string; children: React.ReactNode }) {
  if (loading) return <Text style={r.loading}>Loading…</Text>;
  if (error) {
    return (
      <View accessibilityRole="alert" style={r.alert}>
        <Text style={r.alertText}>{error}</Text>
      </View>
    );
  }
  return <>{children}</>;
}

const Empty = ({ children }: { children: string }) => <Text style={r.empty}>{children}</Text>;

const Stars = ({ rating }: { rating: number | null }) =>
  rating == null ? (
    <Text style={{ fontSize: 12.5, color: colors.slate500 }}>No rating</Text>
  ) : (
    <Text accessibilityLabel={`Rating ${rating} of 5`} style={{ fontSize: 15, letterSpacing: 1, color: KPI_COLORS.warn }}>
      {'★'.repeat(rating)}
      <Text style={{ color: '#cbd5e1' }}>{'★'.repeat(5 - rating)}</Text>
    </Text>
  );

/** One row of a list: the main line (day), a second line of small facts, and what sits on the right. */
function Row({ title, children, right }: { title: string; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={r.row}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={r.rowTitle}>{title}</Text>
        {children ? <View style={r.rowFacts}>{children}</View> : null}
      </View>
      {right}
    </View>
  );
}

const Pill = ({ text, bg, fg }: { text: string; bg: string; fg: string }) => <Text style={[r.pill, { backgroundColor: bg, color: fg }]}>{text}</Text>;
const Fact = ({ children }: { children: React.ReactNode }) => <Text style={r.fact}>{children}</Text>;

// ---------------------------------------------------------------------------
// Attendance and punctuality: every day of the month
// ---------------------------------------------------------------------------

const STATUS: Record<AttendanceDayStatus, { label: string; bg: string; fg: string }> = {
  on_time: { label: 'On time', bg: '#f0fdfa', fg: '#115e59' },
  late: { label: 'Late', bg: '#fffbeb', fg: '#92400e' },
  absent: { label: 'Absent', bg: '#fff1f2', fg: '#9f1239' },
  leave: { label: 'On leave', bg: '#f0f9ff', fg: '#075985' },
  off: { label: 'Day off', bg: colors.slate100, fg: SLATE[600] },
};

function AttendanceReport({ ctx }: { ctx: ReportContext }) {
  const day = useDayLabel();
  const a = ctx.attendance;
  if (!a) return <Text style={r.loading}>Loading…</Text>;
  if (!a.tracked) return <Empty>{ctx.mine ? 'You are excused from attendance, so there is nothing to report.' : 'This person is excused from attendance, so there is nothing to report.'}</Empty>;
  const count = (s: AttendanceDayStatus) => a.days.filter(d => d.status === s).length;
  const rates = attendanceRates(a);
  return (
    <View>
      <Tiles
        items={[
          { label: 'On time', value: String(count('on_time')), note: rates.onTime != null ? `${rates.onTime}% of days at work` : undefined },
          { label: 'Late', value: String(count('late')) },
          { label: 'Absent', value: String(count('absent')), note: rates.present != null ? `${rates.present}% present` : undefined },
          { label: 'On leave', value: String(count('leave')) },
        ]}
      />
      {a.days.length === 0 ? (
        <Empty>{`No days to show yet in ${ctx.monthLabel}.`}</Empty>
      ) : (
        a.days.map(d => (
          <Row
            key={d.date}
            title={day(d.date)}
            right={
              <Text style={r.inOut}>
                {d.checkIn ? clock(d.checkIn) : '–'} → {d.checkIn && !d.checkOut ? 'none' : d.checkOut ? clock(d.checkOut) : '–'}
              </Text>
            }
          >
            <Pill text={STATUS[d.status].label} bg={STATUS[d.status].bg} fg={STATUS[d.status].fg} />
            {d.status === 'late' && d.lateMinutes > 0 ? <Fact>{d.lateMinutes} min late</Fact> : null}
            {d.status === 'off' && d.checkIn ? <Fact>worked</Fact> : null}
            {d.status === 'absent' && d.date === ctx.today ? <Fact>so far today</Fact> : null}
          </Row>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Services performed: the tasks done, by task and by day
// ---------------------------------------------------------------------------

function ServicesReport({ ctx }: { ctx: ReportContext }) {
  const day = useDayLabel();
  const { tasks, loading, error } = useReportTasks(ctx.employeeId, ctx.start, ctx.end, true);
  const now = Date.now();
  const titles = doneByTitle(tasks, ctx.start, ctx.end, now);
  const doneDays = tasksByDay(tasks, ctx.start, ctx.end, now, nepalTodayIso()).filter(d => d.done > 0);
  const total = titles.reduce((n, t) => n + t.count, 0);
  const topCount = titles[0]?.count ?? 1;
  return (
    <Gate loading={loading} error={error}>
      {total === 0 ? (
        <Empty>{`No tasks done ${ctx.mine ? 'by you ' : ''}in ${ctx.monthLabel}.`}</Empty>
      ) : (
        <View>
          <Tiles items={[{ label: 'Services (tasks done)', value: String(total), note: `on ${doneDays.length} ${doneDays.length === 1 ? 'day' : 'days'}` }, { label: 'Kinds of task', value: String(titles.length) }]} />
          <Heading>By task</Heading>
          {titles.map(t => (
            <View key={t.title} style={r.row}>
              <Text style={[r.rowTitle, { flex: 1 }]}>{t.title}</Text>
              <View style={{ width: 90 }}>
                <Bar pct={(t.count / topCount) * 100} />
              </View>
              <Text style={r.count}>{t.count}</Text>
            </View>
          ))}
          <Heading>Day by day</Heading>
          {doneDays.map(d => (
            <View key={d.date} style={r.row}>
              <Text style={[r.rowTitle, { flex: 1 }]}>{day(d.date)}</Text>
              <Text style={r.count}>{d.done}</Text>
            </View>
          ))}
        </View>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Rebooking rate: the guests served and who came back
// ---------------------------------------------------------------------------

function RebookingReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { guests, loading, error } = useReportRebooking({ employeeId: ctx.employeeId, start: ctx.start, end: ctx.end, mine: ctx.mine, enabled: true });
  const back = guests.filter(g => g.state === 'back').length;
  const pct = guests.length > 0 ? Math.round((back / guests.length) * 100) : null;
  return (
    <Gate loading={loading} error={error}>
      {guests.length === 0 ? (
        <Empty>{words.t(`No customers ${ctx.mine ? 'you ' : ''}served in ${ctx.monthLabel}.`)}</Empty>
      ) : (
        <View>
          <Tiles
            items={[
              { label: words.t('Customers served'), value: String(guests.length) },
              { label: 'Booked again', value: String(back), note: pct != null ? `${pct}% of them` : undefined },
              { label: 'Not yet', value: String(guests.length - back) },
            ]}
          />
          {guests.map((g, i) => (
            <View key={g.key} style={r.formRow}>
              {g.name ? <GuestRowName name={g.name} anchorId={g.anchorId} /> : <Text style={r.rowTitle}>{`${words.One} ${i + 1}`}</Text>}
              <View style={r.rowFacts}>
              <Fact>First visit {day(g.first)}</Fact>
              <Fact>
                {g.visits} {g.visits === 1 ? 'visit' : 'visits'}
              </Fact>
              {g.state === 'back' && g.returnedOn ? (
                <Text style={[r.fact, { color: '#115e59', fontWeight: '700' }]}>
                  Came back {day(g.returnedOn)} · {dayCount(daysBetween(g.first, g.returnedOn))} later
                </Text>
              ) : (
                <Fact>Not yet</Fact>
              )}
              </View>
            </View>
          ))}
        </View>
      )}
    </Gate>
  );
}

/** The guests' names are tappable; this wraps a row's name so the history opens (the guest list above shows the plain name when there is no row to open from). */
export function GuestRowName({ name, anchorId }: { name: string; anchorId: string | null }) {
  return <GuestName name={name} anchor={anchorId ? { serviceId: anchorId } : null} big />;
}

// ---------------------------------------------------------------------------
// Utilisation: tasks done of tasks due, day by day
// ---------------------------------------------------------------------------

function UtilisationReport({ ctx }: { ctx: ReportContext }) {
  const day = useDayLabel();
  const { tasks, loading, error } = useReportTasks(ctx.employeeId, ctx.start, ctx.end, true);
  const now = Date.now();
  const today = nepalTodayIso();
  const lines = tasksByDay(tasks, ctx.start, ctx.end, now, today);
  const c = countTasks(tasks, ctx.start, ctx.end, now, today).get(ctx.employeeId);
  const pct = utilisationPct(c);
  return (
    <Gate loading={loading} error={error}>
      {!c || pct == null ? (
        <Empty>{`No tasks due ${ctx.mine ? 'for you ' : ''}in ${ctx.monthLabel} yet.`}</Empty>
      ) : (
        <View>
          <Tiles
            items={[
              { label: 'Utilisation', value: `${pct}%` },
              { label: 'Tasks done', value: String(c.done) },
              { label: 'Tasks due', value: String(c.assigned), note: c.assigned - c.done > 0 ? `${c.assigned - c.done} not done` : 'all done' },
            ]}
          />
          {lines.map(l => (
            <View key={l.date} style={r.row}>
              <Text style={[r.rowTitle, { flex: 1 }]}>{day(l.date)}</Text>
              <Text style={r.fact}>
                {l.done} of {l.assigned}
              </Text>
              <View style={{ width: 70 }}>
                <Bar pct={l.pct} />
              </View>
              <Text style={[r.count, { width: 44 }]}>{l.pct}%</Text>
            </View>
          ))}
        </View>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Guest feedback and NPS: the forms
// ---------------------------------------------------------------------------

function useForms(ctx: ReportContext) {
  return useMyCustomerForms(ctx.employeeId, ctx.start, ctx.end);
}

const FormComment = ({ f }: { f: MyCustomerForm }) => (f.comment ? <Text style={r.comment}>{f.comment}</Text> : <Text style={r.noComment}>No comment.</Text>);
const FormGuest = ({ f }: { f: MyCustomerForm }) => (f.guest_name ? <GuestName name={f.guest_name} anchor={{ feedbackId: f.id }} /> : null);

function GuestFeedbackReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { forms, loading, error, namesError } = useForms(ctx);
  const summary = summariseRatings(forms.map(f => f.rating));
  const top = summary ? Math.max(...summary.byRating, 1) : 1;
  return (
    <Gate loading={loading} error={error}>
      {forms.length === 0 ? (
        <Empty>{words.t(`No customer forms ${ctx.mine ? 'for you ' : ''}in ${ctx.monthLabel}.`)}</Empty>
      ) : (
        <View>
          <Tiles items={[{ label: 'Average rating', value: summary ? `${averageText(summary.average)} / 5` : '–', note: summary ? `from ${summary.count} ${formWord(summary.count)}` : 'no ratings' }, { label: 'Forms', value: String(forms.length) }]} />
          {summary && (
            <View accessible accessibilityRole="image" accessibilityLabel={`Ratings: ${[5, 4, 3, 2, 1].map(n => `${n} ${n === 1 ? 'star' : 'stars'} ${summary.byRating[n - 1]}`).join(', ')}`} style={{ gap: 6, marginBottom: 6 }}>
              {[5, 4, 3, 2, 1].map(n => (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ width: 52, fontSize: 12.5, color: SLATE[700] }}>
                    {n} {n === 1 ? 'star' : 'stars'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Bar pct={(summary.byRating[n - 1] / top) * 100} />
                  </View>
                  <Text style={r.count}>{summary.byRating[n - 1]}</Text>
                </View>
              ))}
            </View>
          )}
          <Heading>The forms</Heading>
          <NamesProblem text={namesError} />
          {forms.map(f => (
            <View key={f.id} style={r.formRow}>
              <View style={r.rowFacts}>
                <FormGuest f={f} />
                <Text style={[r.fact, { fontWeight: '700', color: SLATE[700] }]}>{day(f.given_on)}</Text>
                <Stars rating={f.rating} />
                {f.recommend != null ? <Fact>Would recommend: {f.recommend} out of 10</Fact> : null}
                {f.reference ? <Fact>{f.reference}</Fact> : null}
              </View>
              <FormComment f={f} />
            </View>
          ))}
        </View>
      )}
    </Gate>
  );
}

function NpsReport({ ctx }: { ctx: ReportContext }) {
  const { words } = useKpiSettings();
  const day = useDayLabel();
  const { forms, loading, error, namesError } = useForms(ctx);
  const withNumber = forms.filter(f => f.recommend != null);
  const nps = summariseNps(withNumber.map(f => f.recommend));
  const kind = (n: number) => (n >= 9 ? { label: 'Would recommend', bg: '#f0fdfa', fg: '#115e59' } : n >= 7 ? { label: 'Neutral', bg: '#fffbeb', fg: '#92400e' } : { label: 'Not likely', bg: '#fff1f2', fg: '#9f1239' });
  return (
    <Gate loading={loading} error={error}>
      {!nps ? (
        <Empty>{words.t(`No recommend numbers ${ctx.mine ? 'for you ' : ''}in ${ctx.monthLabel}.`)}</Empty>
      ) : (
        <View>
          <Tiles
            items={[
              { label: 'NPS', value: scoreText(nps.score), note: `from ${nps.count} ${formWord(nps.count)}` },
              { label: 'Would recommend', value: String(nps.promoters), note: '9 or 10' },
              { label: 'Neutral', value: String(nps.passives), note: '7 or 8' },
              { label: 'Not likely', value: String(nps.detractors), note: '0 to 6' },
            ]}
          />
          <Heading>The numbers given</Heading>
          <NamesProblem text={namesError} />
          {withNumber.map(f => {
            const k = kind(f.recommend as number);
            return (
              <View key={f.id} style={r.formRow}>
                <View style={r.rowFacts}>
                  <FormGuest f={f} />
                  <Text style={[r.fact, { fontWeight: '700', color: SLATE[700] }]}>{day(f.given_on)}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: colors.ink }}>
                    {f.recommend} <Text style={{ fontSize: 12, fontWeight: '500', color: SLATE[600] }}>out of 10</Text>
                  </Text>
                  <Pill text={k.label} bg={k.bg} fg={k.fg} />
                  {f.reference ? <Fact>{f.reference}</Fact> : null}
                </View>
                <FormComment f={f} />
              </View>
            );
          })}
        </View>
      )}
    </Gate>
  );
}

// ---------------------------------------------------------------------------
// Feedback from colleagues: each piece, with who gave it
// ---------------------------------------------------------------------------

function ColleagueBody({ read, ctx }: { read: FeedbackRead; ctx: ReportContext }) {
  const day = useDayLabel();
  const report = summariseReport(read.items);
  return (
    <Gate loading={read.loading} error={read.error}>
      {read.items.length === 0 ? (
        <Empty>{`No feedback from colleagues ${ctx.mine ? 'for you ' : ''}in ${ctx.monthLabel}.`}</Empty>
      ) : (
        <View>
          <Tiles items={report.roles.map(x => ({ label: RELATION_LABEL[x.relation], value: x.average != null ? `${x.average.toFixed(1)} / 5` : '–', note: x.count > 0 ? `${x.count} ${x.count === 1 ? 'review' : 'reviews'}` : 'none' }))} />
          <Heading>{feedbackCount(report.count)}</Heading>
          <NamesProblem text={read.namesError} />
          {read.items.map(i => (
            <View key={i.id} style={r.formRow}>
              <View style={r.rowFacts}>
                <GiverLabel item={i} />
                <Text style={[r.fact, { fontWeight: '700', color: SLATE[700] }]}>{day(i.given_on)}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.ink }}>{i.rating} / 5</Text>
                <Fact>{ratingWord(i.rating)}</Fact>
              </View>
              {i.comment ? <Text style={r.comment}>{i.comment}</Text> : <Text style={r.noComment}>No comment.</Text>}
            </View>
          ))}
        </View>
      )}
    </Gate>
  );
}
// An admin reads the table; an employee goes through the function that hands over only their own feedback. Both then read who gave it.
const ColleaguesAdmin = ({ ctx }: { ctx: ReportContext }) => <ColleagueBody read={useFeedbackAbout(ctx.employeeId, ctx.start, ctx.end)} ctx={ctx} />;
const ColleaguesMine = ({ ctx }: { ctx: ReportContext }) => <ColleagueBody read={useMyFeedback(ctx.start, ctx.end)} ctx={ctx} />;

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/** The report behind one KPI card, in a sheet. It reads nothing until it is open. */
export default function KpiReportDialog({ kind, ctx, onClose }: { kind: ReportKind; ctx: ReportContext; onClose: () => void }) {
  const { settings, words } = useKpiSettings();
  // A guest's name in the report opens their history here, in place of the report (which stays loaded behind it).
  const [guest, setGuest] = useState<{ anchor: GuestAnchor; name: string } | null>(null);
  const head: Record<ReportKind, { eyebrow: string; title: string }> = {
    attendance: { eyebrow: 'Attendance', title: kpiLabel('attendance', settings) },
    services: { eyebrow: 'Services', title: kpiLabel('services', settings, 'Number of services performed') },
    rebooking: { eyebrow: 'Services', title: kpiLabel('rebooking', settings) },
    utilisation: { eyebrow: 'Services', title: kpiLabel('utilisation', settings) },
    feedback: { eyebrow: words.Many, title: kpiLabel('feedback', settings) },
    nps: { eyebrow: words.Many, title: kpiLabel('nps', settings) },
    colleagues: { eyebrow: 'Colleagues', title: 'Feedback from colleagues' },
  };
  return (
    <Sheet eyebrow={guest ? words.One : head[kind].eyebrow} title={guest ? guest.name : head[kind].title} subtitle={guest ? undefined : `${ctx.personName} · ${ctx.monthLabel}`} onClose={onClose}>
      {guest && (
        <View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Back to ${head[kind].title}`} onPress={() => setGuest(null)} style={r.back}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M15 6l-6 6 6 6" />
            </Svg>
            <Text style={r.backText}>Back to {head[kind].title}</Text>
          </TouchableOpacity>
          <GuestHistoryBody anchor={guest.anchor} />
        </View>
      )}
      {/* The report stays mounted behind the guest's history, so "Back" returns to it as it was. */}
      <View style={guest ? { display: 'none' } : undefined}>
        <GuestOpenContext.Provider value={(anchor, name) => setGuest({ anchor, name })}>
          {kind === 'attendance' && <AttendanceReport ctx={ctx} />}
          {kind === 'services' && <ServicesReport ctx={ctx} />}
          {kind === 'rebooking' && <RebookingReport ctx={ctx} />}
          {kind === 'utilisation' && <UtilisationReport ctx={ctx} />}
          {kind === 'feedback' && <GuestFeedbackReport ctx={ctx} />}
          {kind === 'nps' && <NpsReport ctx={ctx} />}
          {kind === 'colleagues' && (ctx.mine ? <ColleaguesMine ctx={ctx} /> : <ColleaguesAdmin ctx={ctx} />)}
        </GuestOpenContext.Provider>
      </View>
    </Sheet>
  );
}

const r = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  tile: { width: '47.5%', borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50, paddingHorizontal: 14, paddingVertical: 12 },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.ink },
  tileLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink, marginTop: 4 },
  tileNote: { fontSize: 11.5, color: SLATE[600], marginTop: 2 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.slate200, overflow: 'hidden', minWidth: 56 },
  heading: { fontSize: 13, fontWeight: '800', color: colors.ink, marginTop: 12, marginBottom: 6 },
  loading: { textAlign: 'center', paddingVertical: 32, fontSize: 14, color: SLATE[600] },
  alert: { borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50, padding: 16 },
  alertText: { fontSize: 14, fontWeight: '700', color: SLATE[700] },
  empty: { borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: SLATE[300], paddingVertical: 28, paddingHorizontal: 16, textAlign: 'center', fontSize: 14, color: SLATE[600] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  rowFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  fact: { fontSize: 12.5, color: SLATE[600] },
  count: { fontSize: 14, fontWeight: '800', color: colors.ink, minWidth: 28, textAlign: 'right' },
  pill: { fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  inOut: { fontSize: 12.5, color: SLATE[700] },
  formRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.slate100, gap: 5 },
  comment: { fontSize: 14, lineHeight: 20, color: colors.ink },
  noComment: { fontSize: 14, fontStyle: 'italic', color: colors.slate500 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  backText: { fontSize: 14, fontWeight: '800', color: colors.accent },
});

