'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import { ChevronLeftIcon, EditIcon, PageBody, PinIcon, SignInIcon, SignOutIcon, UmbrellaIcon } from '@/components/employee/parts';
import { formatAdDate, formatTodayLine, localDateKey, type CalendarSystem } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  formatHoursMinutes,
  nepalDateKey,
  nepalDateTimeToUtcMs,
  nepalTodayIso,
  punchTypeLabel,
  selectDayPunches,
} from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '@/lib/weekOff';
import type {
  AttendanceGpsRequest,
  AttendanceLog,
  CompanyHoliday,
  CorrectionRequest,
  Gender,
  LeaveRequest,
  LeaveType,
} from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';

const HISTORY_WINDOW_DAYS = 90;
type HistoryRange = 'daily' | 'weekly' | 'monthly';
const HISTORY_RANGE_DAYS: Record<HistoryRange, number> = { daily: 1, weekly: 7, monthly: 30 };
const WEEK_LENGTH = 7;

type View = 'menu' | 'fix' | 'leave';
type DayRow = {
  key: string;
  isToday: boolean;
  offLabel: string | null;
  inText: string | null;
  outText: string | null;
  minutes: number | null;
  via: string;
  missed: boolean;
  inNow: boolean;
  rejected: string[];
  pending: string[];
};
type PunchModal = {
  punchType: '0' | '1' | '2' | '3';
  punchTime: string;
  status: 'locating' | 'ready' | 'error';
  coords?: { lat: number; lng: number; accuracy: number };
  error?: string;
};

const EMPTY_CORRECTION_FORM = { work_date: '', check_in_time: '', check_out_time: '', reason: '' };
const LEAVE_TYPES: LeaveType[] = ['casual', 'sick', 'annual', 'unpaid'];
const EMPTY_LEAVE_FORM = { leave_type: 'casual' as LeaveType, start_date: '', end_date: '', reason: '' };

const FIELD_LABEL = 'mb-1 block text-xs font-medium text-slate-600';
const TEXT_INPUT = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
const SUBMIT_BUTTON = 'w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60';

// Built from the fixed Nepal (UTC+5:45) offset, not the browser's own
// timezone — new Date(`${date}T${time}:00`).toISOString() only produced a
// correct instant when the device happened to be set to Nepal time; anyone
// traveling, on a VPN, or with a misconfigured clock got a correction that
// was off by however many hours their device's offset differed from +5:45,
// and that wrong instant flowed straight into payroll once approved.
function toTimestamp(date: string, time: string) {
  if (!date || !time) return null;
  return new Date(nepalDateTimeToUtcMs(date, time)).toISOString();
}

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value: string, system: 'AD' | 'BS') {
  return `${formatAdDate(localDateKey(value), system)} · ${formatTime(value)}`;
}

function statusTone(status: string): 'good' | 'critical' | 'warning' {
  if (status === 'approved') return 'good';
  if (status === 'rejected') return 'critical';
  return 'warning';
}

/** 'YYYY-MM-DD' plus/minus whole days, as plain calendar arithmetic. */
function addDays(key: string, delta: number) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
}

/** The day number / short month shown on a date block, in the active calendar. */
function dayNumber(key: string, system: CalendarSystem) {
  return system === 'BS' ? formatAdDate(key, 'BS').split(' ')[0] : String(Number(key.slice(8, 10)));
}
function monthShort(key: string, system: CalendarSystem) {
  if (system === 'BS') return (formatAdDate(key, 'BS').split(' ')[1] ?? '').slice(0, 3).toUpperCase();
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
}
/** The month's name in the active calendar ("Kartik", "Nov"). */
function monthName(key: string, system: CalendarSystem) {
  if (system === 'BS') return formatAdDate(key, 'BS').split(' ')[1] ?? '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' });
}
function weekday(key: string, style: 'short' | 'long') {
  return new Date(key + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: style, timeZone: 'UTC' });
}

function methodLabel(method: string) {
  return method.toLowerCase() === 'gps' ? 'GPS' : method.charAt(0).toUpperCase() + method.slice(1);
}

/** Best-effort, never blocks the caller — a denied/unavailable location
 * just means the request is submitted without coordinates. */
