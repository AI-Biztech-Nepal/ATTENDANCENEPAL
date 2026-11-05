import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { notificationLines, notificationTitle, timeAgo, type EmployeeNotification } from '../lib/employeeNotifications';
import { colors } from '../theme';
import { Sheet } from './hr/HrKit';

/** The employee's bell panel: what HR has done about them — today, changes to their exit. The unread ones are
 * highlighted until "Mark all as read" is tapped. Tapping one opens their Exit tab. */
export default function EmployeeNotificationsModal({
  visible,
  onClose,
  items,
  unread,
  onMarkAllRead,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  items: EmployeeNotification[];
  unread: number;
  onMarkAllRead: () => void;
  onOpen: () => void;
}) {
  const { system } = useCalendarSystem();
  return (
    <Sheet visible={visible} title="Notifications" subtitle={unread > 0 ? `${unread} new` : undefined} onClose={onClose} closeLabel="Close">
      {unread > 0 && (
        <TouchableOpacity style={styles.markRead} onPress={onMarkAllRead} accessibilityRole="button" accessibilityLabel="Mark all as read">
          <Text style={styles.markReadText}>Mark all as read</Text>
        </TouchableOpacity>
      )}
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing new</Text>
          <Text style={styles.emptyText}>When HR updates something about you, it shows up here.</Text>
        </View>
      ) : (
        items.map(n => {
          const lines = notificationLines(n, system);
          const fresh = !n.read_at;
          return (
            <TouchableOpacity
              key={n.id}
              style={[styles.row, fresh && styles.rowFresh]}
              onPress={onOpen}
              accessibilityRole="button"
              accessibilityLabel={`${notificationTitle(n)}. ${lines.join('. ')}`}
            >
              <View style={[styles.dot, fresh && styles.dotFresh]} />
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{notificationTitle(n)}</Text>
                  <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
                </View>
                {lines.map((line, i) => (
                  <Text key={i} style={styles.line}>
                    {line}
                  </Text>
                ))}
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  markRead: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 2 },
  markReadText: { fontSize: 13, fontWeight: '800', color: colors.accent },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  emptyText: { fontSize: 12, color: colors.slate500, marginTop: 4, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.slate100, borderRadius: 8 },
  rowFresh: { backgroundColor: colors.accentLight },
  dot: { height: 8, width: 8, borderRadius: 4, marginTop: 6, backgroundColor: 'transparent' },
  dotFresh: { backgroundColor: colors.accent },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  time: { fontSize: 11, color: colors.slate500 },
  line: { fontSize: 12, color: colors.slate500, marginTop: 2, lineHeight: 17 },
});
