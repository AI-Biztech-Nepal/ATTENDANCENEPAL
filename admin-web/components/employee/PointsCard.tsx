'use client';

import { useEffect, useState } from 'react';
import Badge from '@/components/Badge';
import Leaderboard from '@/components/Leaderboard';
import { supabase } from '@/lib/supabase';
import type { LeaderboardRow, PointRedemption } from '@/lib/types';
import FormDialog from './FormDialog';

const LABEL = 'mb-1 block text-xs font-medium text-slate-600';
const INPUT = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}

/**
 * Your points and the way to spend them, with the company leaderboard under it — the column beside
 * the task list, as on the owner console's Tasks page. The balance comes from `get_leaderboard()`.
 */
export default function PointsCard({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);
  const [showRedeem, setShowRedeem] = useState(false);
  const [points, setPoints] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    supabase.rpc('get_leaderboard').then(({ data }) => setRows((data as LeaderboardRow[]) ?? []));
    supabase
      .from('point_redemptions')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRedemptions(data ?? []));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const myPoints = rows.find(r => r.employee_id === employeeId)?.total_points ?? 0;
  const pending = redemptions.filter(r => r.status === 'pending').length;

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (points <= 0) {
      setError('Enter how many points you want to redeem.');
      return;
    }
    if (points > myPoints) {
      setError(`You only have ${myPoints} points available.`);
      return;
    }
    setSubmitting(true);
    const { error: insertError } = await supabase.from('point_redemptions').insert({
      employee_id: employeeId,
      points_requested: points,
      note: note || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setShowRedeem(false);
    setPoints(0);
    setNote('');
    reload();
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-label="Points" className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Your points</h2>
            <div className="mt-1 text-3xl font-bold tabular-nums text-ink">{myPoints}</div>
          </div>
          <button type="button" onClick={() => setShowRedeem(true)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-accent hover:bg-slate-50">
            Redeem
          </button>
        </div>

        {redemptions.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer py-1 text-xs text-slate-500">
              {redemptions.length} {redemptions.length === 1 ? 'request' : 'requests'}
              {pending > 0 ? ` · ${pending} pending approval` : ''}
            </summary>
            <ul className="mt-1 divide-y divide-slate-100">
              {redemptions.map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{r.points_requested} pts</div>
                    {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
                  </div>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <Leaderboard highlightEmployeeId={employeeId} />

      {showRedeem && (
        <FormDialog
          title="Redeem Points"
          note={`You have ${myPoints} points. HR/Admin will review this request.`}
          onSubmit={handleRedeem}
          onClose={() => setShowRedeem(false)}
          saving={submitting}
          savingLabel="Submitting…"
          submitLabel="Submit request"
          error={error}
        >
          <label htmlFor="redeem-points" className={LABEL}>
            Points to redeem
          </label>
          <input
            id="redeem-points"
            type="number"
            min={1}
            max={myPoints || undefined}
            required
            value={points || ''}
            onChange={e => setPoints(Number(e.target.value))}
            className={`${INPUT} mb-3`}
          />
          <label htmlFor="redeem-note" className={LABEL}>
            Note (optional)
          </label>
          <textarea id="redeem-note" value={note} onChange={e => setNote(e.target.value)} rows={2} className={INPUT} />
        </FormDialog>
      )}
    </div>
  );
}
