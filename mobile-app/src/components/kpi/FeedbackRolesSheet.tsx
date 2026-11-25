import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';
import { MIGRATION, isMissingTable } from '../../lib/kpiLoad';
import type { FeedbackPerson } from '../../lib/colleagueFeedback';
import { Button, Sheet, SLATE } from './KpiUi';

type Role = 'c_level' | 'training';
export type FeedbackRole = { employee_id: string; role: Role };

/**
 * "Who counts as what": the C-level executives and the training-and-compliance people. Feedback they give counts toward the "C-level" and
 * "Training and compliance" KPIs of the person it is about. The manager needs no choosing: it is whoever the person "Reports to" in their
 * profile. Everyone else counts as a peer. A change applies to feedback given from then on. Same as admin-web/components/kpi/FeedbackRolesDialog.tsx.
 */
export default function FeedbackRolesSheet({ people, roles, onClose, onSaved }: { people: FeedbackPerson[]; roles: FeedbackRole[]; onClose: () => void; onSaved: () => void }) {
  const [chosen, setChosen] = useState<Record<Role, Set<string>>>(() => ({
    c_level: new Set(roles.filter(g => g.role === 'c_level').map(g => g.employee_id)),
    training: new Set(roles.filter(g => g.role === 'training').map(g => g.employee_id)),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Everyone active, plus anyone already chosen who has since left, so they can be taken off the list.
  const choices = useMemo(() => {
    const chosenIds = new Set([...chosen.c_level, ...chosen.training, ...roles.map(g => g.employee_id)]);
    return people.filter(p => p.status === 'active' || chosenIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [people, chosen, roles]);

  function toggle(role: Role, id: string) {
    setChosen(c => {
      const next = new Set(c[role]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...c, [role]: next };
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError('');
    const fail = (e2: { code?: string; message?: string }) => {
      setSaving(false);
      setError(isMissingTable(e2) ? `Colleague feedback is not set up in the database yet: run the migration ${MIGRATION.reviews}.` : `Could not save: ${e2.message}`);
    };
    // Add the newly chosen first, then take off the ones no longer chosen, so a failure never leaves a role empty.
    for (const role of ['c_level', 'training'] as Role[]) {
      const before = new Set(roles.filter(g => g.role === role).map(g => g.employee_id));
      const toAdd = [...chosen[role]].filter(id => !before.has(id));
      const toRemove = [...before].filter(id => !chosen[role].has(id));
      if (toAdd.length > 0) {
        const added = await supabase.from('feedback_roles').insert(toAdd.map(employee_id => ({ employee_id, role }))).select('employee_id');
        if (added.error) return fail(added.error);
      }
      if (toRemove.length > 0) {
        const removed = await supabase.from('feedback_roles').delete().eq('role', role).in('employee_id', toRemove).select('employee_id');
        if (removed.error) return fail(removed.error);
      }
    }
    setSaving(false);
    onSaved();
  }

  const list = (role: Role, title: string, hint: string) => (
    <View accessibilityLabel={title} style={{ marginBottom: 16 }}>
      <Text style={s.legend} accessibilityRole="header">
        {title}
      </Text>
      <Text style={s.hint}>{hint}</Text>
      <View style={s.box}>
        {choices.length === 0 ? <Text style={s.none}>No employees yet.</Text> : null}
        {choices.map(p => {
          const on = chosen[role].has(p.id);
          return (
            <TouchableOpacity key={p.id} accessibilityRole="checkbox" accessibilityLabel={`${title}: ${p.name}`} accessibilityState={{ checked: on }} onPress={() => toggle(role, p.id)} style={s.item}>
              <View style={[s.check, on && s.checkOn]}>
                {on ? (
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="m5 12 5 5 9-10" />
                  </Svg>
                ) : null}
              </View>
              <Text style={s.itemText} numberOfLines={1}>
                {p.name}
                {p.department ? <Text style={{ color: SLATE[600], fontWeight: '400' }}> · {p.department}</Text> : null}
              </Text>
              {p.status !== 'active' ? <Text style={s.gone}>no longer active</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <Sheet
      title="Who counts as C-level and training"
      subtitle={'Feedback from the people you choose here counts toward the C-level and the training and compliance KPIs. A person\'s manager is whoever they "Report to" in their profile, so there is nothing to choose for that. Everyone else counts as a peer. A change applies to feedback given from then on.'}
      onClose={() => !saving && onClose()}
      footer={
        <>
          <Button label="Cancel" kind="outline" onPress={onClose} disabled={saving} />
          <Button label="Save" onPress={save} busy={saving} />
        </>
      }
    >
      {list('c_level', 'C-level executives', 'Feedback they give counts as feedback from C-level.')}
      {list('training', 'Training and compliance', 'Feedback they give counts as feedback from training and compliance.')}
      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, fontWeight: '700', color: colors.criticalText, marginBottom: 8 }}>
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  legend: { fontSize: 14.5, fontWeight: '800', color: colors.ink, marginBottom: 2 },
  hint: { fontSize: 12.5, color: SLATE[600], marginBottom: 8 },
  box: { borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: colors.white, padding: 4 },
  none: { padding: 8, fontSize: 14, color: SLATE[600] },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderRadius: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checkOn: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  itemText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  gone: { fontSize: 12, fontWeight: '600', color: SLATE[600] },
});
