import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';
import { formatAdDate } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { nepalTodayIso } from '../../lib/shift';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { MIGRATION } from '../../lib/kpiLoad';
import {
  CHUNK_SIZE,
  ROLE_LABEL,
  SKIP_NOTE,
  analyse,
  buildRecords,
  chunk,
  defaultCounted,
  detectDateOrder,
  distinctValues,
  guessRoles,
  guessUnit,
  readTable,
  type ColumnRole,
  type DateOrder,
  type EmployeeRef,
  type Table,
} from '../../lib/serviceImport';
import { Button, Segmented, SLATE, useAsk } from './KpiUi';
import { PickerField } from './FormParts';
import SpreadsheetView, { colLetter, type RowTone, type SheetColumn } from './SpreadsheetView';

const MAX_BYTES = 10 * 1024 * 1024;
const ROLES: ColumnRole[] = ['employee', 'date', 'service', 'minutes', 'customerName', 'customerPhone', 'customer', 'status', 'ignore'];

export type PastImport = { id: string; file_name: string; rows_read: number; rows_imported: number; first_date: string | null; last_date: string | null; created_at: string };
type Person = EmployeeRef & { status: string };

/** Reads a picked file as text, on the phone and in the browser. */
async function readText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') return asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
  return await FileSystem.readAsStringAsync(asset.uri);
}

