'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bucketHours, referenceHours, referenceLabel, type Granularity } from '@/lib/taskHours';
import type { Task, TaskTimeLog } from '@/lib/types';

const OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

/** `bare` leaves out the card and its title, for use inside another card (the employee Tasks page). */
export default function TaskHoursChart({ logs, tasks, bare = false }: { logs: TaskTimeLog[]; tasks: Task[]; bare?: boolean }) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [taskId, setTaskId] = useState('');

  useEffect(() => {
    if (taskId && tasks.some(t => t.id === taskId)) return;
    setTaskId(tasks[0]?.id ?? '');
  }, [tasks, taskId]);

  const filteredLogs = useMemo(() => logs.filter(l => l.task_id === taskId), [logs, taskId]);
  const data = useMemo(() => bucketHours(filteredLogs, granularity), [filteredLogs, granularity]);
  const target = referenceHours(granularity);

  return (
    <div className={bare ? '' : 'rounded-xl border border-slate-200 bg-white p-4'}>
      <div className={`mb-4 flex flex-wrap items-center gap-2 ${bare ? 'justify-end' : 'justify-between'}`}>
        {!bare && <h2 className="text-sm font-semibold text-ink">Hours Worked</h2>}
        <div className="flex flex-wrap gap-2">
          <select
            value={taskId}
            onChange={e => setTaskId(e.target.value)}
            className="max-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
          >
            {tasks.length === 0 && <option value="">No tasks yet</option>}
            {tasks.map(t => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <select
            value={granularity}
            onChange={e => setGranularity(e.target.value as Granularity)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
          >
            {OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No tasks to show hours for yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(v: number) => [`${v} hrs`, 'Worked']}
            />
            <ReferenceLine
              y={target}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: referenceLabel(granularity), position: 'insideTopRight', fontSize: 11, fill: '#94a3b8' }}
            />
            <Bar dataKey="hours" name="Hours worked" fill={bare ? '#047857' : '#0d9488'} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
