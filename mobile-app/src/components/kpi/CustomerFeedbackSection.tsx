import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as Print from 'expo-print';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, type CalendarAnchor } from '../../lib/calendar';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { nepalTodayIso } from '../../lib/shift';
import { weekdayName } from '../../lib/taskClock';
import { otherCalendarSpan } from '../../lib/kpi';
import { useKpiSettings } from '../../lib/useKpiSettings';
import { useCompanyName } from '../../lib/useCompanyName';
import { FEEDBACK_COLUMNS, FEEDBACK_PAGE_SIZE, draftFromRow, emptyDraft, feedbackRow, needsGuestMigration, rangeText, validateFeedback, type FeedbackDraft } from '../../lib/customerFeedback';
import { MIGRATION } from '../../lib/kpiLoad';
import { loadGuests, saveGuest } from '../../lib/guestDetails';
import { blankFeedbackFormHtml } from '../../lib/blankFeedbackForm';
import type { CustomerFeedback } from '../../types';
import { Button, MonthStepper, Sheet, SLATE, useAsk } from './KpiUi';
import FeedbackFields from './FeedbackFields';
import { GuestHistoryProvider, GuestName } from './GuestHistory';

/**
 * Customers do not use the app: they fill in a paper form, and staff type each one in here. The same form counts toward two KPIs, the 1-5
 * service rating (customer feedback) and the 0-10 would-recommend number (NPS). This is one person's section: the typing card is for the
 * forms about them, and the list shows only theirs for a month (change or delete one with Edit). A blank form to print is here too.
 * Same as admin-web/app/(admin)/kpis/[employeeId]/feedback/page.tsx.
 */
export default function CustomerFeedbackSection({ employeeId, anchor, onAnchor }: { employeeId: string; anchor: CalendarAnchor; onAnchor: (a: CalendarAnchor) => void }) {
  return (
    <GuestHistoryProvider>
      <Section employeeId={employeeId} anchor={anchor} onAnchor={onAnchor} />
    </GuestHistoryProvider>
  );
}

