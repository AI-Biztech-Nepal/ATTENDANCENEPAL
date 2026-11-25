import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme';
import { formatAdDate } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { RELATION_FROM, RELATION_LABEL, RELATION_ONE, feedbackCount, giverWords, ratingWord, summariseReport, type FeedbackItem } from '../../lib/colleagueFeedback';
import { averageText, formWord, summariseRatings } from '../../lib/feedbackKpi';
import type { FeedbackRead, MyCustomerForm } from '../../lib/useFeedback';
import { GuestName } from './GuestHistory';
import { SLATE } from './KpiUi';

// What colleagues said about a person (with who gave each piece) and the customer forms typed in about them, laid out as reports. Used on the
// employee's own Feedback screen and on an admin's Colleague reviews section for the person whose page it is. Same as
// admin-web/components/kpi/FeedbackReport.tsx.

/** The rating as a round number with its word under it, the same number the form gave it with. */
export function RatingBadge({ rating }: { rating: number | null }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={rating == null ? 'No rating' : `Rating ${rating} of 5, ${ratingWord(rating)}`} style={s.badge}>
      <View style={s.badgeCircle}>
        <Text style={s.badgeNumber}>{rating ?? '–'}</Text>
      </View>
      <Text style={s.badgeWord}>{rating == null ? '' : ratingWord(rating)}</Text>
    </View>
  );
}

/** Who gave a piece of colleague feedback: their name and what kind of colleague they are, or just the kind when the name is not on file. */
export function GiverLabel({ item }: { item: FeedbackItem }) {
  if (!item.giver_name) return <Text style={s.pill}>{RELATION_FROM[item.relation]}</Text>;
  return (
    <>
      <Text style={s.giver}>{item.giver_name}</Text>
      <Text style={s.pill}>{RELATION_ONE[item.relation]}</Text>
    </>
  );
}

/** Why the names could not be read; the feedback is still shown without them. */
export function NamesProblem({ text }: { text: string }) {
  if (!text) return null;
  return (
    <View accessibilityRole="alert" style={s.namesProblem}>
      <Text style={s.namesProblemText}>{text}</Text>
    </View>
  );
}

/**
 * The feedback colleagues gave a person, as a report about them: how much and how it averaged from each kind of colleague, then every piece of
 * feedback with its rating, who gave it, the day and the comment. `actions` are the buttons for the report (Give feedback, who is C-level);
 * with `onRemove` (an admin's page) each piece has a Remove button.
 */
