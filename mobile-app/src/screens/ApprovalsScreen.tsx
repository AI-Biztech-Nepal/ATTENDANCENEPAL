import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { usePendingApprovals } from '../lib/PendingApprovals';
import CorrectionsScreen from './CorrectionsScreen';
import LeaveApprovalScreen from './LeaveApprovalScreen';

type Segment = 'gps' | 'correction' | 'leave';

/** The owner's one inbox for everything waiting on a decision. Each segment
 * reuses the screen that already approves that kind of request, so approve /
 * reject behave exactly as on More › Corrections and More › Leave. */
export default function ApprovalsScreen({ navigation, route }: any) {
  const { counts, refresh } = usePendingApprovals();
  const [segment, setSegment] = useState<Segment>(route?.params?.segment ?? 'gps');

  // Home's "Needs your approval" rows open a specific segment.
  useEffect(() => {
    if (route?.params?.segment) setSegment(route.params.segment);
  }, [route?.params?.segment]);
  useEffect(() => navigation.addListener('focus', refresh), [navigation, refresh]);

  const segments: { key: Segment; label: string; count: number }[] = [
    { key: 'gps', label: 'Check-ins', count: counts.gps },
    { key: 'correction', label: 'Corrections', count: counts.corrections },
    { key: 'leave', label: 'Leave', count: counts.leave },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.band}>
        <View style={styles.segmented}>
          {segments.map(s => (
            <TouchableOpacity key={s.key} style={[styles.segment, segment === s.key && styles.segmentActive]} onPress={() => setSegment(s.key)}>
              <Text style={[styles.segmentText, segment === s.key && styles.segmentTextActive]} numberOfLines={1}>
                {s.label} · {s.count}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {segment === 'leave' ? <LeaveApprovalScreen embedded /> : <CorrectionsScreen key={segment} kind={segment} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate100 },
  band: { backgroundColor: colors.accent, paddingHorizontal: 16, paddingBottom: 14 },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  segmentActive: { backgroundColor: colors.white },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.white },
  segmentTextActive: { color: colors.accent, fontWeight: '800' },
});