function Section({ employeeId, anchor, onAnchor }: { employeeId: string; anchor: CalendarAnchor; onAnchor: (a: CalendarAnchor) => void }) {
  const { system } = useCalendarSystem();
  const today = useMemo(nepalTodayIso, []);
  const companyName = useCompanyName();
  // What this company calls the people it serves (KPIs > Settings).
  const { words } = useKpiSettings();

  const [personName, setPersonName] = useState('');
  const blank = useCallback(() => ({ ...emptyDraft(today), employeeId }), [today, employeeId]);

  // --- the typing card ---
  const [draft, setDraft] = useState<FeedbackDraft>(() => ({ ...emptyDraft(today), employeeId }));
  const [keep, setKeep] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [printError, setPrintError] = useState('');

  // --- the forms typed in for a month ---
  const [page, setPage] = useState(0);
  // `page` is the page these rows belong to, so the footer always describes what is on screen even while the next page loads.
  const [list, setList] = useState<{ rows: CustomerFeedback[]; total: number; page: number } | null>(null);
  const [listError, setListError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<CustomerFeedback | null>(null);

  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);

  useEffect(() => {
    let live = true;
    Promise.resolve(supabase.from('employees').select('name').eq('id', employeeId).single()).then(({ data }) => {
      if (live) setPersonName((data as { name: string } | null)?.name ?? '');
    });
    return () => {
      live = false;
    };
  }, [employeeId]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, count, error } = await supabase
        .from('customer_feedback')
        .select(FEEDBACK_COLUMNS, { count: 'exact' })
        .eq('employee_id', employeeId)
        .gte('given_on', start)
        .lte('given_on', end)
        .order('given_on', { ascending: false })
        .order('created_at', { ascending: false })
        .range(page * FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE + FEEDBACK_PAGE_SIZE - 1);
      if (!live) return;
      if (error) {
        setListError(`Could not load the forms: ${error.message}`);
        setList({ rows: [], total: 0, page });
        return;
      }
      setListError('');
      const rows = (data as CustomerFeedback[] | null) ?? [];
      // The last form on the last page was deleted: go back a page instead of showing an empty one.
      if (rows.length === 0 && page > 0) {
        setPage(page - 1);
        return;
      }
      // Who each guest is lives in a table only admin and HR can read: read it for these forms and put it on their rows.
      const guests = await loadGuests(rows.map(r => r.id));
      if (live) setList({ rows: rows.map(r => ({ ...r, guest: guests.get(r.id) ?? null })), total: count ?? rows.length, page });
    })();
    return () => {
      live = false;
    };
  }, [start, end, employeeId, page, reloadKey]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const dayText = (d: string) => `${weekdayName(d)} ${formatAdDate(d, system)}`;

  async function save() {
    if (saving) return;
    const problem = validateFeedback(draft, today);
    if (problem) {
      setFormError(words.t(problem));
      setNotice('');
      return;
    }
    setSaving(true);
    setFormError('');
    const { data: made, error } = await supabase.from('customer_feedback').insert(feedbackRow(draft)).select('id');
    if (error) {
      setSaving(false);
      setFormError(`Could not save: ${error.message}`);
      return;
    }
    // The guest's name, phone and email go to their own table, with the id of the form just made.
    const formId = (made as { id: string }[] | null)?.[0]?.id;
    const guestError = formId ? await saveGuest(draft, formId) : 'the form could not be found again';
    if (guestError) {
      // A form always has its guest: take the form back out, and keep what was typed so nothing has to be typed twice.
      const { error: undoError } = formId ? await supabase.from('customer_feedback').delete().eq('id', formId) : { error: null };
      setSaving(false);
      if (undoError || !formId) {
        setFormError(`The form was saved, but the guest's details were not: ${guestError}. Open the form from the list and add them.`);
        setDraft(keep ? { ...blank(), date: draft.date } : blank());
        setReloadKey(k => k + 1);
        return;
      }
      setFormError(needsGuestMigration(guestError) ? `Guest details are not set up in the database yet: run the migration ${MIGRATION.guests}.` : `Could not save the guest's details: ${guestError}`);
      return;
    }
    setSaving(false);
    setNotice(`Saved for ${personName || 'this employee'} · ${dayText(draft.date)}.`);
    // Ready for the next paper form: the answers are cleared, and the date stays when asked to.
    setDraft(keep ? { ...blank(), date: draft.date } : blank());
    setReloadKey(k => k + 1);
  }

  function clear() {
    setDraft(blank());
    setFormError('');
    setNotice('');
  }

  async function printBlank() {
    setPrintError('');
    try {
      await Print.printAsync({ html: blankFeedbackFormHtml(companyName) });
    } catch (e) {
      setPrintError(`Could not print the form: ${e instanceof Error ? e.message : 'the printer did not say why'}.`);
    }
  }

  const changed = useCallback(() => {
    setEditing(null);
    setReloadKey(k => k + 1);
  }, []);

  const total = list?.total ?? 0;
  const rows = list?.rows ?? [];
  const lastPage = Math.max(0, Math.ceil(total / FEEDBACK_PAGE_SIZE) - 1);

  return (
    <View style={{ gap: 14 }}>
      <Button label="Print a blank form" kind="outline" onPress={printBlank} />
      {printError ? (
        <Text accessibilityRole="alert" style={s.error}>
          {printError}
        </Text>
      ) : null}

      <View accessibilityLabel="Type in a paper form" style={s.card}>
        <Text style={s.title} accessibilityRole="header">
          Type in a paper form
        </Text>
        <Text style={s.help}>{words.t('Type the numbers the customer circled. Leave a box empty if they skipped it.')}</Text>

        <FeedbackFields draft={draft} onChange={setDraft} employeeName={personName} />

        <View style={s.keep}>
          <Switch accessibilityLabel="Keep the date for the next form" value={keep} onValueChange={setKeep} trackColor={{ true: '#0f766e', false: '#cbd5e1' }} />
          <Text style={{ flex: 1, fontSize: 13.5, color: SLATE[700] }}>Keep the date for the next form</Text>
        </View>

        {formError ? (
          <Text accessibilityRole="alert" style={s.error}>
            {formError}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.notice}>
            {notice}
          </Text>
        ) : null}

        <View style={{ gap: 10 }}>
          <Button label={saving ? 'Saving…' : 'Save and type the next'} onPress={save} busy={saving} />
          <Button label="Clear" kind="outline" onPress={clear} disabled={saving} />
        </View>
      </View>

      <View accessibilityLabel="Forms typed in" style={s.card}>
        <Text style={s.title} accessibilityRole="header">
          Forms typed in
        </Text>
        <MonthStepper
          label={label}
          subtitle={`${list ? `${total} ${total === 1 ? 'form' : 'forms'}` : 'Loading…'}${otherSpan ? ` · ${otherSpan}` : ''}`}
          onPrevious={() => {
            onAnchor(stepAnchor(system, anchor, -1));
            setPage(0);
          }}
          onNext={() => {
            onAnchor(stepAnchor(system, anchor, 1));
            setPage(0);
          }}
        />

        {listError ? (
          <Text accessibilityRole="alert" style={[s.error, { marginTop: 10 }]}>
            {listError}
          </Text>
        ) : null}

        {!list ? (
          <Text style={s.empty}>Loading…</Text>
        ) : rows.length === 0 ? (
          <Text style={s.empty}>No forms typed in for this employee in {label}.</Text>
        ) : (
          <View style={{ marginTop: 6 }}>
            {rows.map(r => (
              <View key={r.id} style={s.row}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.rowDay}>{dayText(r.given_on)}</Text>
                  {r.guest ? (
                    <View style={{ gap: 1 }}>
                      {r.guest.guest_name ? <GuestName name={r.guest.guest_name} anchor={{ feedbackId: r.id }} /> : null}
                      {r.guest.guest_phone ? <Text style={s.rowSub}>{r.guest.guest_phone}</Text> : null}
                      {r.guest.guest_email ? <Text style={s.rowSub}>{r.guest.guest_email}</Text> : null}
                    </View>
                  ) : null}
                  <Text style={s.rowNums}>
                    Rating {r.rating ?? '–'} · Recommend {r.recommend ?? '–'}
                  </Text>
                  {r.comment ? <Text style={s.rowComment}>{r.comment}</Text> : null}
                  {r.reference ? <Text style={s.rowSub}>For: {r.reference}</Text> : null}
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit the form for ${personName || 'this employee'} on ${dayText(r.given_on)}`} onPress={() => setEditing(r)} style={s.edit}>
                  <Text style={s.editText}>Edit</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={s.pager}>
          <Text style={{ flex: 1, fontSize: 13, color: SLATE[600] }}>{list ? rangeText(list.page, rows.length, total) : ''}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous page" disabled={page === 0} onPress={() => setPage(p => Math.max(0, p - 1))} style={[s.pagerBtn, page === 0 && { opacity: 0.5 }]}>
            <Text style={s.pagerText}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next page" disabled={page >= lastPage} onPress={() => setPage(p => Math.min(lastPage, p + 1))} style={[s.pagerBtn, page >= lastPage && { opacity: 0.5 }]}>
            <Text style={s.pagerText}>Next</Text>
          </TouchableOpacity>
        </View>
      </View>

      {editing && <EditSheet key={editing.id} row={editing} employeeName={personName} today={today} onClose={() => setEditing(null)} onChanged={changed} />}
    </View>
  );
}

/** Change or delete a form that was typed in. Anyone with access to the section can fix a typing mistake: the date and every answer can be changed. */
function EditSheet({ row, employeeName, today, onClose, onChanged }: { row: CustomerFeedback; employeeName: string; today: string; onClose: () => void; onChanged: () => void }) {
  const ask = useAsk();
  const { words } = useKpiSettings();
  const [draft, setDraft] = useState<FeedbackDraft>(() => draftFromRow(row));
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState('');

  async function save() {
    if (busy) return;
    // A form typed in before guests were kept has none on file: it may stay without one, but a guest that is typed in must be complete.
    const problem = validateFeedback(draft, today, { guestOptional: !row.guest });
    if (problem) return setError(words.t(problem));
    setBusy('save');
    setError('');
    // .select() so a row the security rules hide (or one already deleted) is noticed instead of "saving" nothing.
    const { data, error: updateError } = await supabase.from('customer_feedback').update(feedbackRow(draft)).eq('id', row.id).select('id');
    if (updateError) {
      setBusy(null);
      return setError(`Could not save: ${updateError.message}`);
    }
    if (!data || data.length === 0) {
      setBusy(null);
      return setError('That form could not be changed. It may already have been deleted.');
    }
    // The guest's name, phone and email are kept in their own table.
    const guestError = await saveGuest(draft, row.id);
    setBusy(null);
    if (guestError) return setError(needsGuestMigration(guestError) ? `The form was changed, but guest details are not set up in the database yet: run the migration ${MIGRATION.guests}.` : `The form was changed, but the guest's details were not: ${guestError}`);
    onChanged();
  }

  async function remove() {
    if (busy) return;
    if (!(await ask(words.t(`Delete this customer form for ${employeeName || 'this employee'}? It will no longer count toward their KPIs. This cannot be undone.`), 'Delete'))) return;
    setBusy('delete');
    setError('');
    const { data, error: deleteError } = await supabase.from('customer_feedback').delete().eq('id', row.id).select('id');
    setBusy(null);
    if (deleteError) return setError(`Could not delete: ${deleteError.message}`);
    if (!data || data.length === 0) return setError('That form could not be deleted. It may already be gone.');
    onChanged();
  }

  return (
    <Sheet
      title={words.t('Edit a customer form')}
      subtitle="Change what was typed in, or delete the form if it should not count."
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button label="Cancel" kind="outline" onPress={onClose} disabled={busy !== null} />
          <Button label="Save changes" onPress={save} busy={busy === 'save'} disabled={busy === 'delete'} />
        </>
      }
    >
      <FeedbackFields draft={draft} onChange={setDraft} employeeName={employeeName} />
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <View style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
        <Button label={busy === 'delete' ? 'Deleting…' : 'Delete form'} kind="danger" onPress={remove} disabled={busy !== null} />
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.slate200, padding: 16 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  help: { fontSize: 13, color: SLATE[600], marginBottom: 14, lineHeight: 18 },
  keep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  error: { fontSize: 14, fontWeight: '700', color: colors.criticalText, marginBottom: 10 },
  notice: { fontSize: 13.5, fontWeight: '700', color: '#065f46', backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  empty: { textAlign: 'center', paddingVertical: 28, fontSize: 14, color: SLATE[600] },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  rowDay: { fontSize: 12.5, fontWeight: '700', color: SLATE[700] },
  rowSub: { fontSize: 12.5, color: SLATE[600] },
  rowNums: { fontSize: 14, fontWeight: '800', color: colors.ink },
  rowComment: { fontSize: 14, lineHeight: 20, color: colors.ink },
  edit: { minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  editText: { fontSize: 14, fontWeight: '800', color: colors.accent },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  pagerBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white },
  pagerText: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
