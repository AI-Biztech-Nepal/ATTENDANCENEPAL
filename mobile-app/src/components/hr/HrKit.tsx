import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { colors } from '../../theme';
import DatePicker from '../DatePicker';

/** Yes / no question. Alert.alert is a silent no-op when the app runs in a browser, so
 * there the browser's own confirm() is used instead (which also makes it testable). */
export function confirmAsync(title: string, message: string, confirmLabel = 'OK', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-restricted-globals
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false);
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** One-button message; see confirmAsync for why the browser case is separate. */
export function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled,
  small,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.btn,
        small && styles.btnSmall,
        tone === 'primary' && styles.btnPrimary,
        tone === 'ghost' && styles.btnGhost,
        tone === 'danger' && styles.btnDanger,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.btnText, small && { fontSize: 12 }, tone === 'primary' && { color: colors.white }, tone === 'ghost' && { color: colors.slate500 }, tone === 'danger' && { color: colors.criticalText }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** A tappable text link, the phone's version of the website's small "Edit" / "Delete" links. */
export function LinkText({ label, onPress, tone = 'accent', disabled }: { label: string; onPress: () => void; tone?: 'accent' | 'critical'; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
      <Text style={[styles.link, tone === 'critical' && { color: colors.criticalText }, disabled && { opacity: 0.5 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A card whose header toggles the body open and shut, so a long profile stays scannable. */
export function CollapsibleCard({
  title,
  summary,
  right,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel={`${title}, ${open ? 'collapse' : 'expand'}`} accessibilityState={{ expanded: open }} style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {summary ? <Text style={styles.cardSummary}>{summary}</Text> : null}
        </View>
        {right}
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

export function SubHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.subHeading}>
      <Text style={styles.subHeadingText}>{title.toUpperCase()}</Text>
      {action}
    </View>
  );
}

export function Notice({ tone, children }: { tone: 'warning' | 'error' | 'ok'; children: React.ReactNode }) {
  const palette = tone === 'warning' ? [colors.warningBg, colors.warningText] : tone === 'error' ? [colors.criticalBg, colors.criticalText] : [colors.goodBg, colors.goodText];
  return (
    <View style={[styles.notice, { backgroundColor: palette[0] }]}>
      <Text style={[styles.noticeText, { color: palette[1] }]}>{children}</Text>
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 72, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.slate400}
        keyboardType={keyboardType}
        multiline={multiline}
        accessibilityLabel={label}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** One choice out of a few, as tappable chips. `allowNone` adds a first chip that clears it. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  allowNone,
  noneLabel = 'Not set',
  accessibilityGroup,
}: {
  label?: string;
  options: { label: string; value: T }[];
  value: T | string | null | undefined;
  onChange: (v: T | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  /** Names the group for screen readers when there is no visible `label` (the chips would otherwise read as a bare "Pending"). */
  accessibilityGroup?: string;
}) {
  const group = label ?? accessibilityGroup;
  return (
    <View style={{ marginTop: 10 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chips}>
        {allowNone && (
          <Chip label={noneLabel} active={!value} onPress={() => onChange(null)} group={group} />
        )}
        {options.map(o => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} group={group} />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, group }: { label: string; active: boolean; onPress: () => void; group?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={group ? `${group}: ${label}` : label}
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function DateField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <DatePicker value={value} onChange={onChange} placeholder={placeholder} />
    </View>
  );
}

/** A form that slides up over the screen: scrollable body, Cancel + one action at the bottom. */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  onSubmit,
  saving,
  submitLabel,
  closeLabel = 'Cancel',
  error,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit?: () => void;
  saving?: boolean;
  submitLabel?: string;
  closeLabel?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !saving && onClose()} accessibilityLabel="Close" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.sheetTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {children}
            {error ? <Text style={styles.sheetError}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.sheetFooter}>
            <Button label={closeLabel} tone="ghost" onPress={onClose} disabled={saving} />
            {onSubmit && <Button label={saving ? 'Saving…' : submitLabel ?? 'Save'} onPress={onSubmit} disabled={saving} />}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Label on the left, value on the right; an empty value shows a dash. */
export function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {typeof value === 'string' || empty ? <Text style={styles.infoValue}>{empty ? '—' : value}</Text> : <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8 },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: colors.criticalBg },
  btnText: { fontSize: 14, fontWeight: '700' },
  link: { fontSize: 12, fontWeight: '700', color: colors.accent },

  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, marginBottom: 12, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  cardSummary: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  chevron: { fontSize: 16, color: colors.slate400, width: 18, textAlign: 'center' },
  cardBody: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.slate100 },

  subHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 4 },
  subHeadingText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.slate500 },

  notice: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  noticeText: { fontSize: 12, fontWeight: '600', lineHeight: 17 },

  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4 },
  hint: { fontSize: 11, color: colors.slate400, marginTop: 3 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink, backgroundColor: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.slate500 },
  chipTextActive: { color: colors.white },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 14, maxHeight: '90%' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  sheetSubtitle: { fontSize: 12, color: colors.slate500, marginTop: 2, marginBottom: 4 },
  sheetError: { fontSize: 12, color: colors.criticalText, marginTop: 10 },
  sheetFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  infoLabel: { fontSize: 12, color: colors.slate500, flexShrink: 0, maxWidth: '45%' },
  infoValue: { fontSize: 13, fontWeight: '600', color: colors.ink, flex: 1, textAlign: 'right' },
});