function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export default function CheckInPage() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [myGender, setMyGender] = useState<Gender | null>(null);
  const [view, setView] = useState<View>('menu');
  usePageTitle(view === 'fix' ? 'Fix a Missed Punch' : view === 'leave' ? 'Leave Requests' : 'Check In/Out', view === 'menu' ? undefined : 'Check In/Out');

  // Live check-in/out state
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const [modal, setModal] = useState<PunchModal | null>(null);
  const [gpsRequests, setGpsRequests] = useState<AttendanceGpsRequest[]>([]);
  const [history, setHistory] = useState<AttendanceLog[]>([]);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('weekly');
  const [pendingLeave, setPendingLeave] = useState(0);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  // Re-read every minute so "Today: 4h 18m" keeps counting while the page is open.
  const [now, setNow] = useState(() => Date.now());

  // Fix-a-missed-punch state
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [correctionForm, setCorrectionForm] = useState(EMPTY_CORRECTION_FORM);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // Leave state
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveForm, setLeaveForm] = useState(EMPTY_LEAVE_FORM);
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setEmployeeId(profile?.employee_id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    supabase
      .from('employees')
      .select('name, gender')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        setMyName(data?.name ?? null);
        setMyGender((data?.gender as Gender | null) ?? null);
      });
  }, [employeeId]);

  // Which of the last 7 days were a week-off / holiday.
  useEffect(() => {
    const today = nepalTodayIso();
    fetchMyCompanyWeekOffConfig().then(c => setWeeklyOffDay(c.weeklyOffDay));
    supabase
      .from('company_holidays')
      .select('*')
      .gte('holiday_date', addDays(today, 1 - WEEK_LENGTH))
      .lte('holiday_date', today)
      .then(({ data }) => setHolidays((data as CompanyHoliday[]) ?? []));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    if (view === 'menu') {
      reloadGpsRequests(employeeId);
      reloadHistory(employeeId);
      reloadPendingLeave(employeeId);
    }
    if (view === 'fix') reloadCorrections(employeeId);
    if (view === 'leave') reloadLeave(employeeId);
  }, [view, employeeId]);

  function reloadGpsRequests(empId: string) {
    supabase
      .from('attendance_gps_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setGpsRequests(data ?? []));
  }

  function reloadPendingLeave(empId: string) {
    supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', empId)
      .eq('status', 'pending')
      .then(({ count }) => setPendingLeave(count ?? 0));
  }

  const filteredHistory = useMemo(() => {
    const cutoff = Date.now() - HISTORY_RANGE_DAYS[historyRange] * 86400000;
    return history.filter(log => new Date(log.punch_time).getTime() >= cutoff);
  }, [history, historyRange]);

  const pendingGpsRequests = useMemo(() => gpsRequests.filter(r => r.status === 'pending'), [gpsRequests]);
  const rejectedGpsRequests = useMemo(() => gpsRequests.filter(r => r.status === 'rejected'), [gpsRequests]);

  // Only the first check-in and last check-out of a day are the punches that
  // actually count (same selection payroll uses) — every other punch that
  // day (duplicate ZKTeco taps, etc.) shows as rejected instead of accepted.
  const acceptedPunchIds = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of history) {
      const key = localDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const ids = new Set<string>();
    for (const dayLogs of byDate.values()) {
      const { checkIn, checkOut } = selectDayPunches(dayLogs);
      ids.add(checkIn.id);
      if (checkOut) ids.add(checkOut.id);
    }
    return ids;
  }, [history]);

  // A rejected GPS request never becomes an attendance_logs row, so on its
  // own it would just vanish once it left Recent Request — merged in here
  // (same time window as the real punches) so the employee can still see it
  // was rejected instead of it disappearing with no trace.
  const historyEntries = useMemo(() => {
    const cutoff = Date.now() - HISTORY_RANGE_DAYS[historyRange] * 86400000;
    const fromLogs = filteredHistory.map(log => ({
      id: log.id,
      punchTime: log.punch_time,
      punchType: log.punch_type,
      method: log.method,
      accepted: acceptedPunchIds.has(log.id),
    }));
    const fromRejected = rejectedGpsRequests
      .filter(r => new Date(r.punch_time).getTime() >= cutoff)
      .map(r => ({
        id: `req-${r.id}`,
        punchTime: r.punch_time,
        punchType: r.punch_type,
        method: 'gps',
        accepted: false,
      }));
    return [...fromLogs, ...fromRejected].sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime());
  }, [filteredHistory, acceptedPunchIds, rejectedGpsRequests, historyRange]);

  // Today (Nepal time) from the accepted punches, falling back to a
  // still-pending GPS request so a fresh Check In doesn't read "Not in".
  const today = nepalTodayIso();
  const todaySummary = useMemo(() => {
    const todayLogs = history.filter(l => nepalDateKey(l.punch_time) === today && l.punch_type !== '2' && l.punch_type !== '3');
    const punches = todayLogs.length ? selectDayPunches(todayLogs) : null;
    const pendingToday = pendingGpsRequests.some(r => nepalDateKey(r.punch_time) === today);
    const status = punches?.checkOut
      ? { label: 'Checked out', tone: 'neutral' as const }
      : punches
        ? { label: 'Checked in', tone: 'good' as const }
        : pendingToday
          ? { label: 'Pending', tone: 'warning' as const }
          : { label: 'Not in', tone: 'warning' as const };
    const workedMinutes = punches
      ? Math.max(
          0,
          Math.round(
            ((punches.checkOut ? new Date(punches.checkOut.punch_time).getTime() : now) -
              new Date(punches.checkIn.punch_time).getTime()) /
              60000
          )
        )
      : 0;
    return { status, inAt: punches ? formatTime(punches.checkIn.punch_time) : '—', worked: formatHoursMinutes(workedMinutes), workedMinutes };
  }, [history, pendingGpsRequests, today, now]);

  // One row per day for the table, newest first: the punches that count, plus
  // anything that needs the employee (a rejected or pending request, a missed
  // check-out) and the company's week-off days. Days with nothing on them are skipped.
  const dayRows = useMemo(() => {
    const span = HISTORY_RANGE_DAYS[historyRange];
    const keys = Array.from({ length: span }, (_, i) => addDays(today, -i));
    const off = weekOffDatesInRange(keys[keys.length - 1], today, weeklyOffDay, holidays, myGender);
    const rows: DayRow[] = [];
    for (const key of keys) {
      const isToday = key === today;
      const dayLogs = history.filter(l => nepalDateKey(l.punch_time) === key && l.punch_type !== '2' && l.punch_type !== '3');
      const punches = dayLogs.length ? selectDayPunches(dayLogs) : null;
      const rejected = rejectedGpsRequests.filter(r => nepalDateKey(r.punch_time) === key);
      const pending = pendingGpsRequests.filter(r => nepalDateKey(r.punch_time) === key);
      const isOff = off.has(key) && !punches;
      if (!punches && !rejected.length && !pending.length && !isOff && !isToday) continue;
      const minutes = punches
        ? Math.max(
            0,
            Math.round(
              ((punches.checkOut ? new Date(punches.checkOut.punch_time).getTime() : isToday ? now : new Date(punches.checkIn.punch_time).getTime()) -
                new Date(punches.checkIn.punch_time).getTime()) /
                60000
            )
          )
        : null;
      rows.push({
        key,
        isToday,
        offLabel: isOff ? holidays.find(h => h.holiday_date === key)?.name ?? 'Week off' : null,
        inText: punches ? formatTime(punches.checkIn.punch_time) : null,
        outText: punches?.checkOut ? formatTime(punches.checkOut.punch_time) : null,
        minutes: punches && (punches.checkOut || isToday) ? minutes : null,
        via: punches ? methodLabel(punches.checkIn.method) : '',
        missed: !!punches && !punches.checkOut && !isToday,
        inNow: !!punches && !punches.checkOut && isToday,
        rejected: rejected.map(r => `${formatTime(r.punch_time)} ${methodLabel('gps')} ${punchTypeLabel(r.punch_type).toLowerCase()}`),
        pending: pending.map(r => `${formatTime(r.punch_time)} ${punchTypeLabel(r.punch_type).toLowerCase()}`),
      });
    }
    return rows;
  }, [history, historyRange, holidays, weeklyOffDay, myGender, today, now, rejectedGpsRequests, pendingGpsRequests]);

  const todayWeekOff = useMemo(() => {
    const off = weekOffDatesInRange(today, today, weeklyOffDay, holidays, myGender);
    if (!off.has(today)) return null;
    return { name: holidays.find(h => h.holiday_date === today)?.name ?? null };
  }, [today, weeklyOffDay, holidays, myGender]);

  const firstName = myName?.trim().split(/\s+/)[0];
  const todayLine = formatTodayLine(today);

  function reloadHistory(empId: string) {
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', empId)
      .gte('punch_time', new Date(Date.now() - HISTORY_WINDOW_DAYS * 86400000).toISOString())
      .order('punch_time', { ascending: false })
      .limit(50)
      .then(({ data }) => setHistory(data ?? []));
  }

  function reloadCorrections(empId: string) {
    supabase
      .from('attendance_correction_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []));
  }

  function reloadLeave(empId: string) {
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setLeaveRequests(data ?? []));
  }

  function locate(base: PunchModal) {
    if (!navigator.geolocation) {
      setModal({ ...base, status: 'error', error: 'This browser does not support location access.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos =>
        setModal(m =>
          m
            ? { ...m, status: 'ready', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }
            : m
        ),
      err => setModal(m => (m ? { ...m, status: 'error', error: err.message } : m)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function openPunchModal(punchType: '0' | '1' | '2' | '3') {
    if (!employeeId) {
      setMessage({ kind: 'critical', text: 'No employee linked to this account.' });
      return;
    }
    const base: PunchModal = { punchType, punchTime: new Date().toISOString(), status: 'locating' };
    setModal(base);
    locate(base);
  }

  function retryLocate() {
    if (!modal) return;
    const base: PunchModal = { punchType: modal.punchType, punchTime: modal.punchTime, status: 'locating' };
    setModal(base);
    locate(base);
  }

  async function confirmPunch() {
    if (!modal || modal.status !== 'ready' || !modal.coords || !employeeId) return;
    setBusy(true);
    const { error } = await supabase.from('attendance_gps_requests').insert({
      employee_id: employeeId,
      punch_time: modal.punchTime,
      punch_type: modal.punchType,
      lat: modal.coords.lat,
      lng: modal.coords.lng,
      accuracy_m: modal.coords.accuracy,
    });
    setBusy(false);
    const punchType = modal.punchType;
    setModal(null);
    if (error) setMessage({ kind: 'critical', text: `Check-in failed: ${error.message}` });
    else {
      setMessage({
        kind: 'good',
        text: `${punchTypeLabel(punchType)} submitted — waiting for Admin/HR approval.`,
      });
      reloadGpsRequests(employeeId);
    }
  }

  async function handleCorrectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setCorrectionError(null);
    const checkIn = toTimestamp(correctionForm.work_date, correctionForm.check_in_time);
    const checkOut = toTimestamp(correctionForm.work_date, correctionForm.check_out_time);
    if (!correctionForm.work_date || (!checkIn && !checkOut)) {
      setCorrectionError('Pick a date and at least one of check-in or check-out time.');
      return;
    }
    setSubmittingCorrection(true);
    const coords = await getCurrentCoords();
    const { error: insertError } = await supabase.from('attendance_correction_requests').insert({
      employee_id: employeeId,
      work_date: correctionForm.work_date,
      requested_check_in: checkIn,
      requested_check_out: checkOut,
      reason: correctionForm.reason || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
    setSubmittingCorrection(false);
    if (insertError) {
      setCorrectionError(insertError.message);
      return;
    }
    setCorrectionForm(EMPTY_CORRECTION_FORM);
    reloadCorrections(employeeId);
  }

  async function handleLeaveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setLeaveError(null);
    if (!leaveForm.start_date || !leaveForm.end_date) {
      setLeaveError('Pick both a start date and an end date.');
      return;
    }
    setSubmittingLeave(true);
    const { error: insertError } = await supabase.from('leave_requests').insert({
      employee_id: employeeId,
      leave_type: leaveForm.leave_type,
      start_date: leaveForm.start_date,
      end_date: leaveForm.end_date,
      reason: leaveForm.reason || null,
    });
    setSubmittingLeave(false);
    if (insertError) {
      setLeaveError(insertError.message);
      return;
    }
    setLeaveForm(EMPTY_LEAVE_FORM);
    reloadLeave(employeeId);
  }

  const leaveSpan =
    leaveForm.start_date && leaveForm.end_date && leaveForm.end_date >= leaveForm.start_date
      ? inclusiveDays(leaveForm.start_date, leaveForm.end_date)
      : null;

  // Each tile's colour follows what it says: green once there is something to show, orange when
  // the employee still needs to check in, grey when it is empty or finished.
  const statusTile = STATUS_TILE[todaySummary.status.tone];
  const inAtTile = STATUS_TILE[todaySummary.inAt === '—' ? 'neutral' : 'good'];
  const workedTile = STATUS_TILE[todaySummary.workedMinutes > 0 ? 'good' : 'neutral'];

  return (
    <PageBody>
      {view === 'menu' && (
        <>
          <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent p-4 shadow-sm sm:p-6">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-ink">Namaste{firstName ? `, ${firstName}` : ''}</h2>
              <p className="mt-0.5 text-sm text-slate-500">{todayLine}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <PinIcon className="h-3.5 w-3.5 shrink-0" />
                Uses your GPS location · approved by Admin/HR
              </p>
            </div>
            <PunchButtons disabled={!employeeId} onIn={() => openPunchModal('0')} onOut={() => openPunchModal('1')} />
          </section>

          {(todayWeekOff || message) && (
            <div className="mb-5 space-y-2">
              {todayWeekOff && (
                <div className="rounded-lg bg-info-bg px-4 py-3 text-sm text-info-text">
                  Today is a Week-off{todayWeekOff.name ? ` — ${todayWeekOff.name}` : ''}. No one is expected to work today.
                </div>
              )}
              {message && (
                <div role="status" className={`rounded-lg px-4 py-3 text-sm ${message.kind === 'good' ? 'bg-good-bg text-good-text' : 'bg-critical-bg text-critical-text'}`}>
                  {message.text}
                </div>
              )}
            </div>
          )}

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${statusTile.box}`}>
              <span className={`text-xs font-medium ${statusTile.label}`}>Status</span>
              <div className={`mt-1 text-base font-bold ${statusTile.value}`}>{todaySummary.status.label}</div>
              <div className={`mt-0.5 text-[11px] ${statusTile.sub}`}>{todaySummary.inAt === '—' ? 'Not checked in yet' : `Since ${todaySummary.inAt}`}</div>
            </div>
            <div className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${inAtTile.box}`}>
              <span className={`text-xs font-medium ${inAtTile.label}`}>In at</span>
              <div className={`mt-1 text-base font-bold ${inAtTile.value}`}>{todaySummary.inAt}</div>
              <div className={`mt-0.5 text-[11px] ${inAtTile.sub}`}>Today</div>
            </div>
            <div className={`col-span-2 rounded-xl p-3 shadow-sm ring-1 ring-inset sm:col-span-1 ${workedTile.box}`}>
              <span className={`text-xs font-medium ${workedTile.label}`}>Worked</span>
              <div className={`mt-1 text-base font-bold ${workedTile.value}`}>{todaySummary.worked}</div>
              <div className={`mt-0.5 text-[11px] ${workedTile.sub}`}>Today so far</div>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setView('fix')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-accent shadow-sm hover:bg-slate-50">
              <EditIcon className="h-4 w-4" />
              Fix a missed punch
            </button>
            <button type="button" onClick={() => setView('leave')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-accent shadow-sm hover:bg-slate-50">
              <UmbrellaIcon className="h-4 w-4" />
              Leave requests
            </button>
            {pendingLeave > 0 && <Badge tone="warning">{pendingLeave} pending</Badge>}
          </div>

          {pendingGpsRequests.length > 0 && (
            <section aria-label="Waiting for approval" className="mb-5 rounded-xl border border-slate-200 bg-white p-4 md:hidden">
              <h2 className="mb-2 text-sm font-semibold text-ink">Waiting for approval</h2>
              <div className="divide-y divide-slate-100">
                {pendingGpsRequests.map(r => {
                  const key = localDateKey(r.punch_time);
                  return (
                    <div key={r.id} className="flex items-center gap-3 py-2.5">
                      <DateBlock day={dayNumber(key, system)} month={monthShort(key, system)} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink">
                          {punchTypeLabel(r.punch_type)} · {formatTime(r.punch_time)}
                        </div>
                        <div className="text-xs text-slate-400">GPS</div>
                      </div>
                      <Badge tone={statusTone(r.status)}>{r.status === 'approved' ? 'Accepted' : r.status}</Badge>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section aria-label="Recent activity" className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
              <div role="group" aria-label="Range" className="flex gap-2">
                {(['daily', 'weekly', 'monthly'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setHistoryRange(r)}
                    aria-pressed={historyRange === r}
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                      historyRange === r ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {historyEntries.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">No attendance records for this period.</p>
            ) : (
              <>
                <div className="divide-y divide-slate-100 md:hidden">
                  {historyEntries.map(entry => {
                    const key = localDateKey(entry.punchTime);
                    return (
                      <div key={entry.id} className="flex items-center gap-3 p-4">
                        <DateBlock day={dayNumber(key, system)} month={monthShort(key, system)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink">
                            {punchTypeLabel(entry.punchType)} · {formatTime(entry.punchTime)}
                          </div>
                          <div className="text-xs text-slate-400">{methodLabel(entry.method)}</div>
                        </div>
                        <Badge tone={entry.accepted ? 'good' : 'critical'}>{entry.accepted ? 'Accepted' : 'Rejected'}</Badge>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2 font-medium">Day</th>
                        <th className="px-4 py-2 font-medium">In</th>
                        <th className="px-4 py-2 font-medium">Out</th>
                        <th className="px-4 py-2 font-medium">Worked</th>
                        <th className="px-4 py-2 font-medium">Via</th>
                        <th className="px-4 py-2 font-medium">Needs attention</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayRows.map(row => {
                        const label = `${weekday(row.key, 'short')} ${dayNumber(row.key, system)} ${monthName(row.key, system)}`;
                        if (row.offLabel) {
                          return (
                            <tr key={row.key} className="border-b border-slate-100 bg-slate-50 last:border-0">
                              <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{label}</td>
                              <td colSpan={5} className="px-4 py-2.5 text-slate-500">
                                {row.offLabel}
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={row.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">
                              {label}
                              {row.isToday && <span className="ml-2 align-middle"><Badge tone="info">Today</Badge></span>}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-slate-600">{row.inText ?? <span className="text-slate-400">–</span>}</td>
                            <td className="px-4 py-2.5 tabular-nums">
                              {row.outText ? (
                                <span className="text-slate-600">{row.outText}</span>
                              ) : row.inNow ? (
                                <span className="font-medium text-accent">In now</span>
                              ) : row.missed ? (
                                <span className="font-medium text-warning-text">Missing</span>
                              ) : (
                                <span className="text-slate-400">–</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-medium tabular-nums text-ink">{row.minutes != null ? formatHoursMinutes(row.minutes) : <span className="font-normal text-slate-400">–</span>}</td>
                            <td className="px-4 py-2.5 text-slate-600">{row.via}</td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {row.missed && (
                                  <button type="button" onClick={() => setView('fix')} className="rounded-md border border-warning/30 bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-text hover:bg-warning-bg/70">
                                    Fix it
                                  </button>
                                )}
                                {row.rejected.map(t => (
                                  <span key={t} className="flex items-center gap-2">
                                    <Badge tone="critical">Rejected</Badge>
                                    <span className="text-xs text-slate-500">{t}</span>
                                  </span>
                                ))}
                                {row.pending.map(t => (
                                  <span key={t} className="flex items-center gap-2">
                                    <Badge tone="warning">Pending</Badge>
                                    <span className="text-xs text-slate-500">{t}</span>
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {view !== 'menu' && (
        <>
          <button type="button" onClick={() => setView('menu')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-accent">
            <ChevronLeftIcon className="h-4 w-4" />
            Back to Check In/Out
          </button>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr] lg:items-start">
            {view === 'fix' && (
              <>
                <form onSubmit={handleCorrectionSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold text-ink">New correction</h2>
                  <p className="mb-4 mt-0.5 text-xs text-slate-400">
                    Forgot to check in or out? Request a correction and HR/Admin will review it. Your current location is captured automatically as confirmation.
                  </p>

                  <label className={FIELD_LABEL}>Date</label>
                  <DatePicker value={correctionForm.work_date} onChange={v => setCorrectionForm(f => ({ ...f, work_date: v }))} ariaLabel="Date" />

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className={FIELD_LABEL}>Check-in time</label>
                      <input type="time" value={correctionForm.check_in_time} onChange={e => setCorrectionForm(f => ({ ...f, check_in_time: e.target.value }))} className={TEXT_INPUT} />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>Check-out time</label>
                      <input type="time" value={correctionForm.check_out_time} onChange={e => setCorrectionForm(f => ({ ...f, check_out_time: e.target.value }))} className={TEXT_INPUT} />
                    </div>
                  </div>

                  <label className={`${FIELD_LABEL} mt-3`}>Reason (optional)</label>
                  <textarea value={correctionForm.reason} onChange={e => setCorrectionForm(f => ({ ...f, reason: e.target.value }))} className={TEXT_INPUT} rows={3} />
                  {correctionError && <p className="mt-3 text-sm text-critical">{correctionError}</p>}
                  <button type="submit" disabled={submittingCorrection || !employeeId} className={`${SUBMIT_BUTTON} mt-4`}>
                    {submittingCorrection ? 'Submitting…' : 'Submit request'}
                  </button>
                  {!employeeId && <p className="mt-2 text-xs text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>}
                </form>

                <section aria-label="My requests" className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
                  <h2 className="border-b border-slate-100 p-4 text-sm font-semibold text-ink">My requests</h2>
                  {requests.length === 0 ? (
                    <p className="p-8 text-center text-sm text-slate-400">No correction requests yet.</p>
                  ) : (
                    <>
                      <div className="divide-y divide-slate-100 md:hidden">
                        {requests.map(r => (
                          <div key={r.id} className="flex items-center gap-3 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink">{formatAdDate(r.work_date, system)}</div>
                              <div className="text-xs text-slate-500">
                                In {formatTime(r.requested_check_in)} · Out {formatTime(r.requested_check_out)}
                              </div>
                              {r.reason && <div className="text-xs text-slate-400">{r.reason}</div>}
                            </div>
                            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                          </div>
                        ))}
                      </div>
                      <div className="hidden overflow-x-auto md:block">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                              <th className="px-4 py-2 font-medium">Date</th>
                              <th className="px-4 py-2 font-medium">Check-in</th>
                              <th className="px-4 py-2 font-medium">Check-out</th>
                              <th className="px-4 py-2 font-medium">Reason</th>
                              <th className="px-4 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {requests.map(r => (
                              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{formatAdDate(r.work_date, system)}</td>
                                <td className="px-4 py-2.5 text-slate-600">{formatTime(r.requested_check_in)}</td>
                                <td className="px-4 py-2.5 text-slate-600">{formatTime(r.requested_check_out)}</td>
                                <td className="px-4 py-2.5 text-slate-500">{r.reason ?? '—'}</td>
                                <td className="px-4 py-2.5">
                                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}

            {view === 'leave' && (
              <>
                <form onSubmit={handleLeaveSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold text-ink">New request</h2>
                  <div className={FIELD_LABEL}>Type</div>
                  <div className="flex flex-wrap gap-2">
                    {LEAVE_TYPES.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setLeaveForm(f => ({ ...f, leave_type: t }))}
                        aria-pressed={leaveForm.leave_type === t}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
                          leaveForm.leave_type === t ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={FIELD_LABEL}>Start date</label>
                      <DatePicker value={leaveForm.start_date} onChange={v => setLeaveForm(f => ({ ...f, start_date: v }))} ariaLabel="Start date" />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>End date</label>
                      <DatePicker value={leaveForm.end_date} onChange={v => setLeaveForm(f => ({ ...f, end_date: v }))} ariaLabel="End date" />
                    </div>
                  </div>
                  {leaveSpan && (
                    <div className="mt-3">
                      <Badge tone="good">
                        {leaveSpan} {leaveSpan === 1 ? 'day' : 'days'}
                      </Badge>
                    </div>
                  )}

                  <label className={`${FIELD_LABEL} mt-3`}>Reason (optional)</label>
                  <textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} className={TEXT_INPUT} rows={3} />
                  {leaveError && <p className="mt-3 text-sm text-critical">{leaveError}</p>}
                  <button type="submit" disabled={submittingLeave || !employeeId} className={`${SUBMIT_BUTTON} mt-4`}>
                    {submittingLeave ? 'Submitting…' : 'Submit request'}
                  </button>
                  {!employeeId && <p className="mt-2 text-xs text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>}
                </form>

                <section aria-label="My requests" className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
                  <h2 className="border-b border-slate-100 p-4 text-sm font-semibold text-ink">My requests</h2>
                  {leaveRequests.length === 0 ? (
                    <p className="p-8 text-center text-sm text-slate-400">No leave requests yet.</p>
                  ) : (
                    <>
                      <div className="divide-y divide-slate-100 md:hidden">
                        {leaveRequests.map(r => (
                          <div key={r.id} className="flex items-center gap-3 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium capitalize text-ink">
                                {r.leave_type} · {formatAdDate(r.start_date, system)} → {formatAdDate(r.end_date, system)}
                              </div>
                              {r.reason && <div className="text-xs text-slate-400">{r.reason}</div>}
                            </div>
                            <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                          </div>
                        ))}
                      </div>
                      <div className="hidden overflow-x-auto md:block">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                              <th className="px-4 py-2 font-medium">Type</th>
                              <th className="px-4 py-2 font-medium">From</th>
                              <th className="px-4 py-2 font-medium">To</th>
                              <th className="px-4 py-2 font-medium">Days</th>
                              <th className="px-4 py-2 font-medium">Reason</th>
                              <th className="px-4 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaveRequests.map(r => (
                              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                                <td className="px-4 py-2.5 font-medium capitalize text-ink">{r.leave_type}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatAdDate(r.start_date, system)}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatAdDate(r.end_date, system)}</td>
                                <td className="px-4 py-2.5 text-slate-600">{inclusiveDays(r.start_date, r.end_date)}</td>
                                <td className="px-4 py-2.5 text-slate-500">{r.reason ?? '—'}</td>
                                <td className="px-4 py-2.5">
                                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </div>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div role="dialog" aria-modal="true" aria-label={`Confirm ${punchTypeLabel(modal.punchType)}`} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-ink">Confirm {punchTypeLabel(modal.punchType)}</h3>
            <p className="mb-4 mt-0.5 text-sm text-slate-500">{formatDateTime(modal.punchTime, system)}</p>

            {modal.status === 'locating' && (
              <div className="mb-5 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-600">
                <PinIcon className="h-4 w-4 shrink-0" />
                Getting your location…
              </div>
            )}
            {modal.status === 'ready' && (
              <div className="mb-5 flex items-center gap-2 rounded-lg bg-good-bg px-3 py-2.5 text-sm font-medium text-good-text">
                <PinIcon className="h-4 w-4 shrink-0" />
                Location confirmed
              </div>
            )}
            {modal.status === 'error' && (
              <div className="mb-5 rounded-lg bg-critical-bg px-3 py-2.5 text-sm text-critical-text">
                <div className="flex items-center gap-2">
                  <PinIcon className="h-4 w-4 shrink-0" />
                  {modal.error ?? 'Could not get your location.'}
                </div>
                <button type="button" onClick={retryLocate} className="mt-1.5 text-xs font-semibold underline">
                  Try again
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPunch}
                disabled={modal.status !== 'ready' || busy}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageBody>
  );
}

const STATUS_TILE = {
  good: { box: 'bg-emerald-100/80 ring-emerald-300/40', label: 'text-emerald-900/80', value: 'text-emerald-900', sub: 'text-emerald-900/70' },
  warning: { box: 'bg-warning-bg ring-warning/10', label: 'text-warning-text/80', value: 'text-warning-text', sub: 'text-warning-text/70' },
  neutral: { box: 'bg-slate-50 ring-slate-200', label: 'text-slate-500', value: 'text-ink', sub: 'text-slate-400' },
} as const;

/** Check In / Check Out. */
function PunchButtons({ disabled, onIn, onOut }: { disabled: boolean; onIn: () => void; onOut: () => void }) {
  return (
    <div className="flex gap-2.5">
      <button
        type="button"
        onClick={onIn}
        disabled={disabled}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 disabled:opacity-50"
      >
        <SignInIcon className="h-[18px] w-[18px]" />
        Check In
      </button>
      <button
        type="button"
        onClick={onOut}
        disabled={disabled}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-accent shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        <SignOutIcon className="h-[18px] w-[18px]" />
        Check Out
      </button>
    </div>
  );
}

/** The day / month tile beside each activity row on a phone. */
function DateBlock({ day, month }: { day: string; month: string }) {
  return (
    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-100">
      <span className="text-sm font-bold leading-4 text-ink">{day}</span>
      <span className="text-[9px] font-semibold text-slate-500">{month}</span>
    </div>
  );
}
