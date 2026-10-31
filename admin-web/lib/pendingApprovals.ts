'use client';

import { useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';

type Oldest = { created_at: string; leave_type?: string; start_date?: string; end_date?: string } | null;
export type PendingQueue = { count: number; oldest: Oldest };
export type PendingApprovals = { gps: PendingQueue; corrections: PendingQueue; leave: PendingQueue; total: number };

const EMPTY: PendingQueue = { count: 0, oldest: null };

async function loadQueue(table: string, columns: string): Promise<PendingQueue> {
  const [{ count }, { data }] = await Promise.all([
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from(table).select(columns).eq('status', 'pending').order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  return { count: count ?? 0, oldest: (data as Oldest) ?? null };
}

/** The three queues the Corrections and Leave pages review — GPS check-ins,
 * missed-punch corrections, leave requests — with each one's oldest waiting
 * item. Shared by the top bar's bell and the Dashboard's "Needs your
 * approval" card; re-counted every minute. */
export function usePendingApprovals(): PendingApprovals {
  const [queues, setQueues] = useState({ gps: EMPTY, corrections: EMPTY, leave: EMPTY });

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    const load = () =>
      Promise.all([
        loadQueue('attendance_gps_requests', 'created_at'),
        loadQueue('attendance_correction_requests', 'created_at'),
        loadQueue('leave_requests', 'created_at, leave_type, start_date, end_date'),
      ]).then(([gps, corrections, leave]) => {
        if (active) setQueues({ gps, corrections, leave });
      });
    load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return { ...queues, total: queues.gps.count + queues.corrections.count + queues.leave.count };
}

/** "just now", "12 min ago", "2 h ago", "yesterday", "4 days ago". */
export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
