import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import AccountMenuModal from '../components/AccountMenuModal';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';
import HeaderBackButton from './HeaderBackButton';

// Same brand-green band as EmployeeHeader. Owner/HR navigation is the bottom
// tab bar now (no side menu), so there's no menu button; Home shows the app
// logo and name in place of a title and continues the band into its greeting.
export default function AdminHeader({ navigation, options, route }: NativeStackHeaderProps) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  const adminName = profile?.full_name || 'Admin';
  const initials =
    adminName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || 'A';
  const isHome = route.name === 'Dashboard';

  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />
      <View style={styles.topRow}>
        <HeaderBackButton navigation={navigation} color={colors.white} />
        {isHome ? (
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
              <Image source={require('../../assets/icon.png')} style={styles.brandLogo} resizeMode="contain" />
            </View>
            <Text style={styles.brandText} numberOfLines={1}>
              Attendance Nepal
            </Text>
          </View>
        ) : (
          <Text style={styles.title} numberOfLines={1}>
            {options.title}
          </Text>
        )}

        <CalendarSystemSwitch onDark />

        <TouchableOpacity style={styles.avatar} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Account menu">
          {profile?.photo_url ? (
            <Image source={{ uri: profile.photo_url }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </TouchableOpacity>
      </View>

      <AccountMenuModal visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.accent,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.white },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { height: 38, width: 38, borderRadius: 11, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { height: 34, width: 34 },
  brandText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  avatar: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { height: '100%', width: '100%' },
  avatarText: { color: colors.accent, fontWeight: '800', fontSize: 13 },
});
