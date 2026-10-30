import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, Pressable, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { supabase } from '../lib/supabase';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';
import HeaderBackButton from './HeaderBackButton';

// The employee's own `employees.name`/`profile_photo_url` (not the login
// account's `profiles` row, which AdminHeader/AccountMenuModal use for
// admins) — an employee's HR record name/photo can differ from their login
// profile. Navy band with no bottom border: Check In/Out continues the band
// into its "Namaste" hero, so the two read as one surface.
export default function EmployeeHeader({ options, navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('Employee');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 12 });

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      if (!active || !profile?.employee_id) return;
      const { data: emp } = await supabase.from('employees').select('name, profile_photo_url').eq('id', profile.employee_id).single();
      if (!active) return;
      setName(emp?.name ?? 'Employee');
      setPhotoUrl(emp?.profile_photo_url ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    setMenuOpen(false);
    await supabase.auth.signOut();
  }

  function toggleMenu() {
    anchorRef.current?.measureInWindow((_x, y, _w, h) => setMenuPos({ top: y + h, right: 12 }));
    setMenuOpen(v => !v);
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || 'E';
  const isHome = route?.name === 'CheckIn';

  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />
      <View style={styles.topRow}>
        <HeaderBackButton navigation={navigation} color={colors.white} />
        {isHome ? (
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <View style={styles.brandDot} />
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

        <View ref={anchorRef} collapsable={false}>
          <TouchableOpacity style={styles.avatar} onPress={toggleMenu} accessibilityRole="button" accessibilityLabel="Account menu">
            {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials}</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)}>
          <View style={[styles.dropdown, { top: menuPos.top + 6, right: menuPos.right }]}>
            <Text style={styles.dropdownName} numberOfLines={1}>
              {name}
            </Text>
            <TouchableOpacity style={styles.dropdownItem} onPress={handleSignOut}>
              <Text style={styles.dropdownItemText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
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
  brandMark: { height: 28, width: 28, borderRadius: 8, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  brandDot: { height: 9, width: 9, borderRadius: 5, backgroundColor: colors.crimson },
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
  dropdown: {
    position: 'absolute',
    minWidth: 160,
    maxWidth: 240,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.slate200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    overflow: 'hidden',
  },
  dropdownName: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate100,
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 12 },
  dropdownItemText: { fontSize: 13, fontWeight: '600', color: colors.criticalText },
});
