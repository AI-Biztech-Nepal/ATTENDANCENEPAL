import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import AccountMenuModal from '../components/AccountMenuModal';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';
import { BellIcon } from '../components/icons';
import NotificationsModal, { useNotificationBadge, type ApprovalSegment } from '../components/NotificationsModal';
import { useSharedHrAlerts } from '../lib/HrAlertsProvider';
import HeaderBackButton from './HeaderBackButton';

// Same brand-green band as EmployeeHeader. Owner/HR navigation is the bottom
// tab bar now (no side menu), so there's no menu button; Home shows the app
// logo and name in place of a title and continues the band into its greeting.
export default function AdminHeader({ navigation, options, route }: NativeStackHeaderProps) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const badge = useNotificationBadge();
  const { refresh: refreshAlerts } = useSharedHrAlerts();

  function openBell() {
    refreshAlerts();
    setBellOpen(true);
  }
  // The panel lives in this header, but its rows lead to other tabs, so go through the tab navigator.
  function openApprovals(segment: ApprovalSegment) {
    setBellOpen(false);
    navigation.getParent()?.navigate('ApprovalsTab', { screen: 'Approvals', params: { segment } });
  }
  function openEmployee(employeeId: string) {
    setBellOpen(false);
    navigation.getParent()?.navigate('EmployeesTab', { screen: 'EmployeeDetail', initial: false, params: { employeeId } });
  }

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

        <TouchableOpacity
          style={styles.bell}
          onPress={openBell}
          accessibilityRole="button"
          accessibilityLabel={badge > 0 ? `Notifications, ${badge} waiting` : 'Notifications'}
        >
          <BellIcon size={18} color={colors.white} />
          {badge > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.avatar} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Account menu">
          {profile?.photo_url ? (
            <Image source={{ uri: profile.photo_url }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </TouchableOpacity>
      </View>

      <AccountMenuModal visible={menuOpen} onClose={() => setMenuOpen(false)} />
      <NotificationsModal visible={bellOpen} onClose={() => setBellOpen(false)} onOpenApprovals={openApprovals} onOpenEmployee={openEmployee} />
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
  bell: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.critical,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '800' },
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
