// Ported from admin-web/lib/employeeNotifications.ts — keep the two in step.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { formatAdDate, type CalendarSystem } from './calendar';
import { SEPARATION_TYPES } from './employeeSeparation';

/** One row of employee_notifications (20261104180000_employee_notifications.sql). The database stores what
 * changed, not a sentence — the words and the dates (AD or BS) are made here, for each person's own calendar. */
export type NotificationChange = { k: string; v?: string | number | null };

export type EmployeeNotification = {
  id: string;
  kind: 'exit_started' | 'exit_updated';
  payload: { changes?: NotificationChange[] } | null;
  created_at: string;
  read_at: string | null;
};

const ASSET_LABEL: Record<string, string> = {
  uniform_id: 'Your uniform / ID card',
  asset_keys: 'Keys',
  asset_equipment: 'Equipment',
  asset_device: 'Your device',
  asset_other: 'Other company assets',
};

/** One change as a sentence, or '' for a key this version doesn't know (so a newer database never breaks an older app). */
export function describeChange(c: NotificationChange, system: CalendarSystem): string {
  const v = c.v;
  switch (c.k) {
    case 'separation_type': {
      const label = SEPARATION_TYPES.find(t => t.value === v)?.label ?? String(v ?? '');
      return label ? `Your exit is recorded as a ${label.toLowerCase()}` : '';
    }
    case 'last_working_on':
      return v ? `Your last working day is ${formatAdDate(String(v), system)}` : '';
    case 'notice_required_days': {
      const n = Number(v);
      return Number.isFinite(n) ? `Your notice period is ${n} day${n === 1 ? '' : 's'}` : '';
    }
    case 'exit_interview':
      return v === 'completed' ? 'Your exit interview is marked completed' : 'Your exit interview is pending again';
    case 'clearance':
      return v === 'cleared' ? 'Your department clearance is done' : v === 'in_progress' ? 'Your department clearance is in progress' : 'Your department clearance is pending again';
    case 'uniform_id':
    case 'asset_keys':
    case 'asset_equipment':
    case 'asset_device':
    case 'asset_other': {
      const what = ASSET_LABEL[c.k];
      return v === 'returned' ? `${what} marked as returned` : v === 'not_applicable' ? `${what} marked not applicable` : `${what} set back to pending`;
    }
    case 'experience_letter':
      return v === 'issued' ? 'Your experience letter has been issued' : 'Your experience letter is pending again';
    case 'settlement':
      return v === 'processed' ? 'Your final settlement is being processed' : v === 'completed' ? 'Your final settlement is completed' : 'Your final settlement is pending';
    case 'amounts':
      return 'Your settlement figures were updated';
    default:
      return '';
  }
}

export function notificationTitle(n: Pick<EmployeeNotification, 'kind'>): string {
  return n.kind === 'exit_started' ? 'HR started your exit process' : 'HR updated your exit';
}

/** "5 min ago" / "yesterday" (same as admin-web/lib/pendingApprovals.ts). */
export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The lines under a notification's title. */
export function notificationLines(n: Pick<EmployeeNotification, 'kind' | 'payload'>, system: CalendarSystem): string[] {
  if (n.kind === 'exit_started') return ['Open your Exit tab to see the steps.'];
  return (n.payload?.changes ?? []).map(c => describeChange(c, system)).filter(Boolean);
}

/** The signed-in employee's notifications, newest first. Reloaded when `refreshKey` changes (the header passes the
 * screen, so moving around the app picks up anything new), when the app comes back to the foreground, and every 5 minutes.
 * Until the notifications migration has been run the query fails and the list is simply empty. */
export function useMyNotifications(refreshKey: string) {
  const [items, setItems] = useState<EmployeeNotification[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => {
      Promise.resolve(
        supabase.from('employee_notifications').select('id, kind, payload, created_at, read_at').order('created_at', { ascending: false }).limit(30)
      ).then(({ data, error }) => {
        if (active && !error) setItems((data ?? []) as EmployeeNotification[]);
      });
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') load();
    });
    return () => {
      active = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [refreshKey]);

  /** Marks everything read — on screen at once, and in the database. */
  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems(list => list.map(n => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.rpc('mark_my_notifications_read');
  }, []);

  return { items, unread: items.filter(n => !n.read_at).length, markAllRead };
}