/** A pop-up that fills the screen: a title block with a close button, optional buttons under it, and a body that takes the rest. */
function FullScreen({ title, subtitle, onClose, actions, children, footer }: { title: string; subtitle?: string; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
        <View style={f.head}>
          <View style={{ flex: 1 }}>
            <Text style={f.title} numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={f.sub}>{subtitle}</Text> : null}
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close the sheet" onPress={onClose} style={f.close}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={SLATE[600]} strokeWidth={2.2} strokeLinecap="round">
              <Path d="M6 6l12 12M18 6 6 18" />
            </Svg>
          </TouchableOpacity>
        </View>
        {actions ? <View style={f.actions}>{actions}</View> : null}
        <View style={{ flex: 1 }}>{children}</View>
        {footer ? <View style={[f.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

/**
 * Service import (for the whole company: the same on every person's screen): the booking system's file (a CSV) is read here and shown as a
 * sheet, like Excel. The admin says what each column is, names the file does not match to an employee are matched by hand, and the rows are
 * saved, with each customer's name and phone number when the file has them (a customer's visits are told apart by phone, then name, then the
 * booking system's ID). Rows that were already imported (an export that overlaps an earlier one) are left out, and a whole import can be removed.
 * An earlier import opens as a sheet. Same as admin-web/app/(admin)/kpis/[employeeId]/import/page.tsx.
 */
export default function ImportSection() {
  const { system } = useCalendarSystem();
  const ask = useAsk();
  // What this company calls the people it serves (KPIs > Settings).
  const { words } = useKpiSettings();
  const today = useMemo(nepalTodayIso, []);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [past, setPast] = useState<PastImport[] | null>(null);
  const [pastError, setPastError] = useState('');
  const [opened, setOpened] = useState<PastImport | null>(null);

  const [file, setFile] = useState<{ name: string; table: Table } | null>(null);
  const [readError, setReadError] = useState('');
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [unit, setUnit] = useState<'minutes' | 'hours'>('minutes');
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [counted, setCounted] = useState<Set<string>>(new Set());
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const loadPast = useCallback(() => {
    Promise.resolve(
      supabase
        .from('service_imports')
        .select('id, file_name, rows_read, rows_imported, first_date, last_date, created_at')
        .order('created_at', { ascending: false })
        .limit(20)
    ).then(({ data, error: e }) => {
      if (e) setPastError(`Could not load earlier imports: ${e.message}`);
      else setPastError('');
      setPast((data as PastImport[] | null) ?? []);
    });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
      if (live) setCompanyId((data?.company_id as string | null) ?? null);
    })();
    Promise.resolve(supabase.from('employees').select('id, name, employee_code, status')).then(
      ({ data }) => live && setPeople(((data as Person[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
    );
    loadPast();
    return () => {
      live = false;
    };
  }, [loadPast]);

  const analysis = useMemo(
    () => (file ? analyse(file.table, { roles, unit, dateOrder, counted: roles.includes('status') ? counted : null }, people, nameMap, today) : null),
    [file, roles, unit, dateOrder, counted, people, nameMap, today]
  );

  async function chooseFile() {
    setReadError('');
    setError('');
    setDone('');
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'The file could not be opened.');
      return;
    }
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    if (!/\.(csv|txt)$/i.test(asset.name)) {
      setReadError('Only CSV files can be imported. In Excel, choose File, Save As, and pick "CSV".');
      return;
    }
    if ((asset.size ?? 0) > MAX_BYTES) {
      setReadError('That file is larger than 10 MB. Split it by month and import each part.');
      return;
    }
    try {
      const table = readTable(await readText(asset));
      const guessed = guessRoles(table.headers);
      const dateCol = guessed.indexOf('date');
      const minutesCol = guessed.indexOf('minutes');
      const statusCol = guessed.indexOf('status');
      setFile({ name: asset.name, table });
      setRoles(guessed);
      setUnit(minutesCol >= 0 ? guessUnit(table.headers[minutesCol]) : 'minutes');
      setDateOrder(dateCol >= 0 ? detectDateOrder(table.rows.map(r => r[dateCol])).order : 'dmy');
      setCounted(statusCol >= 0 ? defaultCounted(distinctValues(table, statusCol).map(v => v.value)) : new Set());
      setNameMap({});
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'The file could not be read.');
    }
  }

  function changeRole(index: number, role: ColumnRole) {
    if (!file) return;
    // Names matched by hand belong to the column they were read from.
    if (role === 'employee' || roles[index] === 'employee') setNameMap({});
    setRoles(prev => prev.map((r, i) => (i === index ? role : role !== 'ignore' && r === role ? 'ignore' : r)));
    if (role === 'minutes') setUnit(guessUnit(file.table.headers[index]));
    if (role === 'status') setCounted(defaultCounted(distinctValues(file.table, index).map(v => v.value)));
    if (role === 'date') setDateOrder(detectDateOrder(file.table.rows.map(r => r[index])).order);
  }

  function reset() {
    setFile(null);
    setRoles([]);
    setNameMap({});
    setReadError('');
    setError('');
    setSheetOpen(false);
  }

  async function runImport() {
    if (!file || !analysis || !companyId || busy || analysis.rows.length === 0) return;
    setBusy(true);
    setError('');
    const made = await supabase
      .from('service_imports')
      .insert({ file_name: file.name.slice(0, 200), rows_read: analysis.counts.read, first_date: analysis.firstDate, last_date: analysis.lastDate })
      .select('id');
    const importId = (made.data as { id: string }[] | null)?.[0]?.id;
    if (made.error || !importId) {
      setBusy(false);
      setError(`Could not start the import: ${made.error?.message ?? 'nothing was created'}`);
      return;
    }
    // Everything or nothing: if any part fails, the import is removed again and with it every row it already added.
    const undo = async () => {
      await supabase.from('service_imports').delete().eq('id', importId);
    };
    let added = 0;
    let total = 0;
    try {
      const records = await buildRecords(analysis.rows, companyId, importId);
      total = records.length;
      for (const part of chunk(records, CHUNK_SIZE)) {
        const res = await supabase.from('service_records').upsert(part, { onConflict: 'row_key', ignoreDuplicates: true }).select('id');
        if (res.error) {
          // The name and phone columns come with 20261125160000_guest_names_and_history.sql: say so when it has not been run.
          throw new Error(/customer_(name|phone)/.test(res.error.message) ? `the database cannot keep customer names yet: run the migration ${MIGRATION.guests2}` : res.error.message);
        }
        added += ((res.data as unknown[] | null) ?? []).length;
      }
    } catch (e) {
      await undo();
      setBusy(false);
      setError(`The import was stopped and nothing was saved: ${e instanceof Error ? e.message : 'something went wrong'}`);
      return;
    }
    if (added === 0) {
      await undo();
      setBusy(false);
      reset();
      setDone(`Nothing new: all ${total} rows had already been imported.`);
      loadPast();
      return;
    }
    const fin = await supabase.from('service_imports').update({ rows_imported: added }).eq('id', importId).select('id');
    setBusy(false);
    if (fin.error) setError(`The rows were saved but the import could not be updated: ${fin.error.message}`);
    const already = total - added;
    const name = file.name;
    reset();
    setDone(`Imported ${added} ${added === 1 ? 'row' : 'rows'} from ${name}.${already > 0 ? ` ${already} ${already === 1 ? 'was' : 'were'} already imported and left out.` : ''}`);
    loadPast();
  }

  /** Asks first, then removes an earlier import and every service it added. */
  async function removeImport(p: PastImport): Promise<{ removed: boolean; error: string }> {
    const ok = await ask(`Remove the import of ${p.file_name}? The ${p.rows_imported === 1 ? 'service' : `${p.rows_imported} services`} it added will no longer count. The file itself is not touched. This cannot be undone.`, 'Remove import');
    if (!ok) return { removed: false, error: '' };
    const res = await supabase.from('service_imports').delete().eq('id', p.id).select('id');
    let result: { removed: boolean; error: string };
    if (res.error || !((res.data as unknown[] | null) ?? []).length) {
      result = { removed: false, error: `Could not remove it: ${res.error?.message ?? 'it was not found'}` };
      setPastError(result.error);
    } else {
      result = { removed: true, error: '' };
      setPastError('');
      setDone('');
    }
    loadPast();
    return result;
  }

  const c = analysis?.counts;
  const missing = analysis?.missing ?? [];
  // Names not recognised, then the ones already matched by hand, so a choice can still be changed.
  const nameList = useMemo(() => {
    const unknown = (analysis?.unmatchedNames ?? []).map(u => u.name);
    return [...unknown, ...Object.keys(nameMap).filter(k => nameMap[k] && !unknown.includes(k))];
  }, [analysis, nameMap]);
  const statusCol = roles.indexOf('status');
  const statusValues = useMemo(() => (file && statusCol >= 0 ? distinctValues(file.table, statusCol) : []), [file, statusCol]);
  const dateCol = roles.indexOf('date');
  const dateInfo = useMemo(() => (file && dateCol >= 0 ? detectDateOrder(file.table.rows.map(r => r[dateCol])) : null), [file, dateCol]);
  const slashDates = useMemo(() => !!file && dateCol >= 0 && file.table.rows.some(r => /^\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}/.test(r[dateCol])), [file, dateCol]);
  const dayText = useCallback((d: string) => formatAdDate(d, system), [system]);
  const heading = useCallback((role: ColumnRole) => words.t(ROLE_LABEL[role]), [words]);

  // The sheet of the chosen file: each column says what it is used for, and the rows that are left out are shaded.
  const sheetColumns: SheetColumn[] = useMemo(() => {
    if (!file) return [];
    return file.table.headers.map((h, i) => {
      let longest = h.length;
      for (let r = 0; r < Math.min(file.table.rows.length, 200); r++) longest = Math.max(longest, file.table.rows[r][i].length);
      const role = roles[i] ?? 'ignore';
      return { header: h, width: Math.min(260, Math.max(140, longest * 8 + 28)), muted: role === 'ignore', top: role === 'ignore' ? 'Not used' : heading(role) };
    });
  }, [file, roles, heading]);
  const rowTone = (i: number): RowTone => {
    const why = analysis?.rowStatus[i];
    return why ? (why === 'unmatched' ? 'alert' : 'skip') : null;
  };
  const rowNote = (i: number) => {
    const why = analysis?.rowStatus[i];
    return why ? SKIP_NOTE[why] : analysis && analysis.rowStatus.length > 0 ? 'Will be imported.' : undefined;
  };

  const checkRows: [string, number, boolean][] = c
    ? [
        ['Rows read', c.read, true],
        ['Will be imported', c.import, true],
        ['Skipped, status not counted', c.notCounted, false],
        ['Skipped, no employee named', c.noName, false],
        ['Need a name matched', c.unmatched, false],
        ['Left out by your choice', c.skippedByChoice, false],
        ['Skipped, date not understood', c.badDate, false],
        ['Skipped, time not understood', c.badTime, false],
        ['Skipped, dated in the future', c.future, false],
      ]
    : [];

  return (
    <View style={{ gap: 14 }}>
      {done ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.done}>
          {done}
        </Text>
      ) : null}

      {!file ? (
        <View accessibilityLabel="Upload the file" style={s.card}>
          <Text style={s.title} accessibilityRole="header">
            Upload the file
          </Text>
          <Text style={s.help}>Export your bookings from your booking system as a CSV file and choose it here. Each row should be one service an employee performed. In Excel, use File, Save As, and pick "CSV".</Text>
          <Button label="Choose a file" onPress={chooseFile} />
          <Text style={s.limit}>CSV only, up to 10 MB and 20,000 rows.</Text>
          {readError ? (
            <Text accessibilityRole="alert" style={s.error}>
              {readError}
            </Text>
          ) : null}
          <Text style={s.tip}>{words.t('Include the customer name and phone columns: they show who each customer is, and tell when the same customer comes back.')}</Text>
        </View>
      ) : (
        <>
          <View accessibilityLabel="The file" style={s.card}>
            <Text style={s.title} numberOfLines={2} accessibilityRole="header">
              {file.name}
            </Text>
            <Text style={s.help}>{file.table.rows.length} rows</Text>
            <View style={{ gap: 10 }}>
              <Button label="Open as a sheet" kind="outline" onPress={() => setSheetOpen(true)} />
              <Button label={busy ? 'Importing…' : `Import ${c?.import ?? 0} ${c?.import === 1 ? 'row' : 'rows'}`} onPress={runImport} busy={busy} disabled={!companyId || missing.length > 0 || (c?.import ?? 0) === 0} />
              <Button label="Back" kind="outline" onPress={reset} disabled={busy} />
            </View>
            {missing.length > 0 ? (
              <Text accessibilityRole="alert" style={[s.error, { marginTop: 10 }]}>
                Choose which column is the {missing.map(m => ROLE_LABEL[m].toLowerCase()).join(' and the ')}.
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={[s.error, { marginTop: 10 }]}>
                {error}
              </Text>
            ) : null}
          </View>

          <View accessibilityLabel="What each column is" style={s.card}>
            <Text style={s.title} accessibilityRole="header">
              What each column is
            </Text>
            {file.table.headers.map((h, i) => {
              const sample = file.table.rows.slice(0, 50).map(r => r[i]).find(v => v && v.trim());
              return (
                <View key={i} style={s.colRow}>
                  <PickerField label={`Column ${colLetter(i)} · ${h}`} title="Use it for" value={roles[i] ?? 'ignore'} options={ROLES.map(r => ({ id: r, label: heading(r) }))} onChange={r => changeRole(i, r)} />
                  <Text style={s.sample}>{sample ? `e.g. ${sample}` : 'Empty in the first rows'}</Text>
                </View>
              );
            })}
          </View>

          {(roles.includes('minutes') || slashDates || statusValues.length > 0) && (
            <View accessibilityLabel="How to read the file" style={s.card}>
              {roles.includes('minutes') && (
                <View style={s.option}>
                  <Text style={s.optionLabel}>{words.t('The time with the customer is in')}</Text>
                  <Segmented label="Time unit" value={unit} options={[{ id: 'minutes', label: 'minutes' }, { id: 'hours', label: 'hours' }]} onChange={setUnit} />
                </View>
              )}
              {slashDates && (
                <View style={s.option}>
                  <Text style={s.optionLabel}>Dates are written</Text>
                  <Segmented label="Date order" value={dateOrder} options={[{ id: 'dmy', label: 'day / month / year' }, { id: 'mdy', label: 'month / day / year' }]} onChange={setDateOrder} />
                  {dateInfo?.ambiguous ? <Text style={s.warn}>Check this: your dates could be read either way.</Text> : null}
                </View>
              )}
              {statusValues.length > 0 && (
                <View style={s.option}>
                  <Text style={s.optionLabel}>Count as a service</Text>
                  {statusValues.map(v => {
                    const on = counted.has(v.value);
                    return (
                      <TouchableOpacity
                        key={v.value}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Count ${v.value || '(blank)'} as a service`}
                        accessibilityState={{ checked: on }}
                        onPress={() =>
                          setCounted(prev => {
                            const next = new Set(prev);
                            if (next.has(v.value)) next.delete(v.value);
                            else next.add(v.value);
                            return next;
                          })
                        }
                        style={s.check}
                      >
                        <View style={[s.box, on && s.boxOn]}>
                          {on ? (
                            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                              <Path d="m5 12 5 5 9-10" />
                            </Svg>
                          ) : null}
                        </View>
                        <Text style={{ flex: 1, fontSize: 14.5, color: colors.ink }}>
                          {v.value || '(blank)'} <Text style={{ color: SLATE[600] }}>({v.rows})</Text>
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View accessibilityLabel="Import check" style={s.card}>
            {checkRows
              .filter(([, n, always]) => always || n > 0)
              .map(([label, n]) => (
                <View key={label} style={s.checkRow} accessible accessibilityLabel={`${label}: ${n}`}>
                  <Text style={s.checkLabel}>{label}</Text>
                  <Text style={s.checkValue}>{n}</Text>
                </View>
              ))}
          </View>

          {analysis && nameList.length > 0 && (
            <View accessibilityLabel="Names to match" style={[s.card, analysis.counts.unmatched > 0 && { backgroundColor: '#fffbeb', borderColor: '#fde68a' }]}>
              <Text style={[s.title, analysis.counts.unmatched > 0 && { color: '#78350f' }]} accessibilityRole="header">
                {analysis.counts.unmatched > 0 ? `${analysis.counts.unmatched} ${analysis.counts.unmatched === 1 ? 'row has' : 'rows have'} a name we do not know` : 'Names you matched by hand'}
              </Text>
              {nameList.slice(0, 20).map(name => (
                <View key={name} style={{ marginTop: 10 }}>
                  <PickerField
                    label={`Match “${name}” to`}
                    title="Choose an employee"
                    value={nameMap[name] ?? ''}
                    placeholder="Choose an employee…"
                    options={[{ id: 'skip', label: 'Skip these rows' }, ...people.map(p => ({ id: p.id, label: `${p.name}${p.status !== 'active' ? ' (left)' : ''}` }))]}
                    onChange={id => setNameMap(m => ({ ...m, [name]: id }))}
                  />
                </View>
              ))}
              {nameList.length > 20 ? <Text style={s.warn}>…and {nameList.length - 20} more names. Rows with a name left unmatched are skipped.</Text> : null}
            </View>
          )}
        </>
      )}

      <View accessibilityLabel="Earlier imports" style={s.card}>
        <Text style={s.title} accessibilityRole="header">
          Earlier imports
        </Text>
        {pastError ? (
          <Text accessibilityRole="alert" style={s.error}>
            {pastError}
          </Text>
        ) : null}
        {past === null ? (
          <Text style={s.empty}>Loading…</Text>
        ) : past.length === 0 ? (
          <Text style={s.empty}>Nothing has been imported yet.</Text>
        ) : (
          past.map(p => (
            <View key={p.id} style={s.pastRow}>
              <Text style={s.pastName}>{p.file_name}</Text>
              <Text style={s.pastSub}>
                {p.first_date && p.last_date ? (p.first_date === p.last_date ? dayText(p.first_date) : `${dayText(p.first_date)} to ${dayText(p.last_date)}`) : '–'}
              </Text>
              <Text style={s.pastSub}>
                {p.rows_imported} of {p.rows_read} new rows · imported {dayText(p.created_at.slice(0, 10))}
              </Text>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open the import of ${p.file_name}`} onPress={() => setOpened(p)} style={s.pastBtn}>
                  <Text style={[s.pastBtnText, { color: colors.accent }]}>Open</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove the import of ${p.file_name}`} onPress={() => removeImport(p)} style={s.pastBtn}>
                  <Text style={[s.pastBtnText, { color: colors.criticalText }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      {sheetOpen && file && (
        <FullScreen
          title={file.name}
          subtitle={`${file.table.rows.length} rows · tap a cell to read it`}
          onClose={() => setSheetOpen(false)}
          footer={
            <Text style={f.footText}>
              Will be imported <Text style={f.footBold}>{c?.import ?? 0}</Text>
              {c && c.read - c.import > 0 ? (
                <>
                  {'  ·  '}Left out <Text style={f.footBold}>{c.read - c.import}</Text> (shaded)
                </>
              ) : null}
            </Text>
          }
        >
          <SpreadsheetView key={file.name} label={`The rows of ${file.name}`} columns={sheetColumns} rows={file.table.rows} tone={rowTone} note={rowNote} />
        </FullScreen>
      )}
      {opened && (
        <ImportSheet
          key={opened.id}
          item={opened}
          people={people}
          dayText={dayText}
          heading={heading}
          onClose={() => setOpened(null)}
          onRemove={async () => {
            const r = await removeImport(opened);
            if (r.removed) setOpened(null);
            return r;
          }}
        />
      )}
    </View>
  );
}

type Rec = { id: string; employee_id: string; performed_on: string; service: string | null; minutes: number | null; customer_key: string | null; customer_name?: string | null; customer_phone?: string | null };

/** How many rows one request asks for (the database sends at most 1,000 at a time). */
const PAGE = 1000;

/** An earlier import, opened as a sheet: the rows it brought in, as they were kept (the file itself is not kept), with each customer's name
 * and phone number. Rows imported before names were kept show the customer ID if there was one, else nothing. */
function ImportSheet({ item, people, dayText, heading, onClose, onRemove }: { item: PastImport; people: { id: string; name: string }[]; dayText: (d: string) => string; heading: (r: ColumnRole) => string; onClose: () => void; onRemove: () => Promise<{ removed: boolean; error: string }> }) {
  const [records, setRecords] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);

  // Read the import's rows a page at a time, oldest service first (the id breaks ties, so no row is missed or read twice).
  useEffect(() => {
    let live = true;
    (async () => {
      const all: Rec[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase
          .from('service_records')
          .select('*')
          .eq('import_id', item.id)
          .order('performed_on', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!live) return;
        if (e) {
          setError(`Could not load the rows: ${e.message}`);
          break;
        }
        const part = (data as Rec[] | null) ?? [];
        all.push(...part);
        setRecords(all.slice());
        if (part.length < PAGE) break;
      }
      if (live) setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [item.id]);

  const names = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people]);
  const columns: SheetColumn[] = useMemo(
    () => [
      { header: heading('date'), width: 150 },
      { header: heading('employee'), width: 180 },
      { header: heading('service'), width: 200 },
      { header: heading('minutes'), width: 190, align: 'right' },
      { header: heading('customerName'), width: 180 },
      { header: heading('customerPhone'), width: 150 },
    ],
    [heading]
  );
  const rows = useMemo(
    () => records.map(r => [dayText(r.performed_on), names.get(r.employee_id) ?? '–', r.service ?? '', r.minutes == null ? '' : String(r.minutes), r.customer_name ?? (r.customer_key?.startsWith('c:') ? r.customer_key.slice(2) : ''), r.customer_phone ?? '']),
    [records, names, dayText]
  );

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setError('');
    const r = await onRemove();
    if (r.error) setError(r.error);
    if (!r.removed) setRemoving(false);
  }

  const range = item.first_date && item.last_date ? (item.first_date === item.last_date ? dayText(item.first_date) : `${dayText(item.first_date)} to ${dayText(item.last_date)}`) : '';

  return (
    <FullScreen
      title={item.file_name}
      subtitle={`Imported ${dayText(item.created_at.slice(0, 10))}${range ? ` · ${range}` : ''}`}
      onClose={onClose}
      actions={<Button label="Remove import" kind="danger" onPress={remove} disabled={removing} />}
      footer={
        <>
          {error ? (
            <Text accessibilityRole="alert" style={[s.error, { marginBottom: 4 }]}>
              {error}
            </Text>
          ) : null}
          <Text style={f.footText}>
            {loading ? 'Loading… ' : ''}
            <Text style={f.footBold}>{records.length}</Text> {records.length === 1 ? 'row' : 'rows'}
            {loading && item.rows_imported > 0 ? ` of ${item.rows_imported}` : ''}
          </Text>
        </>
      }
    >
      <SpreadsheetView label={`Services imported from ${item.file_name}`} columns={columns} rows={rows} loading={loading} />
    </FullScreen>
  );
}

const f = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.slate200 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: SLATE[600], marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate100 },
  actions: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.slate200 },
  footer: { paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#cbd5e1', backgroundColor: colors.slate100 },
  footText: { fontSize: 12.5, color: SLATE[700] },
  footBold: { fontWeight: '800', color: colors.ink },
});

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, padding: 16 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  help: { fontSize: 13, color: SLATE[600], marginBottom: 12, lineHeight: 18 },
  limit: { fontSize: 12, color: SLATE[600], textAlign: 'center', marginTop: 8 },
  tip: { fontSize: 13, color: SLATE[700], backgroundColor: colors.slate100, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14, lineHeight: 18 },
  error: { fontSize: 14, fontWeight: '700', color: colors.criticalText, marginTop: 10 },
  done: { fontSize: 14, fontWeight: '700', color: '#065f46', backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  colRow: { marginTop: 12 },
  sample: { fontSize: 12, color: SLATE[600], marginTop: 4 },
  option: { marginBottom: 14, gap: 8 },
  optionLabel: { fontSize: 13.5, fontWeight: '800', color: SLATE[700] },
  warn: { fontSize: 12.5, fontWeight: '700', color: '#92400e' },
  check: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  boxOn: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  checkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  checkLabel: { fontSize: 13.5, color: SLATE[700] },
  checkValue: { fontSize: 14, fontWeight: '800', color: colors.ink },
  empty: { textAlign: 'center', paddingVertical: 22, fontSize: 14, color: SLATE[600] },
  pastRow: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.slate100 },
  pastName: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  pastSub: { fontSize: 12.5, color: SLATE[600], marginTop: 1 },
  pastBtn: { minHeight: 44, justifyContent: 'center', paddingRight: 18 },
  pastBtnText: { fontSize: 14, fontWeight: '800' },
});
