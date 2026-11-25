import React, { createContext, useContext, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme';
import { formatAdDate } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { weekdayName } from '../../lib/taskClock';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { summariseGuest, useGuestHistory, type GuestAnchor } from '../../lib/guestHistory';
import { KPI_COLORS } from './KpiCharts';
import { Sheet, SLATE } from './KpiUi';

// A guest's name, tappable, and the history it opens: every visit from the bookings file and every feedback form for that guest. A screen puts
// <GuestHistoryProvider> around its content so a tap opens the history in a sheet; inside a KPI report the report swaps itself for the history
// instead (see KpiReports.tsx), through the same context. Same idea as admin-web/components/kpi/GuestHistory.tsx.

type OpenGuest = (anchor: GuestAnchor, name: string) => void;

export const GuestOpenContext = createContext<OpenGuest | null>(null);

/** A guest's name. With somewhere to open the history (a provider) and a record to open it from, it is a button. */
export function GuestName({ name, anchor, big = false }: { name: string; anchor: GuestAnchor | null; big?: boolean }) {
  const open = useContext(GuestOpenContext);
  const text = [s.name, big && { fontSize: 15 }];
  if (!open || !anchor) return <Text style={[s.nameStatic, big && { fontSize: 15 }]}>{name}</Text>;
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`See ${name}'s history`} onPress={() => open(anchor, name)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
      <Text style={text}>{name}</Text>
    </TouchableOpacity>
  );
}

/** Lets every <GuestName> inside open the guest's history in a sheet. */
export function GuestHistoryProvider({ children }: { children: React.ReactNode }) {
  const { words } = useKpiSettings();
  const [guest, setGuest] = useState<{ anchor: GuestAnchor; name: string } | null>(null);
  return (
    <GuestOpenContext.Provider value={(anchor, name) => setGuest({ anchor, name })}>
      {children}
      {guest && (
        <Sheet eyebrow={words.One} title={guest.name} onClose={() => setGuest(null)}>
          <GuestHistoryBody anchor={guest.anchor} />
        </Sheet>
      )}
    </GuestOpenContext.Provider>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The history itself: who the guest is, a few numbers, then every visit and feedback form, newest first. */
export function GuestHistoryBody({ anchor }: { anchor: GuestAnchor }) {
  const { system } = useCalendarSystem();
  const { words } = useKpiSettings();
  const { loading, history, error } = useGuestHistory(anchor);
  const day = (d: string) => `${weekdayName(d)}, ${formatAdDate(d, system)}`;

  if (loading) return <Text style={s.loading}>Loading…</Text>;
  if (error || !history) {
    return (
      <View accessibilityRole="alert" style={s.alert}>
        <Text style={s.alertText}>{error || 'Could not load the history.'}</Text>
      </View>
    );
  }
  const sm = summariseGuest(history);
  const contact = [history.phone, history.email].filter(Boolean);
  return (
    <View>
      {contact.length > 0 && <Text style={s.contact}>{contact.join(' · ')}</Text>}
      <View style={s.tiles}>
        {[
          { label: 'Visits', value: String(sm.visits) },
          { label: 'Feedback forms', value: String(sm.forms) },
          { label: 'Average rating', value: sm.average != null ? `${sm.average.toFixed(1)} / 5` : '–' },
          { label: 'Last seen', value: sm.lastDay ? formatAdDate(sm.lastDay, system) : '–', small: true },
        ].map(t => (
          <View key={t.label} style={s.tile}>
            <Text style={[s.tileValue, t.small && { fontSize: 16 }]}>{t.value}</Text>
            <Text style={s.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {sm.entries.length === 0 ? (
        <Text style={s.empty}>{words.t('Nothing on file for this customer yet.')}</Text>
      ) : (
        <View>
          <Text style={s.heading}>History</Text>
          {sm.entries.map(e => (
            <View key={`${e.kind}-${e.id}`} style={s.entry}>
              <View style={s.entryLine}>
                <Text style={s.entryDay}>{day(e.day)}</Text>
                {e.kind === 'visit' ? (
                  <>
                    <Text style={[s.pill, { backgroundColor: '#f0fdfa', color: '#115e59' }]}>Visit</Text>
                    <Text style={s.entryStrong}>{e.service ?? 'Service not named'}</Text>
                    {e.minutes != null && <Text style={s.entryMeta}>{plural(e.minutes, 'minute', 'minutes')}</Text>}
                  </>
                ) : (
                  <>
                    <Text style={[s.pill, { backgroundColor: '#fffbeb', color: '#92400e' }]}>Feedback form</Text>
                    {e.rating != null ? (
                      <Text accessibilityLabel={`Rating ${e.rating} of 5`} style={{ color: KPI_COLORS.warn, fontSize: 15, letterSpacing: 1 }}>
                        {'★'.repeat(e.rating)}
                        <Text style={{ color: '#cbd5e1' }}>{'★'.repeat(5 - e.rating)}</Text>
                      </Text>
                    ) : (
                      <Text style={s.entryMeta}>No rating</Text>
                    )}
                    {e.recommend != null && <Text style={s.entryMeta}>Would recommend: {e.recommend} out of 10</Text>}
                    {e.reference ? <Text style={s.entryMeta}>{e.reference}</Text> : null}
                  </>
                )}
                {e.employee_name ? <Text style={s.entryMeta}>with {e.employee_name}</Text> : null}
              </View>
              {e.kind === 'form' && e.comment ? <Text style={s.comment}>{e.comment}</Text> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  name: { fontSize: 13.5, fontWeight: '800', color: colors.accent, textDecorationLine: 'underline' },
  nameStatic: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  loading: { textAlign: 'center', paddingVertical: 32, fontSize: 14, color: SLATE[600] },
  alert: { borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50, padding: 16 },
  alertText: { fontSize: 14, fontWeight: '700', color: SLATE[700] },
  contact: { fontSize: 13.5, fontWeight: '600', color: SLATE[700], marginBottom: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  tile: { width: '47.5%', borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50, paddingHorizontal: 14, paddingVertical: 12 },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.ink },
  tileLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink, marginTop: 4 },
  empty: { borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: SLATE[300], paddingVertical: 28, paddingHorizontal: 16, textAlign: 'center', fontSize: 14, color: SLATE[600] },
  heading: { fontSize: 13, fontWeight: '800', color: colors.ink, marginTop: 8, marginBottom: 6 },
  entry: { borderBottomWidth: 1, borderBottomColor: colors.slate100, paddingVertical: 12 },
  entryLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  entryDay: { fontSize: 12.5, fontWeight: '700', color: SLATE[700] },
  entryStrong: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  entryMeta: { fontSize: 12.5, color: SLATE[600] },
  pill: { fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  comment: { fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 5 },
});
