import React, { useEffect, useReducer } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { BackIcon } from '../components/icons';

// Shared by AdminHeader and EmployeeHeader. Renders only when there's
// somewhere to go back to — a pushed page, or a tab/drawer section reached
// from another one (both navigators use backBehavior="history"). Re-checks
// on focus because a header stays mounted while its screen is hidden, and
// the answer changes as other sections are visited in the meantime.
export default function HeaderBackButton({ navigation, color }: { navigation: any; color?: string }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => navigation?.addListener('focus', rerender), [navigation]);

  if (!navigation?.canGoBack()) return null;
  return (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={styles.button}
    >
      <BackIcon color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { marginLeft: -4, padding: 4 },
});
