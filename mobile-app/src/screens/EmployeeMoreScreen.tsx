import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import { CardIcon, PersonIcon, type IconProps } from '../components/icons';

type Tile = { screen: 'Payroll' | 'Profile'; label: string; icon: (p: IconProps) => JSX.Element };

// The employee pages that are not one of the four bottom tabs, so the bar stays at five slots like the website's phone bar
// (admin-web/components/EmployeeShell.tsx: More holds Payroll, Feedback and Profile; Feedback is a section of the KPIs tab here).
const TILES: Tile[] = [
  { screen: 'Payroll', label: 'Payroll', icon: CardIcon },
  { screen: 'Profile', label: 'Profile', icon: PersonIcon },
];

export default function EmployeeMoreScreen({ navigation }: any) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.grid}>
        {TILES.map(t => {
          const Icon = t.icon;
          return (
            <TouchableOpacity key={t.screen} accessibilityRole="button" accessibilityLabel={t.label} style={styles.tile} onPress={() => navigation.navigate(t.screen)}>
              <View style={styles.tileIcon}>
                <Icon size={18} color={colors.accent} />
              </View>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate100 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  tileIcon: { height: 36, width: 36, borderRadius: 18, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12, fontWeight: '700', color: colors.ink, textAlign: 'center' },
});
