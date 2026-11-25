import React, { createContext, useContext, useEffect, useRef } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { lowerFirst, type Change } from '../../lib/compareKpi';
import type { ReportKind } from '../../lib/reportKpi';

// The small parts every KPI screen is built from: the same ones the website draws with Tailwind (admin-web/components/kpi/EmployeeKpiCards.tsx,
// MonthStepper.tsx, ReportDialog.tsx), made for a phone: one column, big tap targets, pop-ups that rise from the bottom.

export const SLATE = { 300: '#cbd5e1', 600: '#475569', 700: '#334155' };

/** What a card says when its numbers could not be read, so it never claims "nothing imported" or "no forms" for data that is only out of reach. */
export const UNREAD = { title: 'Could not be read', text: 'The note above says why.' };

/**
 * How the cards speak. For an admin looking at one person (the default) they talk ABOUT someone and offer what an admin can do ("Type in a form").
 * On the employee's own page (`mine`) they talk TO the person, offer no way to change anything and lead to the Feedback section.
 */
export type CardMode = {
  mine: boolean;
  /** Opens the report behind a card (a pop-up). Without it the cards are not tappable. */
  openReport?: (kind: ReportKind) => void;
  /** "See your forms" / "See what colleagues said": goes to the employee's Feedback section. */
  openFeedback?: () => void;
  /** "Type in a form": goes to the person's Customer feedback section. Admin only. */
  typeInForm?: () => void;
};
const CardModeContext = createContext<CardMode>({ mine: false });
export const CardModeProvider = CardModeContext.Provider;
export const useCardMode = () => useContext(CardModeContext);

/** A small outlined button under a card, with an arrow ("See your forms") or a plus ("Type in a form"). */
export function CardLink({ onPress, children, plus = false }: { onPress: () => void; children: string; plus?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={children} onPress={onPress} style={s.cardLink}>
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <Path d={plus ? 'M12 5v14M5 12h14' : 'M5 12h14M13 6l6 6-6 6'} />
      </Svg>
      <Text style={s.cardLinkText}>{children}</Text>
    </TouchableOpacity>
  );
}

/** One KPI's card. Tapping the card opens its report (once there is something to report); the corner button is the same thing with a name. */
export function Card({ eyebrow, name, footer, children, report, reportable = true }: {
  eyebrow: string;
  name: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  report?: ReportKind;
  reportable?: boolean;
}) {
  const { openReport } = useCardMode();
  const open = openReport && report && reportable ? () => openReport(report) : null;
  const body = (
    <>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.cardName} accessibilityRole="header">
        {name}
      </Text>
      <View style={s.cardBody}>{children}</View>
      {footer ? <View style={s.cardFooter}>{typeof footer === 'string' ? <Text style={s.footerText}>{footer}</Text> : footer}</View> : null}
    </>
  );
  if (!open) {
    return (
      <View accessibilityLabel={name} style={s.card}>
        {body}
      </View>
    );
  }
  return (
    <View accessibilityLabel={name} style={s.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}. Tap for the report`} onPress={open} style={{ flexGrow: 1 }}>
        {body}
      </Pressable>
      {/* In the corner by position, and last, so the card's chart stays the first graphic in it. */}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open the report for ${name}`} onPress={open} style={s.reportBtn} hitSlop={4}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.slate500} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </Svg>
      </TouchableOpacity>
    </View>
  );
}

export function LegendRow({ color, label, value, bordered = false }: { color: string; label: string; value: string; bordered?: boolean }) {
  return (
    <View style={s.legendRow}>
      <View style={[s.legendSwatch, { backgroundColor: color }, bordered && { borderWidth: 1, borderColor: colors.slate400 }]} />
      <Text style={s.legendLabel}>{label}</Text>
      <Text style={s.legendValue}>{value}</Text>
    </View>
  );
}

export function Stat({ big, label }: { big: string; label: string }) {
  return (
    <View>
      <Text style={s.statBig}>{big}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/** One line saying how a number moved since last month: a small arrow for the direction and the words that carry the same meaning. The arrow
 * is only for the eye, and neither it nor its colour says whether the change is good: that depends on the KPI. */
export function Compare({ change, label }: { change: Change; label?: string }) {
  return (
    <View style={s.compare}>
      {change.dir !== 'none' && (
        <Svg width={10} height={10} viewBox="0 0 24 24" fill={colors.slate500}>
          <Path d={change.dir === 'up' ? 'M12 5 21 19H3z' : change.dir === 'down' ? 'M12 19 3 5h18z' : 'M4 8h16v3H4zM4 14h16v3H4z'} />
        </Svg>
      )}
      <Text style={s.footerText}>
        {label ? (
          <>
            <Text style={{ fontWeight: '700', color: SLATE[700] }}>{label}:</Text> {lowerFirst(change.text)}
          </>
        ) : (
          change.text
        )}
      </Text>
    </View>
  );
}

export function Message({ title, text }: { title: string; text?: string }) {
  return (
    <View style={s.message}>
      <Text style={s.messageTitle}>{title}</Text>
      {text ? <Text style={s.messageText}>{text}</Text> : null}
    </View>
  );
}

/** A note above the cards when a table is missing or a read was refused, so a dash never hides a number that could not be read. */
export function LoadProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <View accessibilityRole="alert" style={s.problems}>
      <Text style={s.problemsTitle}>Some numbers could not be read, so they are not shown.</Text>
      {problems.map(p => (
        <Text key={p} style={s.problemLine}>
          • {p}
        </Text>
      ))}
    </View>
  );
}

