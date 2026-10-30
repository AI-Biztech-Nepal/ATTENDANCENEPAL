import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { colors } from '../theme';

/** `onDark` is the pill version that sits on the employee header's green band. */
export default function CalendarSystemSwitch({ onDark = false }: { onDark?: boolean }) {
  const { system, setSystem } = useCalendarSystem();

  if (onDark) {
    return (
      <View style={styles.darkContainer}>
        {(['AD', 'BS'] as const).map(s => (
          <TouchableOpacity key={s} style={[styles.darkBtn, system === s && styles.darkBtnActive]} onPress={() => setSystem(s)}>
            <Text style={[styles.darkText, system === s && styles.darkTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={[styles.btn, styles.btnLeft, system === 'AD' && styles.btnActive]} onPress={() => setSystem('AD')}>
        <Text style={[styles.text, system === 'AD' && styles.textActive]}>AD</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnRight, system === 'BS' && styles.btnActive]} onPress={() => setSystem('BS')}>
        <Text style={[styles.text, system === 'BS' && styles.textActive]}>BS</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, overflow: 'hidden' },
  btn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.white },
  btnLeft: {},
  btnRight: { borderLeftWidth: 1, borderLeftColor: colors.slate200 },
  btnActive: { backgroundColor: colors.accent },
  text: { fontSize: 14, fontWeight: '700', color: colors.slate500 },
  textActive: { color: colors.white },
  darkContainer: { flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  darkBtn: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  darkBtnActive: { backgroundColor: colors.white },
  darkText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  darkTextActive: { color: colors.accent, fontWeight: '800' },
});
