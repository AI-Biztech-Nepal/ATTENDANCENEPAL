import { StyleSheet, Text, TextInput } from 'react-native';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

// Manrope, the typeface from the approved design, for every Text and
// TextInput in the app. React Native has no global font setting, and each
// weight is its own font file (fontWeight alone can't pick one on Android),
// so this maps each style's fontWeight to the matching Manrope family.

export const MANROPE_FONTS = {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
};

const FAMILY_BY_WEIGHT: Record<string, string> = {
  '100': 'Manrope_400Regular',
  '200': 'Manrope_400Regular',
  '300': 'Manrope_400Regular',
  '400': 'Manrope_400Regular',
  normal: 'Manrope_400Regular',
  '500': 'Manrope_500Medium',
  '600': 'Manrope_600SemiBold',
  '700': 'Manrope_700Bold',
  bold: 'Manrope_700Bold',
  '800': 'Manrope_800ExtraBold',
  '900': 'Manrope_800ExtraBold',
};

function withManrope(style: any) {
  const flat = StyleSheet.flatten(style) ?? {};
  // A style that names its own font (e.g. a monospace code field) keeps it.
  if (flat.fontFamily) return style;
  const family = FAMILY_BY_WEIGHT[String(flat.fontWeight ?? '400')] ?? 'Manrope_400Regular';
  // fontWeight reset to normal: the family already is that weight, and
  // leaving it set makes Android fake-bold the face a second time.
  return [style, { fontFamily: family, fontWeight: 'normal' }];
}

/** Call once the fonts have loaded (idempotent). Until then — or for good, if
 * loading fails — text keeps the system font instead of naming a font that
 * isn't there. Text and TextInput are forwardRef components in React Native
 * (and react-native-web), so wrapping their render function reaches every
 * use without changing each screen's imports. */
export function applyManropeGlobally() {
  for (const component of [Text, TextInput] as any[]) {
    if (component.__manrope || typeof component.render !== 'function') continue;
    const render = component.render;
    component.render = function (props: any, ref: any) {
      return render.call(this, { ...props, style: withManrope(props.style) }, ref);
    };
    component.__manrope = true;
  }
}