/** The month arrows with the month's name, and the same month in the other calendar underneath. */
export function MonthStepper({ label, subtitle, onPrevious, onNext }: { label: string; subtitle?: string; onPrevious: () => void; onNext: () => void }) {
  return (
    <View style={s.stepper}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={onPrevious} style={s.stepBtn}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={SLATE[700]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m15 6-6 6 6 6" />
        </Svg>
      </TouchableOpacity>
      <View style={{ flex: 1, alignItems: 'center' }} accessibilityLiveRegion="polite">
        <Text style={s.monthLabel} accessibilityRole="header">
          {label}
        </Text>
        {subtitle ? <Text style={s.monthSub}>{subtitle}</Text> : null}
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" onPress={onNext} style={s.stepBtn}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={SLATE[700]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m9 6 6 6-6 6" />
        </Svg>
      </TouchableOpacity>
    </View>
  );
}

/** A row of choices where one is on (the sections of a screen, the Day/Week switch): a pill that wraps if it must. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={s.segmented}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.id)}
            style={[s.segment, on && s.segmentOn]}
          >
            <Text style={[s.segmentText, on && s.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * A pop-up that rises from the bottom: a title block, a close button, and a body that scrolls on its own. It closes with the close button, the
 * dimmed area above it, or the phone's back button. Used for every report, the feedback forms and the guest history.
 */
export function Sheet({ eyebrow, title, subtitle, onClose, children, footer }: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned under the scrolling body (the buttons of a form). */
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityViewIsModal>
          <View style={s.sheetHead}>
            <View style={{ flex: 1 }}>
              {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
              <Text style={s.sheetTitle} accessibilityRole="header">
                {title}
              </Text>
              {subtitle ? <Text style={s.sheetSub}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close the report" onPress={onClose} style={s.closeBtn}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={SLATE[600]} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M6 6l12 12M18 6 6 18" />
              </Svg>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={s.sheetFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/** A big primary or outlined button. */
export function Button({ label, onPress, kind = 'primary', disabled = false, busy = false }: { label: string; onPress: () => void; kind?: 'primary' | 'outline' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const off = disabled || busy;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={[s.button, kind === 'primary' && s.buttonPrimary, kind === 'outline' && s.buttonOutline, kind === 'danger' && s.buttonDanger, off && { opacity: 0.55 }]}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' ? colors.white : colors.accent} /> : <Text style={[s.buttonText, kind === 'primary' && { color: colors.white }, kind === 'outline' && { color: colors.accent }, kind === 'danger' && { color: colors.criticalText }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

/** The page padding every KPI screen uses. */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.slate100 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** Asks a yes/no question and calls `then` with the answer (the phone's own dialog, or the browser's when the app runs on the web). */
export function useAsk() {
  return useRef((message: string, yes: string): Promise<boolean> => {
    if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
    const { Alert } = require('react-native') as typeof import('react-native');
    return new Promise(resolve => {
      Alert.alert('Are you sure?', message, [
        { text: 'Keep it', style: 'cancel', onPress: () => resolve(false) },
        { text: yes, style: 'destructive', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  }).current;
}

/** Runs `fn` once when the component first appears. */
export function useOnce(fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, padding: 16 },
  eyebrow: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.7, color: SLATE[600], textTransform: 'uppercase', paddingRight: 40 },
  cardName: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 2, marginBottom: 12, paddingRight: 40 },
  cardBody: { flexGrow: 1 },
  cardFooter: { paddingTop: 12 },
  footerText: { fontSize: 12, color: SLATE[600] },
  reportBtn: { position: 'absolute', right: 6, top: 6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cardLink: { marginTop: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.white },
  cardLinkText: { fontSize: 12.5, fontWeight: '800', color: colors.accent },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendLabel: { flex: 1, fontSize: 13, color: SLATE[700] },
  legendValue: { fontSize: 13, fontWeight: '800', color: colors.ink },
  statBig: { fontSize: 30, fontWeight: '800', color: colors.ink, lineHeight: 34 },
  statLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink, marginTop: 2 },
  compare: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  message: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 16 },
  messageTitle: { fontSize: 14, fontWeight: '700', color: SLATE[700], textAlign: 'center' },
  messageText: { fontSize: 12, color: SLATE[600], textAlign: 'center' },
  problems: { borderRadius: 12, borderWidth: 1, borderColor: '#fcd34d', backgroundColor: '#fffbeb', padding: 14, gap: 4 },
  problemsTitle: { fontSize: 13, fontWeight: '800', color: '#78350f' },
  problemLine: { fontSize: 12.5, color: '#92400e' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: SLATE[300], backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 18, fontWeight: '800', color: colors.ink },
  monthSub: { fontSize: 12.5, color: SLATE[600], textAlign: 'center' },
  segmented: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 999, borderWidth: 1, borderColor: SLATE[300], padding: 3, gap: 2 },
  segment: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, fontWeight: '700', color: SLATE[700] },
  segmentTextOn: { color: colors.white, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.slate200 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 2 },
  sheetSub: { fontSize: 13, color: SLATE[600], marginTop: 3 },
  closeBtn: { width: 44, height: 44, marginTop: -6, marginRight: -8, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: 18, paddingVertical: 14, gap: 4 },
  sheetFooter: { paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate200, flexDirection: 'row', gap: 10 },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, flexGrow: 1 },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonOutline: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.white },
  buttonDanger: { borderWidth: 1, borderColor: '#fca5a5', backgroundColor: colors.white },
  buttonText: { fontSize: 14, fontWeight: '800' },
});
