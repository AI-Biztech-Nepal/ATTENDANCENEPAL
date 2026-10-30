import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import AccountMenuModal from '../components/AccountMenuModal';
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from('devices')
      .select('status')
      .then(({ data }) => {
        if (data) setDeviceCounts({ online: data.filter(d => d.status === 'online').length, total: data.length });
      });
  }, [isAdmin]);

  const name = profile?.full_name || 'Admin';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || 'A';

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
      <View style={styles.band}>
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            {profile?.photo_url ? (
              <Image source={{ uri: profile.photo_url }} style={styles.profileAvatarImg} />
            ) : (
              <Text style={styles.profileAvatarText}>{initials}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.profileSub} numberOfLines={1}>
              {isAdmin ? 'Owner' : 'HR'}
              {profile?.company_name ? ` · ${profile.company_name}` : ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.profileBtn} onPress={() => setMenuOpen(true)}>
            <Text style={styles.profileBtnText}>Profile</Text>
          </TouchableOpacity>
        </View>
      </View>

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

      <AccountMenuModal visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate100 },
  band: { backgroundColor: colors.accent, paddingHorizontal: 16, paddingBottom: 18 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  profileAvatar: {
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImg: { height: '100%', width: '100%' },
  profileAvatarText: { fontSize: 16, fontWeight: '800', color: colors.accent },
  profileName: { fontSize: 16, fontWeight: '800', color: colors.white },
  profileSub: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.82)', marginTop: 1 },
  profileBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.white },
  profileBtnText: { fontSize: 12, fontWeight: '800', color: colors.accent },
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
