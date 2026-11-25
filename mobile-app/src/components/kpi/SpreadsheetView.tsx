import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import { SLATE } from './KpiUi';

// A read-only spreadsheet, laid out like Excel: column letters (A, B, C ...), row numbers, thin grid lines, the first row as the bold heading
// row, a cell you can select (by tapping it) and a formula bar that shows the selected cell's whole text. Only the rows near the screen are
// drawn, so a file of 20,000 rows scrolls as smoothly as one of 20. Used for the file being imported and for an earlier import opened from the
// history. Same as admin-web/components/kpi/Sheet.tsx.

export type SheetColumn = {
  /** The heading, shown in the first row. */
  header: string;
  width: number;
  align?: 'left' | 'right';
  /** A column that is not used: its text is greyed. */
  muted?: boolean;
  /** Something to show between the column letters and the first row, such as what the column is used for. */
  top?: string;
};

/** A row that is left out: 'skip' is shaded amber, 'alert' (something to do about it) rose. */
export type RowTone = 'skip' | 'alert' | null | undefined;

export const ROW_H = 36;
const LETTER_H = 26;
const TOP_H = 30;
const NUM_W = 48;

/** The column's letter as Excel names it: A to Z, then AA, AB ... */
export function colLetter(index: number): string {
  let s = '';
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

type Selected = { row: number; col: number };

const RowView = memo(function RowView({ index, columns, cells, tone, selectedCol, onSelect }: { index: number; columns: SheetColumn[]; cells: string[] | null; tone: RowTone; selectedCol: number; onSelect: (row: number, col: number) => void }) {
  const heading = index === 0;
  const bg = heading ? colors.slate50 : tone === 'alert' ? '#fff1f2' : tone === 'skip' ? '#fffbeb' : colors.white;
  return (
    <View style={[s.row, { backgroundColor: bg }]}>
      <View style={[s.num, selectedCol >= 0 && { backgroundColor: '#ccfbf1' }]}>
        <Text style={s.numText}>{index + 1}</Text>
      </View>
      {columns.map((c, ci) => {
        const text = heading ? c.header : cells?.[ci] ?? '';
        return (
          <Pressable
            key={ci}
            accessibilityRole="button"
            accessibilityLabel={`${colLetter(ci)}${index + 1}: ${text || 'empty'}`}
            onPress={() => onSelect(index, ci)}
            style={[s.cell, { width: c.width }, selectedCol === ci && s.cellSelected]}
          >
            <Text numberOfLines={1} style={[s.cellText, heading && { fontWeight: '800' }, c.muted && !heading && { color: colors.slate400 }, c.align === 'right' && { textAlign: 'right' }]}>
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

export default function SpreadsheetView({ label, columns, rows, tone, note, loading = false }: {
  /** What the sheet is, for screen readers. */
  label: string;
  columns: SheetColumn[];
  /** The rows under the heading row, as text. */
  rows: string[][];
  /** Whether a row is left out, by its position in `rows`. */
  tone?: (index: number) => RowTone;
  /** What to say about a row in the formula bar when one of its cells is selected. */
  note?: (index: number) => string | undefined;
  loading?: boolean;
}) {
  // row 0 is the heading row (Excel's row 1); row n is rows[n - 1] (Excel's row n + 1)
  const [sel, setSel] = useState<Selected>({ row: 0, col: 0 });
  const select = useCallback((row: number, col: number) => setSel({ row, col }), []);
  const totalW = NUM_W + columns.reduce((n, c) => n + c.width, 0);
  const hasTop = columns.some(c => c.top);
  const data = useMemo(() => Array.from({ length: rows.length + 1 }, (_, i) => i), [rows.length]);

  const selText = sel.row === 0 ? columns[sel.col]?.header ?? '' : rows[sel.row - 1]?.[sel.col] ?? '';
  const selNote = sel.row > 0 ? note?.(sel.row - 1) : undefined;

  return (
    <View accessibilityLabel={label} style={s.wrap}>
      <View style={s.formula}>
        <Text style={s.ref}>{columns.length ? `${colLetter(sel.col)}${sel.row + 1}` : ''}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.formulaText} numberOfLines={3} accessibilityLabel="Selected cell">
            {selText}
          </Text>
          {selNote ? <Text style={s.formulaNote}>{selNote}</Text> : null}
        </View>
      </View>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: totalW }} showsHorizontalScrollIndicator>
        <View style={{ width: totalW, flex: 1 }}>
          <View style={s.letters}>
            <View style={{ width: NUM_W }} />
            {columns.map((c, i) => (
              <View key={i} style={[s.letter, { width: c.width }, sel.col === i && { backgroundColor: '#ccfbf1' }]}>
                <Text style={s.letterText}>{colLetter(i)}</Text>
              </View>
            ))}
          </View>
          {hasTop ? (
            <View style={s.tops}>
              <View style={{ width: NUM_W }} />
              {columns.map((c, i) => (
                <View key={i} style={[s.top, { width: c.width }]}>
                  <Text numberOfLines={1} style={[s.topText, c.muted && { color: colors.slate400, fontWeight: '600' }]}>
                    {c.top ?? ''}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {loading && rows.length === 0 ? (
            <Text style={s.loading}>Loading…</Text>
          ) : (
            <FlatList
              data={data}
              keyExtractor={i => String(i)}
              extraData={sel}
              getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
              initialNumToRender={24}
              maxToRenderPerBatch={30}
              windowSize={9}
              removeClippedSubviews
              nestedScrollEnabled
              renderItem={({ item }) => <RowView index={item} columns={columns} cells={item === 0 ? null : rows[item - 1]} tone={item === 0 ? null : tone?.(item - 1)} selectedCol={sel.row === item ? sel.col : -1} onSelect={select} />}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.white },
  formula: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.slate200, backgroundColor: colors.slate50 },
  ref: { minWidth: 44, fontSize: 12.5, fontWeight: '800', color: SLATE[700] },
  formulaText: { fontSize: 13.5, color: colors.ink, minHeight: 18 },
  formulaNote: { fontSize: 12, fontWeight: '700', color: '#92400e', marginTop: 2 },
  letters: { flexDirection: 'row', height: LETTER_H, backgroundColor: colors.slate100, borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  letter: { alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: '#cbd5e1' },
  letterText: { fontSize: 11.5, fontWeight: '700', color: SLATE[600] },
  tops: { flexDirection: 'row', height: TOP_H, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  top: { justifyContent: 'center', paddingHorizontal: 8, borderLeftWidth: 1, borderLeftColor: colors.slate200 },
  topText: { fontSize: 11.5, fontWeight: '800', color: colors.accent },
  row: { flexDirection: 'row', height: ROW_H, borderBottomWidth: 1, borderBottomColor: colors.slate200 },
  num: { width: NUM_W, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate100, borderRightWidth: 1, borderRightColor: '#cbd5e1' },
  numText: { fontSize: 11.5, color: SLATE[600] },
  cell: { justifyContent: 'center', paddingHorizontal: 8, borderLeftWidth: 1, borderLeftColor: colors.slate200 },
  cellSelected: { borderWidth: 2, borderColor: '#0f766e' },
  cellText: { fontSize: 13, color: colors.ink },
  loading: { padding: 24, textAlign: 'center', fontSize: 14, color: SLATE[600] },
});