export function FeedbackReport({ title, periodLabel, read, subject, actions, onRemove, removing = null }: {
  title: string;
  periodLabel: string;
  read: FeedbackRead;
  /** Who the report is about, for the empty sentence ("you", or a name). */
  subject: { you: boolean; name: string };
  actions?: React.ReactNode;
  onRemove?: (item: FeedbackItem) => void;
  removing?: string | null;
}) {
  const { system } = useCalendarSystem();
  const report = summariseReport(read.items);
  const who = subject.you ? 'you' : subject.name;
  return (
    <View accessibilityLabel={title} style={s.card}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={s.sub}>{read.loading ? 'Loading…' : `${periodLabel} · ${feedbackCount(report.count)}`}</Text>
        {actions ? <View style={s.actions}>{actions}</View> : null}
      </View>

      {read.error ? (
        <View accessibilityRole="alert" style={s.errorBox}>
          <Text style={s.errorText}>{read.error}</Text>
        </View>
      ) : null}

      {!read.error && !read.loading && (
        <>
          <View accessibilityLabel="Feedback by kind of colleague" style={s.kinds}>
            {report.roles.map(r => (
              <View key={r.relation} style={s.kind}>
                <Text style={s.kindName}>{RELATION_LABEL[r.relation]}</Text>
                <Text style={s.kindValue}>
                  {r.average == null ? '–' : r.average.toFixed(1)}
                  {r.average != null ? <Text style={s.kindOf}> / 5</Text> : null}
                </Text>
                <Text style={s.kindCount}>{r.count === 0 ? 'No feedback' : `${r.count} ${r.count === 1 ? 'review' : 'reviews'}`}</Text>
              </View>
            ))}
          </View>

          {read.items.length > 0 && <NamesProblem text={read.namesError} />}
          {read.items.length === 0 ? (
            <Text style={s.empty}>
              Nobody has given {who} feedback in {periodLabel} yet.
            </Text>
          ) : (
            <View accessibilityLabel={`What colleagues said in ${periodLabel}`}>
              {read.items.map(item => (
                <View key={item.id} style={s.item}>
                  <RatingBadge rating={item.rating} />
                  <View style={{ flex: 1 }}>
                    <View style={s.itemLine}>
                      <GiverLabel item={item} />
                      <Text style={s.itemDay}>{formatAdDate(item.given_on, system)}</Text>
                    </View>
                    {item.comment ? <Text style={s.comment}>{item.comment}</Text> : <Text style={s.noComment}>No comment.</Text>}
                    {onRemove ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Remove the feedback from ${giverWords(item)} on ${formatAdDate(item.given_on, system)}`}
                        disabled={removing !== null}
                        onPress={() => onRemove(item)}
                        style={[s.remove, removing !== null && { opacity: 0.5 }]}
                      >
                        <Text style={s.removeText}>{removing === item.id ? 'Removing…' : 'Remove'}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** The customer forms typed in about the signed-in person, to read: the guest's name (tap it for the guest's history), the day, the rating. There
 * is nothing to edit here: the forms are typed in and changed by the admin only. */
export function CustomerFormsReport({ periodLabel, forms, loading, error, namesError }: { periodLabel: string; forms: MyCustomerForm[]; loading: boolean; error: string; namesError: string }) {
  const { system } = useCalendarSystem();
  const summary = summariseRatings(forms.map(f => f.rating));
  return (
    <View accessibilityLabel="Feedback from customers" style={s.card}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">
          Feedback from customers
        </Text>
        <Text style={s.sub}>{loading ? 'Loading…' : `${periodLabel} · ${forms.length} ${formWord(forms.length)}${summary ? ` · average ${averageText(summary.average)} out of 5` : ''}`}</Text>
      </View>
      {error ? (
        <View accessibilityRole="alert" style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}
      {!error && !loading && (
        <>
          {forms.length === 0 ? (
            <Text style={s.empty}>No customer forms have been typed in for you in {periodLabel} yet.</Text>
          ) : (
            <View accessibilityLabel={`Customer forms in ${periodLabel}`}>
              <NamesProblem text={namesError} />
              {forms.map(f => (
                <View key={f.id} style={s.item}>
                  <RatingBadge rating={f.rating} />
                  <View style={{ flex: 1 }}>
                    <View style={s.itemLine}>
                      {f.guest_name ? <GuestName name={f.guest_name} anchor={{ feedbackId: f.id }} /> : null}
                      <Text style={[s.itemDay, { fontWeight: '700' }]}>{formatAdDate(f.given_on, system)}</Text>
                      {f.reference ? <Text style={s.itemDay}>{f.reference}</Text> : null}
                      {f.recommend != null ? <Text style={s.itemDay}>Would recommend: {f.recommend} out of 10</Text> : null}
                    </View>
                    {f.comment ? <Text style={s.comment}>{f.comment}</Text> : <Text style={s.noComment}>No comment.</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, overflow: 'hidden' },
  head: { padding: 16, paddingBottom: 12, gap: 4 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: SLATE[600] },
  actions: { marginTop: 10, gap: 10 },
  errorBox: { borderTopWidth: 1, borderTopColor: colors.slate200, padding: 16 },
  errorText: { fontSize: 14, fontWeight: '700', color: colors.criticalText },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.slate200 },
  kind: { width: '50%', padding: 14, gap: 2, borderColor: colors.slate100, borderWidth: 0.5 },
  kindName: { fontSize: 12.5, fontWeight: '700', color: SLATE[700] },
  kindValue: { fontSize: 26, fontWeight: '800', color: colors.ink },
  kindOf: { fontSize: 13, fontWeight: '600', color: SLATE[600] },
  kindCount: { fontSize: 12, color: SLATE[600] },
  empty: { paddingHorizontal: 16, paddingVertical: 28, textAlign: 'center', fontSize: 14, color: SLATE[600] },
  item: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  itemLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  itemDay: { fontSize: 12.5, color: SLATE[600] },
  giver: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  pill: { fontSize: 12, fontWeight: '700', color: SLATE[700], backgroundColor: colors.slate100, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  comment: { fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 6 },
  noComment: { fontSize: 14, fontStyle: 'italic', color: colors.slate500, marginTop: 6 },
  remove: { alignSelf: 'flex-start', marginTop: 8, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5', backgroundColor: colors.white },
  removeText: { fontSize: 13, fontWeight: '800', color: colors.criticalText },
  badge: { width: 64, alignItems: 'center', gap: 4 },
  badgeCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center' },
  badgeNumber: { fontSize: 18, fontWeight: '800', color: colors.white },
  badgeWord: { fontSize: 11.5, fontWeight: '700', color: '#0f766e', textAlign: 'center' },
  namesProblem: { backgroundColor: '#fffbeb', paddingHorizontal: 16, paddingVertical: 10 },
  namesProblemText: { fontSize: 13, fontWeight: '700', color: '#78350f' },
});
