import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import {
  BranchIcon,
  CalendarIcon,
  CalendarViewIcon,
  ClockIcon,
  CorrectionIcon,
  DeviceIcon,
  ResignedIcon,
  SignOutIcon,
  TaskIcon,
  UmbrellaIcon,
  type IconProps,
} from '../components/icons';

type Tile = { screen: string; label: string; icon: (p: IconProps) => JSX.Element; adminOnly?: boolean };

// Everything the old side menu held that isn't one of the bottom tabs. Same
// admin-only rules as the side menu: HR doesn't see shifts, branches,
// resigned staff or devices.
const ATTENDANCE_TILES: Tile[] = [
  { screen: 'Attendance', label: 'Attendance log', icon: ClockIcon },
  { screen: 'Calendar', label: 'Calendar', icon: CalendarViewIcon },
  { screen: 'Corrections', label: 'Corrections', icon: CorrectionIcon },
  { screen: 'Leave', label: 'Leave', icon: UmbrellaIcon },
];
const SETUP_TILES: Tile[] = [
  { screen: 'Shifts', label: 'Shifts', icon: CalendarIcon, adminOnly: true },
  { screen: 'Branches', label: 'Branch/Depart', icon: BranchIcon, adminOnly: true },
  { screen: 'Tasks', label: 'Tasks', icon: TaskIcon },
  { screen: 'Devices', label: 'Devices', icon: DeviceIcon, adminOnly: true },
  { screen: 'Resigned', label: 'Resigned', icon: ResignedIcon, adminOnly: true },
];

export default function MoreScreen({ navigation }: any) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [deviceCounts, setDeviceCounts] = useState<{ online: number; total: number } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from('devices')
      .select('status')
      .then(({ data }) => {
        if (data) setDeviceCounts({ online: data.filter(d => d.status === 'online').length, total: data.length });
      });
  }, [isAdmin]);

  function renderTiles(tiles: Tile[]) {
    return (
      <View style={styles.grid}>
        {tiles
          .filter(t => !t.adminOnly || isAdmin)
          .map(t => {
            const Icon = t.icon;
            const label = t.screen === 'Devices' && deviceCounts ? `${t.label} · ${deviceCounts.online}/${deviceCounts.total}` : t.label;
            return (
              <TouchableOpacity key={t.screen} style={styles.tile} onPress={() => navigation.navigate(t.screen)}>
                <View style={styles.tileIcon}>
                  <Icon size={18} color={colors.accent} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={2}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* No profile card here: the header avatar already opens the account menu. */}
      <View style={styles.body}>
        <Text style={styles.groupTitle}>Attendance</Text>
        {renderTiles(ATTENDANCE_TILES)}
        <Text style={styles.groupTitle}>{'People & setup'}</Text>
        {renderTiles(SETUP_TILES)}

        <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <SignOutIcon size={18} color={colors.criticalText} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate100 },
  body: { paddingHorizontal: 16 },
  groupTitle: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '800',
    color: colors.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%',
    flexGrow: 0,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.white,
  },
  tileIcon: { height: 36, width: 36, borderRadius: 18, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.white,
  },
  signOutText: { fontSize: 14, fontWeight: '700', color: colors.criticalText },
});
