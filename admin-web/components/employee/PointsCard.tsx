'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LeaderboardRow, PointRedemption } from '@/lib/types';
import FormDialog from './FormDialog';
import { StatusTag } from './parts';

const SHOWN = 5;
const LABEL = 'mb-1.5 block text-xs font-bold text-slate-600';
const INPUT = 'h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium';

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}

/**
 * Your points, the way to spend them, and where you stand: what My Tasks earns.
 * The balance and the leaderboard come from the same `get_leaderboard()` call.
 */
export default function PointsCard({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);
  const [showRedeem, setShowRedeem] = useState(false);
  const [points, setPoints] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    supabase.rpc('get_leaderboard').then(({ data }) => {
      setRows((data as LeaderboardRow[]) ?? []);
      setLoaded(true);
    });
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

  const myIndex = rows.findIndex(r => r.employee_id === employeeId);
  const myPoints = myIndex >= 0 ? rows[myIndex].total_points : 0;
  // The top few, and you too if you aren't among them.
  const shown = rows.map((row, i) => ({ row, rank: i + 1 })).filter(x => x.rank <= SHOWN || x.row.employee_id === employeeId);
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
    <section aria-label="Points" className="rounded-2xl border border-slate-200 bg-white p-4 lg:rounded-[20px] lg:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold lg:text-lg lg:leading-6">Your points</h2>
          <div className="mt-0.5 text-4xl font-extrabold leading-[44px] tracking-[-0.02em] tabular-nums">{myPoints}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowRedeem(true)}
          className="h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-extrabold text-brand hover:bg-slate-50"
        >
          Redeem
        </button>
      </div>

      {redemptions.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer py-1.5 text-[13px] font-medium text-slate-600">
            {redemptions.length} {redemptions.length === 1 ? 'request' : 'requests'}
            {pending > 0 ? ` · ${pending} pending approval` : ''}
          </summary>
          <ul className="mt-1">
            {redemptions.map(r => (
              <li key={r.id} className="flex items-center gap-3 border-t border-slate-100 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold tabular-nums">{r.points_requested} pts</div>
                  {r.note && <div className="text-xs text-slate-600">{r.note}</div>}
                </div>
                <StatusTag tone={statusTone(r.status)}>{r.status}</StatusTag>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-sm font-extrabold">Leaderboard</h3>
        {loaded && rows.length === 0 ? (
          <p className="text-sm text-slate-600">No points earned yet.</p>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {shown.map(({ row, rank }) => {
              const you = row.employee_id === employeeId;
              return (
                <li key={row.employee_id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${you ? 'bg-brand-light' : ''}`}>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold tabular-nums ${
                      rank === 1 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${you ? 'font-extrabold' : 'font-bold'}`}>
                      {row.name}
                      {you && ' (you)'}
                    </div>
                    <div className="text-xs font-medium text-slate-600">
                      {row.department ?? '—'} · {row.tasks_completed} {row.tasks_completed === 1 ? 'task' : 'tasks'} done
                    </div>
                  </div>
                  <div className="text-sm font-extrabold tabular-nums">{row.total_points} pts</div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

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
          <textarea
            id="redeem-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium"
          />
        </FormDialog>
      )}
    </section>
  );
}
