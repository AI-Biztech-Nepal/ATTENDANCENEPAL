import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

type ToastApi = { show: (text: string) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });

const VISIBLE_MS = 3000;

/** A small message that pops up at the top right and goes away by itself — for "it worked" feedback that needs
 * no answer. Mounted once in App.tsx; any screen calls `useToast().show('Saved successfully')`. A second message
 * replaces the first instead of stacking. (Same idea as admin-web/components/Toast.tsx.) */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, text });
    timer.current = setTimeout(() => setToast(current => (current?.id === id ? null : current)), VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        // Below the green header, so it never covers the bell or the account menu; it ignores touches.
        <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 66 }]}>
          <View key={toast.id} style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <View style={styles.tick}>
              <Text style={styles.tickText}>✓</Text>
            </View>
            <Text style={styles.text}>{toast.text}</Text>
          </View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 12, zIndex: 1000, elevation: 10 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
  },
  tick: { height: 20, width: 20, borderRadius: 10, backgroundColor: colors.goodBg, alignItems: 'center', justifyContent: 'center' },
  tickText: { color: colors.goodText, fontSize: 12, fontWeight: '800' },
  text: { color: colors.goodText, fontSize: 13, fontWeight: '700' },
});
