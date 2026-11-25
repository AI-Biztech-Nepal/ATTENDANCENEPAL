import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { isMissingTable } from '../../lib/kpiLoad';
import { removeFeedback } from '../../lib/useFeedback';
import { COMMENT_MAX, RATING_WORDS, firstName, validateGive, type Colleague, type GivenFeedback } from '../../lib/colleagueFeedback';
import { colors } from '../../theme';
import { Button, Sheet, SLATE, useAsk } from './KpiUi';
import { Circle, Field, PickerField, Question } from './FormParts';

/**
 * The colleague feedback form, built like the customer review form: who it is for, then numbered questions in boxes (1. a rating from 1 to 5 with a
 * word under each round number, 2. an optional comment). Anyone who works in the company can give it to anyone else, from an employee's own screen
 * or from an admin's. Sending feedback to someone who already has some from you this month replaces it, and the form says so; it can also be taken
 * back (deleted). The person and management see who gave it. Same as admin-web/components/kpi/GiveFeedbackDialog.tsx.
 */
export default function GiveFeedbackSheet({ colleagues, given, subjectId = '', onClose, onSent, onRemoved }: {
  /** Everyone feedback can be given to (feedback_colleagues()). */
  colleagues: Colleague[];
  /** What the signed-in person already gave this month (feedback_i_gave()). */
  given: GivenFeedback[];
  /** Who the form opens on, when it is opened from that person's screen. */
  subjectId?: string;
  onClose: () => void;
  /** The feedback was saved: with the name of the person it was for. */
  onSent: (name: string) => void;
  /** This month's feedback to someone was taken back: with the name of the person it was for. */
  onRemoved: (name: string) => void;
}) {
  const start = colleagues.some(c => c.id === subjectId) ? subjectId : '';
  const before = useMemo(() => given.find(g => g.subject_id === start), [given, start]);
  const [who, setWho] = useState(start);
  const [rating, setRating] = useState<number | null>(before?.rating ?? null);
  const [comment, setComment] = useState(before?.comment ?? '');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const ask = useAsk();
  const busy = saving || removing;

  const person = colleagues.find(c => c.id === who);
  const earlier = given.find(g => g.subject_id === who);
  const name = person ? firstName(person.name) : 'them';

  // Choosing someone shows what you already sent them this month, so you can change it; someone new starts empty.
  function choose(id: string) {
    setWho(id);
    const prior = given.find(g => g.subject_id === id);
    setRating(prior?.rating ?? null);
    setComment(prior?.comment ?? '');
    setError('');
  }

  // Take back what you gave this person this month: it is deleted, and you may give them feedback again.
  async function takeBack() {
    if (!earlier || busy) return;
    const sure = await ask(`Take back the feedback you gave ${person?.name ?? 'them'} this month? It is deleted for good.`, 'Take it back');
    if (!sure) return;
    setRemoving(true);
    setError('');
    const problem = await removeFeedback(earlier.id);
    setRemoving(false);
    if (problem) return setError(problem);
    onRemoved(person?.name ?? '');
    onClose();
  }

  async function send() {
    if (busy) return;
    const problem = validateGive(who, rating, comment);
    if (problem) return setError(problem);
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('give_colleague_feedback', { p_subject_id: who, p_rating: rating, p_comment: comment.trim() || null });
    setSaving(false);
    if (rpcError) return setError(isMissingTable(rpcError) ? 'Colleague feedback is not set up in the database yet: run the migration 20261123140000_colleague_feedback.sql.' : rpcError.message);
    onSent(person?.name ?? '');
    onClose();
  }

  return (
    <Sheet
      title={person ? `Feedback for ${person.name}` : 'Give feedback'}
      subtitle={`${person ? name : 'The person'} and management see your name with this feedback.`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button label="Cancel" kind="outline" onPress={onClose} disabled={busy} />
          <Button label={earlier ? 'Send again' : 'Send feedback'} onPress={send} busy={saving} disabled={removing} />
        </>
      }
    >
      <PickerField
        label="Who is it for?"
        title="Choose a colleague"
        value={who}
        placeholder="Select a colleague…"
        options={colleagues.map(c => ({ id: c.id, label: c.name, sub: c.department ?? undefined }))}
        onChange={choose}
      />
      {earlier ? (
        <View style={{ marginTop: 8, marginBottom: 4, gap: 2 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: SLATE[600] }}>You already gave {name} feedback this month. Sending again replaces it.</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button label={removing ? 'Taking it back…' : 'Take it back'} kind="danger" onPress={takeBack} disabled={busy} />
          </View>
        </View>
      ) : null}

      <View style={{ height: 12 }} />
      <Question n={1} title={`Overall, how was working with ${name} this month?`} range="Rating, 1 to 5">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {RATING_WORDS.map((word, i) => {
            const n = i + 1;
            const on = rating === n;
            return (
              <View key={n} style={{ alignItems: 'center', gap: 4, width: '19%' }}>
                <Circle
                  n={n}
                  on={on}
                  label={`${n}, ${word}`}
                  onPress={() => {
                    setRating(n);
                    setError('');
                  }}
                />
                <Text style={{ fontSize: 11.5, textAlign: 'center', color: on ? '#0f766e' : SLATE[600], fontWeight: on ? '800' : '400' }}>{word}</Text>
              </View>
            );
          })}
        </View>
      </Question>

      <Question n={2} title="Anything to add?" range="Comment (optional)">
        <Field label="Comment" value={comment} onChange={setComment} multiline maxLength={COMMENT_MAX} />
        <Text style={{ fontSize: 12, color: SLATE[600], marginTop: 6 }}>What went well, and what could be better. Be specific and kind.</Text>
      </Question>

      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, fontWeight: '700', color: colors.criticalText, marginBottom: 8 }}>
          {error}
        </Text>
      ) : null}
      <Text style={{ textAlign: 'center', fontSize: 12.5, color: SLATE[600], marginBottom: 8 }}>Thank you for taking the time to give honest feedback.</Text>
    </Sheet>
  );
}
