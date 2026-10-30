import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerActions } from '@react-navigation/native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import { BellIcon, MenuIcon } from '../components/icons';
import AccountMenuModal from '../components/AccountMenuModal';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';
import HeaderBackButton from './HeaderBackButton';

export default function AdminHeader({ navigation, options }: NativeStackHeaderProps) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [deviceCounts, setDeviceCounts] = useState({ online: 0, total: 0 });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase
      .from('devices')
      .select('status')
      .then(({ data }) => {
        if (!data) return;
        setDeviceCounts({ online: data.filter(d => d.status === 'online').length, total: data.length });
      });
  }, []);

  const adminName = profile?.full_name || 'Admin';
  const initial = adminName.slice(0, 1).toUpperCase();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topRow}>
        <HeaderBackButton navigation={navigation} />
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => navigation.getParent()?.dispatch(DrawerActions.openDrawer())}
        >
          <MenuIcon />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {options.title}
        </Text>

        <TouchableOpacity style={styles.bellBtn}>
          <BellIcon />
        </TouchableOpacity>

        <TouchableOpacity style={styles.avatar} onPress={() => setMenuOpen(true)}>
          {profile?.photo_url ? (
            <Image source={{ uri: profile.photo_url }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarText}>{initial}</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.bottomRow}>
        <CalendarSystemSwitch />
        <View style={styles.devices}>
          <Text style={styles.devicesLabel}>Devices</Text>
          <Text style={styles.devicesValue}>
            {deviceCounts.online}/{deviceCounts.total}
          </Text>
        </View>
      </View>

      <AccountMenuModal visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  menuBtn: { padding: 6 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink },
  bellBtn: { padding: 6 },
  devices: { alignItems: 'flex-end' },
  devicesLabel: { fontSize: 9, color: colors.slate400 },
  devicesValue: { fontSize: 12, fontWeight: '700', color: colors.ink },
  avatar: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { height: '100%', width: '100%' },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
});
