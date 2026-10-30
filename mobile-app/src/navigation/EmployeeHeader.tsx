import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { supabase } from '../lib/supabase';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';
import { BackIcon } from '../components/icons';

// Mirrors admin-web's EmployeeShell header exactly: the employee's own
// `employees.name`/`profile_photo_url` (not the login account's `profiles`
// row, which AdminHeader/AccountMenuModal use for admins) — an employee's
// HR record name/photo can differ from their login profile.
export default function EmployeeHeader({ options, navigation }: any) {
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

  const initial = name.slice(0, 1).toUpperCase();
  // True on a pushed page (Leave) and on any tab reached from another tab
  // (the tab navigator keeps history), so back retraces the visited pages.
  const canGoBack = navigation?.canGoBack() ?? false;

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topRow}>
        {canGoBack && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
          >
            <BackIcon />
          </TouchableOpacity>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {options.title}
        </Text>

        <View
          ref={anchorRef}
          onLayout={() => {
            anchorRef.current?.measureInWindow((_x, y, _w, h) => setMenuPos({ top: y + h, right: 12 }));
          }}
          style={styles.identity}
        >
          <TouchableOpacity
            onPress={() => {
              anchorRef.current?.measureInWindow((_x, y, _w, h) => setMenuPos({ top: y + h, right: 12 }));
              setMenuOpen(v => !v);
            }}
          >
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatar}
            onPress={() => {
              anchorRef.current?.measureInWindow((_x, y, _w, h) => setMenuPos({ top: y + h, right: 12 }));
              setMenuOpen(v => !v);
            }}
          >
            {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initial}</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bottomRow}>
        <CalendarSystemSwitch />
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)}>
          <View style={[styles.dropdown, { top: menuPos.top + 4, right: menuPos.right }]}>
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
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backButton: { marginLeft: -4, padding: 4 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '55%' },
  name: { fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 1 },
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
  bottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dropdown: {
    position: 'absolute',
    minWidth: 128,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    overflow: 'hidden',
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 12 },
  dropdownItemText: { fontSize: 13, fontWeight: '600', color: colors.criticalText },
});
