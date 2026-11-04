import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { formatAdDate } from '../lib/calendar';
import { BIRTHDAY_LOOKAHEAD_DAYS, BIRTHDAY_NOTIFY_DAYS, birthdaysToNotify, exitLabel, formatDayMonth } from '../lib/hrAlerts';
import { useSharedHrAlerts } from '../lib/HrAlertsProvider';
import { usePendingApprovals } from '../lib/PendingApprovals';
import { colors } from '../theme';
import { Sheet } from './hr/HrKit';

const BIRTHDAYS_SHOWN = 8;

export type ApprovalSegment = 'gps' | 'correction' | 'leave';

/** How many things need the owner's attention — what the bell's badge shows. */
export function useNotificationBadge() {
  const { total } = usePendingApprovals();
  const { contracts, birthdays, exits } = useSharedHrAlerts();
  // A resignation an employee handed in and HR has not started on needs a first move; the other exits are listed, not counted.
  const newResignations = exits.filter(e => e.kind === 'handed_in').length;
  return total + contracts.length + newResignations + birthdaysToNotify(birthdays).length;
}

function contractLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const ago = -daysLeft;
    return `Ended ${ago} day${ago === 1 ? '' : 's'} ago`;
  }
  if (daysLeft === 0) return 'Ends today';
  if (daysLeft === 1) return 'Ends tomorrow';
  return `Ends in ${daysLeft} days`;
}

function birthdayLabel(daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return `In ${daysAway} days`;
}

/** The bell's panel: approvals waiting, resignations and exits under way, contracts ending or
 * already ended, and birthdays coming up. Tapping a row opens that approvals queue or that
 * employee (an exit opens on their Exit tab). */
