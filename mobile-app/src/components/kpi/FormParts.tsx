import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, type KeyboardTypeOptions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../theme';
import { Sheet, SLATE } from './KpiUi';

// The pieces the feedback forms share, so they look and read the same: the customer form staff type in from paper and the colleague feedback
// form a person fills in themselves. Each is a list of numbered questions in boxes, answered with round numbers that have a word under them,
// like the paper form. Same idea as admin-web/components/kpi/FormParts.tsx.

/** One numbered question of a form, in a box like the paper's. */
export function Question({ n, title, range, children }: { n: number; title: string; range?: string; children: React.ReactNode }) {
  return (
    <View style={f.question}>
      <View style={f.questionHead}>
        <View style={f.questionNumber}>
          <Text style={f.questionNumberText}>{n}</Text>
        </View>
        <Text style={f.questionTitle} accessibilityRole="header">
          {title}
          {range ? <Text style={{ fontWeight: '500', color: SLATE[600] }}> {range}</Text> : null}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** A round number to circle: filled when chosen, an outline otherwise. */
export function Circle({ n, on, onPress, size = 44, label }: { n: number; on: boolean; onPress: () => void; size?: number; label: string }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[f.circle, { width: size, height: size, borderRadius: size / 2 }, on && f.circleOn]}
    >
      <Text style={[f.circleText, on && { color: colors.white }]}>{n}</Text>
    </TouchableOpacity>
  );
}

/** A labelled text box. `error` outlines it red. */
export function Field({ label, value, onChange, placeholder, keyboard, multiline = false, maxLength, error = false, optional = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: KeyboardTypeOptions;
  multiline?: boolean;
  maxLength?: number;
  error?: boolean;
  optional?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={f.label}>
        {label}
        {optional ? <Text style={{ fontWeight: '500', color: SLATE[600] }}> (optional)</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.slate400}
        keyboardType={keyboard}
        multiline={multiline}
        maxLength={maxLength}
        style={[f.input, multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }, error && { borderColor: colors.critical }]}
      />
    </View>
  );
}

/** A box that shows the choice made and opens a list to choose from (with a search box when the list is long). */
export function PickerField<T extends string>({ label, value, options, onChange, placeholder = 'Select…', title }: {
  label: string;
  value: T | '';
  options: { id: T; label: string; sub?: string; disabled?: boolean }[];
  onChange: (id: T) => void;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = options.find(o => o.id === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter(o => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(t)) : options;
  }, [options, q]);
  return (
    <View style={{ gap: 6 }}>
      <Text style={f.label}>{label}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${label}: ${chosen ? chosen.label : 'none chosen'}`} onPress={() => setOpen(true)} style={f.picker}>
        <Text style={[f.pickerText, !chosen && { color: colors.slate400, fontWeight: '400' }]} numberOfLines={1}>
          {chosen ? `${chosen.label}${chosen.sub ? ` · ${chosen.sub}` : ''}` : placeholder}
        </Text>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.slate500} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m6 9 6 6 6-6" />
        </Svg>
      </TouchableOpacity>
      {open && (
        <Sheet
          title={title ?? label}
          onClose={() => {
            setOpen(false);
            setQ('');
          }}
        >
          {options.length > 8 && <Field label="Search" value={q} onChange={setQ} placeholder="Type a name" />}
          {shown.length === 0 && <Text style={{ fontSize: 14, color: SLATE[600], paddingVertical: 12 }}>Nobody matches.</Text>}
          {shown.map(o => (
            <TouchableOpacity
              key={o.id}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              disabled={o.disabled}
              onPress={() => {
                onChange(o.id);
                setOpen(false);
                setQ('');
              }}
              style={[f.option, o.disabled && { opacity: 0.45 }, o.id === value && { backgroundColor: colors.accentLight }]}
            >
              <Text style={f.optionText}>{o.label}</Text>
              {o.sub ? <Text style={f.optionSub}>{o.sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </Sheet>
      )}
    </View>
  );
}

const f = StyleSheet.create({
  question: { borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50, padding: 14, marginBottom: 12 },
  questionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  questionNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  questionNumberText: { fontSize: 11, fontWeight: '800', color: colors.white },
  questionTitle: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.ink, lineHeight: 19 },
  circle: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  circleOn: { borderColor: '#0f766e', backgroundColor: '#0f766e' },
  circleText: { fontSize: 15, fontWeight: '800', color: SLATE[700] },
  label: { fontSize: 12.5, fontWeight: '700', color: SLATE[700] },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white, paddingHorizontal: 12, fontSize: 15, color: colors.ink },
  picker: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  option: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10 },
  optionText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  optionSub: { fontSize: 12.5, color: SLATE[600], marginTop: 1 },
});
