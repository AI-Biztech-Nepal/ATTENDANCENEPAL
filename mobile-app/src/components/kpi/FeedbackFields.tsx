import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import DatePicker from '../DatePicker';
import { COMMENT_MAX, GUEST_EMAIL_MAX, GUEST_NAME_MAX, GUEST_PHONE_MAX, REFERENCE_MAX, type FeedbackDraft } from '../../lib/customerFeedback';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { Circle, Field, Question } from './FormParts';
import { SLATE } from './KpiUi';

const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** The numbers the customer could circle, as round buttons to tap; tapping the chosen one again clears it (a customer may skip a question). */
function Circles({ from, to, value, onPick, name, words }: { from: number; to: number; value: string; onPick: (v: string) => void; name: string; words?: string[] }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={name} style={s.circles}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n, i) => {
        const on = value.trim() === String(n);
        return <Circle key={n} n={n} on={on} size={words ? 46 : 40} label={words ? `${name} ${n}, ${words[i]}` : `${name} ${n}`} onPress={() => onPick(on ? '' : String(n))} />;
      })}
    </View>
  );
}

/**
 * The boxes of one customer form, in the order of the paper form: the date of the visit, what it was for, who the guest is (name and phone are
 * required, the email is optional), 1. the service rating the customer circled, 2. how likely they are to recommend, 3. the comment. Shared by
 * the typing card and the edit sheet. The employee is the person whose screen it is, so it is shown, not chosen. Same as
 * admin-web/components/kpi/FeedbackFields.tsx.
 */
export default function FeedbackFields({ draft, onChange, employeeName }: { draft: FeedbackDraft; onChange: (next: FeedbackDraft) => void; employeeName: string }) {
  const { words } = useKpiSettings();
  const set = (patch: Partial<FeedbackDraft>) => onChange({ ...draft, ...patch });
  return (
    <View>
      <View style={{ marginBottom: 14, gap: 6 }}>
        <Text style={s.label}>{words.t('Who served the customer')}</Text>
        <Text style={s.fixed} accessibilityLabel={`${words.t('Who served the customer')}: ${employeeName}`}>
          {employeeName || '…'}
        </Text>
      </View>

      <View style={{ marginBottom: 14, gap: 6 }}>
        <Text style={s.label}>Date of visit</Text>
        <DatePicker value={draft.date} onChange={v => set({ date: v })} />
      </View>
      <View style={{ marginBottom: 14 }}>
        <Field label="What it was for" optional value={draft.reference} onChange={v => set({ reference: v })} placeholder="e.g. Consultation" maxLength={REFERENCE_MAX} />
      </View>

      <View style={{ marginBottom: 14 }}>
        <Field label={`${words.One} name`} value={draft.guestName} onChange={v => set({ guestName: v })} maxLength={GUEST_NAME_MAX} />
      </View>
      <View style={{ marginBottom: 14 }}>
        <Field label="Phone" value={draft.guestPhone} onChange={v => set({ guestPhone: v })} keyboard="phone-pad" maxLength={GUEST_PHONE_MAX} />
      </View>
      <View style={{ marginBottom: 14 }}>
        <Field label="Email" optional value={draft.guestEmail} onChange={v => set({ guestEmail: v })} keyboard="email-address" maxLength={GUEST_EMAIL_MAX} />
      </View>

      <Question n={1} title="How was the service you received?" range="Rating, 1 to 5">
        <Circles from={1} to={5} value={draft.rating} onPick={v => set({ rating: v })} name="Rating" words={RATING_WORDS} />
        <View style={s.scale}>
          <Text style={s.scaleText}>1 = Poor</Text>
          <Text style={s.scaleText}>5 = Excellent</Text>
        </View>
      </Question>

      <Question n={2} title="How likely are you to recommend us to a friend or family member?" range="Would recommend, 0 to 10">
        <Circles from={0} to={10} value={draft.recommend} onPick={v => set({ recommend: v })} name="Would recommend" />
        <View style={s.scale}>
          <Text style={s.scaleText}>0 = Not at all likely</Text>
          <Text style={s.scaleText}>10 = Extremely likely</Text>
        </View>
      </Question>

      <Question n={3} title="Anything else you would like to tell us?" range="Comment (optional)">
        <Field label="Comment" value={draft.comment} onChange={v => set({ comment: v })} multiline maxLength={COMMENT_MAX} />
      </Question>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '700', color: SLATE[700] },
  fixed: { fontSize: 15, fontWeight: '700', color: colors.ink, minHeight: 48, paddingTop: 13, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50 },
  circles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  scaleText: { fontSize: 11.5, color: SLATE[600] },
});