export default function NotificationsModal({
  visible,
  onClose,
  onOpenApprovals,
  onOpenEmployee,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenApprovals: (segment: ApprovalSegment) => void;
  onOpenEmployee: (employeeId: string, tab?: 'exit') => void;
}) {
  const { system } = useCalendarSystem();
  const { counts } = usePendingApprovals();
  const { contracts, birthdays, exits } = useSharedHrAlerts();
  const badge = useNotificationBadge();

  const approvals = [
    { label: 'GPS check-ins', segment: 'gps' as const, count: counts.gps },
    { label: 'Missed-punch corrections', segment: 'correction' as const, count: counts.corrections },
    { label: 'Leave requests', segment: 'leave' as const, count: counts.leave },
  ].filter(a => a.count > 0);
  const approvalTotal = counts.gps + counts.corrections + counts.leave;
  const nothing = approvals.length === 0 && contracts.length === 0 && exits.length === 0 && birthdays.length === 0;

  return (
    <Sheet visible={visible} title="Notifications" subtitle={badge > 0 ? `${badge} need attention` : undefined} onClose={onClose} closeLabel="Close">
      {nothing && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptyText}>No approvals waiting, no resignations, no contracts ending and no birthdays coming up.</Text>
        </View>
      )}

      {approvals.length > 0 && (
        <Section title="Needs your approval" count={approvalTotal}>
          {approvals.map(a => (
            <Row key={a.segment} label={a.label} onPress={() => onOpenApprovals(a.segment)}>
              <View style={styles.countDot}>
                <Text style={styles.countDotText}>{a.count}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{a.label}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Row>
          ))}
        </Section>
      )}

      {exits.length > 0 && (
        <Section title="Resignations & exits" count={exits.length}>
          {exits.map(e => {
            const label = exitLabel(e);
            const when = e.lastWorkingOn ? `Last day ${formatAdDate(e.lastWorkingOn, system)}` : e.handedInOn ? `Handed in ${formatAdDate(e.handedInOn, system)}` : '';
            return (
              <Row key={e.id} label={`${e.name}, ${label.text.toLowerCase()}`} onPress={() => onOpenEmployee(e.id, 'exit')}>
                <View style={styles.initial}>
                  <Text style={styles.initialText}>{e.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {e.name}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {e.designation ?? 'Employee'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.pill, styles[EXIT_PILLS[label.tone]]]}>{label.text}</Text>
                  {!!when && <Text style={styles.rowSub}>{when}</Text>}
                </View>
              </Row>
            );
          })}
        </Section>
      )}

      {contracts.length > 0 && (
        <Section title="Contracts ending" count={contracts.length}>
          {contracts.map(c => (
            <Row key={c.id} label={`${c.name}, contract ${contractLabel(c.daysLeft).toLowerCase()}`} onPress={() => onOpenEmployee(c.id)}>
              <View style={styles.initial}>
                <Text style={styles.initialText}>{c.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {c.designation ?? 'Contract'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.pill, c.daysLeft < 0 ? styles.pillBad : styles.pillWarn]}>{contractLabel(c.daysLeft)}</Text>
                <Text style={styles.rowSub}>{formatAdDate(c.endKey, system)}</Text>
              </View>
            </Row>
          ))}
        </Section>
      )}

      {birthdays.length > 0 && (
        <Section title={`Birthdays · next ${BIRTHDAY_LOOKAHEAD_DAYS} days`} count={birthdays.length}>
          {birthdays.slice(0, BIRTHDAYS_SHOWN).map(b => (
            <Row key={b.id} label={`${b.name}, birthday ${birthdayLabel(b.daysAway).toLowerCase()}`} onPress={() => onOpenEmployee(b.id)}>
              <View style={styles.initial}>
                <Text style={styles.initialText}>{b.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {b.name}
                </Text>
                <Text style={styles.rowSub}>Turns {b.turning}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.pill, b.daysAway <= BIRTHDAY_NOTIFY_DAYS ? styles.pillGood : styles.pillNeutral]}>{birthdayLabel(b.daysAway)}</Text>
                <Text style={styles.rowSub}>{formatDayMonth(b.dateKey, system)}</Text>
              </View>
            </Row>
          ))}
          {birthdays.length > BIRTHDAYS_SHOWN && (
            <Text style={styles.more}>
              and {birthdays.length - BIRTHDAYS_SHOWN} more in the next {BIRTHDAY_LOOKAHEAD_DAYS} days
            </Text>
          )}
        </Section>
      )}
    </Sheet>
  );
}

/** The chip colour for each tone exitLabel() can return. */
const EXIT_PILLS = { bad: 'pillBad', warn: 'pillWarn', info: 'pillInfo', neutral: 'pillNeutral' } as const;

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  emptyText: { fontSize: 12, color: colors.slate500, marginTop: 4, textAlign: 'center' },
  section: { marginTop: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.slate500 },
  sectionCount: { fontSize: 11, fontWeight: '800', color: colors.slate500, backgroundColor: colors.slate100, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 11, color: colors.slate500, marginTop: 1 },
  chevron: { fontSize: 20, color: colors.slate400 },
  countDot: { height: 32, width: 32, borderRadius: 16, backgroundColor: colors.warningBg, alignItems: 'center', justifyContent: 'center' },
  countDotText: { fontSize: 13, fontWeight: '800', color: colors.warningText },
  initial: { height: 32, width: 32, borderRadius: 16, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontSize: 13, fontWeight: '800', color: colors.accent },
  pill: { fontSize: 11, fontWeight: '800', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  pillBad: { backgroundColor: colors.criticalBg, color: colors.criticalText },
  pillWarn: { backgroundColor: colors.warningBg, color: colors.warningText },
  pillGood: { backgroundColor: colors.goodBg, color: colors.goodText },
  pillNeutral: { backgroundColor: colors.slate100, color: colors.slate500 },
  pillInfo: { backgroundColor: colors.infoBg, color: colors.infoText },
  more: { fontSize: 12, color: colors.slate500, paddingTop: 6 },
});
