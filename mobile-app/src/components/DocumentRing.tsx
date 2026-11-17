import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme';

// Same ring as the website's profile page, sized for the phone's 64 px photo: a 4 px gap, then the track.
const SIZE = 80;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const LENGTH = 2 * Math.PI * RADIUS;

/** A ring around the profile photo showing how much of the document checklist is on file:
 * green and closed when every kind is there, orange and part-filled while some are missing, with an
 * "n/total" pill on it that opens the documents. `have` is null until the count is known (or when it
 * can't be read) — then there is no ring. */
export default function DocumentRing({ have, total, onOpen, children }: { have: number | null; total: number; onOpen: () => void; children: React.ReactNode }) {
  const known = have !== null && total > 0;
  const complete = known && have >= total;
  const label = known ? (complete ? `All ${total} documents on file` : `${have} of ${total} documents on file — ${total - have} missing`) : undefined;

  return (
    <View style={styles.box}>
      {known && (
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={StyleSheet.absoluteFill}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={colors.slate200} strokeWidth={STROKE} />
          {have > 0 && (
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={complete ? colors.good : colors.warning}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${LENGTH * Math.min(have / total, 1)} ${LENGTH}`}
              rotation={-90}
              origin={`${SIZE / 2}, ${SIZE / 2}`}
            />
          )}
        </Svg>
      )}
      {children}
      {known && (
        <TouchableOpacity
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Open documents`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.pill, complete ? styles.pillGood : styles.pillWarn]}
        >
          {complete && (
            <Svg width={10} height={10} viewBox="0 0 24 24">
              <Path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke={colors.goodText} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          )}
          <Text style={[styles.pillText, { color: complete ? colors.goodText : colors.warningText }]}>
            {have}/{total}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', bottom: -7, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, borderWidth: 2, borderColor: colors.white, paddingHorizontal: 7, paddingVertical: 2 },
  pillGood: { backgroundColor: colors.goodBg },
  pillWarn: { backgroundColor: colors.warningBg },
  pillText: { fontSize: 11, fontWeight: '800', lineHeight: 13 },
});
