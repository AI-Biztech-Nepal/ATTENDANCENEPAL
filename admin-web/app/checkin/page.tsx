'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import DatePicker from '@/components/DatePicker';
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  EditIcon,
  HeroPanel,
  PinIcon,
  SignInIcon,
  SignOutIcon,
  StatusTag,
  UmbrellaIcon,
  type TagTone,
} from '@/components/employee/parts';
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

const FIELD_LABEL = 'mb-1.5 block text-xs font-semibold text-slate-600';
const TEXT_INPUT =
  'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-brand';
const TEXT_AREA =
  'w-full resize-none rounded-[10px] border border-slate-300 bg-white px-3.5 py-3 text-sm font-medium text-ink outline-none focus:border-brand';
const SUBMIT_BUTTON =
  'h-[52px] w-full rounded-xl bg-brand text-[15px] font-extrabold text-white disabled:opacity-60';
const TABLE_HEAD = 'h-10 bg-slate-100 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-600';

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

function statusTone(status: string): TagTone {
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
    return { status, inAt: punches ? formatTime(punches.checkIn.punch_time) : '—', worked: formatHoursMinutes(workedMinutes) };
  }, [history, pendingGpsRequests, today, now]);

  // The last 7 days, newest first, from the accepted punches plus the
  // company's week-off / holiday dates.
  const weekDays = useMemo(() => {
    const keys = Array.from({ length: WEEK_LENGTH }, (_, i) => addDays(today, -i));
    const off = weekOffDatesInRange(keys[WEEK_LENGTH - 1], today, weeklyOffDay, holidays, myGender);
    return keys.map(key => {
      const isToday = key === today;
      const dayLogs = history.filter(l => nepalDateKey(l.punch_time) === key && l.punch_type !== '2' && l.punch_type !== '3');
      const punches = dayLogs.length ? selectDayPunches(dayLogs) : null;
      const inText = punches ? formatTime(punches.checkIn.punch_time) : '';
      if (punches?.checkOut) {
        const minutes = Math.round(
          (new Date(punches.checkOut.punch_time).getTime() - new Date(punches.checkIn.punch_time).getTime()) / 60000
        );
        return { key, isToday, range: `${inText} – ${formatTime(punches.checkOut.punch_time)}`, sub: formatHoursMinutes(Math.max(0, minutes)), chip: isToday ? 'Today' : null, missed: false };
      }
      if (punches) {
        if (isToday) {
          const minutes = Math.max(0, Math.round((now - new Date(punches.checkIn.punch_time).getTime()) / 60000));
          return { key, isToday, range: `${inText} – now`, sub: `${formatHoursMinutes(minutes)} so far`, chip: 'Today', missed: false };
        }
        return { key, isToday, range: `${inText} – no check-out`, sub: 'Missed check-out', chip: null, missed: true };
      }
      if (off.has(key)) {
        const holiday = holidays.find(h => h.holiday_date === key)?.name;
        return { key, isToday, range: 'No work expected', sub: '', chip: holiday ?? 'Week off', missed: false };
      }
      return { key, isToday, range: isToday ? 'Not checked in yet' : 'No punches', sub: '', chip: isToday ? 'Today' : null, missed: false };
    });
  }, [history, holidays, weeklyOffDay, myGender, today, now]);

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

  return (
    <EmployeeShell
      title={view === 'fix' ? 'Fix a Missed Punch' : view === 'leave' ? 'Leave Requests' : 'Check In/Out'}
      eyebrow={view === 'menu' ? undefined : 'Check In/Out'}
      flush
    >
      {view === 'menu' && (
        <div className="lg:px-8 lg:pb-10 lg:pt-7">
          <HeroPanel pad="check">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
              <div className="min-w-0">
                <h2 className="truncate text-[26px] font-extrabold leading-8 tracking-[-0.4px] lg:text-[40px] lg:leading-[48px] lg:tracking-[-0.02em]">
                  Namaste{firstName ? `, ${firstName}` : ''}
                </h2>
                <p className="mt-1 text-[13px] font-semibold text-white/85 lg:text-[15px] lg:leading-[22px]">{todayLine}</p>
              </div>
              {/* Computer: the punch buttons live in the green panel. */}
              <div className="hidden lg:block">
                <PunchButtons onGreen disabled={!employeeId} onIn={() => openPunchModal('0')} onOut={() => openPunchModal('1')} />
                <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-white/90">
                  <PinIcon className="h-3.5 w-3.5 shrink-0" />
                  Uses your GPS location · approved by Admin/HR
                </p>
              </div>
            </div>
          </HeroPanel>

          <section className="relative mx-4 -mt-14 rounded-[18px] bg-white p-[18px] shadow-[0_10px_20px_rgba(6,78,59,0.14)] lg:mx-5 lg:-mt-16 lg:rounded-[20px] lg:px-2 lg:py-6 lg:shadow-[0_10px_24px_rgba(6,78,59,0.14)]">
            <div className="flex">
              <StatCell
                label="Status"
                value={todaySummary.status.label}
                disc={
                  <span className={`hidden h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full lg:flex ${
                    todaySummary.status.tone === 'good' ? 'bg-[#e2f3e8] text-[#15803d]' : todaySummary.status.tone === 'warning' ? 'bg-[#ffedd5] text-[#c2410c]' : 'bg-slate-100 text-slate-600'
                  }`}>
                    <CheckCircleIcon className="h-6 w-6" />
                  </span>
                }
                dot={todaySummary.status.tone}
                first
              />
              <StatCell
                label="In at"
                value={todaySummary.inAt}
                disc={
                  <span className="hidden h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-light text-brand lg:flex">
                    <SignInIcon className="h-6 w-6" />
                  </span>
                }
              />
              <StatCell
                label="Today"
                value={todaySummary.worked}
                disc={
                  <span className="hidden h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-info-bg text-info-text lg:flex">
                    <ClockIcon className="h-6 w-6" />
                  </span>
                }
              />
            </div>
            {/* Phone: the punch buttons sit inside the card, as in the app. */}
            <div className="mt-4 lg:hidden">
              <PunchButtons disabled={!employeeId} onIn={() => openPunchModal('0')} onOut={() => openPunchModal('1')} />
              <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <PinIcon className="h-3.5 w-3.5 shrink-0" />
                Uses your GPS location · approved by Admin/HR
              </p>
            </div>
          </section>

          {(todayWeekOff || message) && (
            <div className="mx-4 mt-3 space-y-2 lg:mx-5 lg:mt-4">
              {todayWeekOff && (
                <div className="rounded-xl bg-info-bg px-4 py-3 text-[13px] font-semibold text-info-text">
                  Today is a Week-off{todayWeekOff.name ? ` — ${todayWeekOff.name}` : ''}. No one is expected to work today.
                </div>
              )}
              {message && (
                <div
                  className={`rounded-xl px-4 py-3 text-[13px] ${
                    message.kind === 'good' ? 'bg-[#e2f3e8] text-[#14532d]' : 'bg-[#fee2e2] text-[#b91c1c]'
                  }`}
                >
                  {message.text}
                </div>
              )}
            </div>
          )}

          <div className="mx-4 mt-4 flex flex-col gap-5 lg:mx-0 lg:mt-6 lg:flex-row lg:items-start lg:gap-6">
            {/* Recent activity: rows on a phone, a table on a computer */}
            <section className="order-2 min-w-0 lg:order-1 lg:flex-[2] lg:rounded-[20px] lg:border lg:border-slate-200 lg:bg-white lg:px-7 lg:py-6">
              <div className="mb-2.5 flex items-center justify-between gap-3 lg:mb-4">
                <h2 className="text-base font-extrabold lg:text-xl">Recent activity</h2>
                <div role="group" aria-label="Range" className="flex rounded-full bg-slate-200 p-[3px]">
                  {(['daily', 'weekly', 'monthly'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setHistoryRange(r)}
                      aria-pressed={historyRange === r}
                      className={`h-[38px] rounded-full px-3 text-xs capitalize lg:px-4 ${
                        historyRange === r ? 'bg-white font-extrabold text-brand' : 'font-bold text-slate-600'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {historyEntries.length === 0 ? (
                <p className="mt-5 text-center text-sm text-slate-500 lg:py-6">No attendance records for this period.</p>
              ) : (
                <>
                  <div className="lg:hidden">
                    {historyEntries.map(entry => {
                      const key = localDateKey(entry.punchTime);
                      return (
                        <div key={entry.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                          <DateBlock day={dayNumber(key, system)} month={monthShort(key, system)} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-extrabold">
                              {punchTypeLabel(entry.punchType)} · {formatTime(entry.punchTime)}
                            </div>
                            <div className="mt-0.5 text-xs font-semibold text-slate-500">{methodLabel(entry.method)}</div>
                          </div>
                          <StatusTag tone={entry.accepted ? 'good' : 'critical'}>{entry.accepted ? 'Accepted' : 'Rejected'}</StatusTag>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full table-fixed text-left">
                      <colgroup>
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '16%' }} />
                        <col style={{ width: '14%' }} />
                      </colgroup>
                      <thead>
                        <tr className={TABLE_HEAD}>
                          <th className="pl-4">Date</th>
                          <th>Activity</th>
                          <th>Time</th>
                          <th>Method</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyEntries.map(entry => {
                          const key = localDateKey(entry.punchTime);
                          const isOut = entry.punchType === '1';
                          return (
                            <tr key={entry.id} className="h-14 border-t border-slate-100">
                              <td className="pl-4">
                                <div className="text-sm font-extrabold">{formatAdDate(key, system)}</div>
                                <div className="text-xs font-semibold text-slate-500">{weekday(key, 'long')}</div>
                              </td>
                              <td>
                                <span className="inline-flex items-center gap-2.5 text-sm font-bold">
                                  <span
                                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                                      isOut ? 'bg-[#ffedd5] text-[#c2410c]' : 'bg-[#e2f3e8] text-[#15803d]'
                                    }`}
                                  >
                                    {isOut ? <SignOutIcon className="h-4 w-4" /> : <SignInIcon className="h-4 w-4" />}
                                  </span>
                                  {punchTypeLabel(entry.punchType)}
                                </span>
                              </td>
                              <td className="text-sm font-semibold">{formatTime(entry.punchTime)}</td>
                              <td className="text-sm font-semibold text-slate-600">{methodLabel(entry.method)}</td>
                              <td>
                                <StatusTag tone={entry.accepted ? 'good' : 'critical'}>{entry.accepted ? 'Accepted' : 'Rejected'}</StatusTag>
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

            <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2 lg:w-[400px] lg:shrink-0 lg:gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white lg:rounded-[20px]">
                <button
                  type="button"
                  onClick={() => setView('fix')}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left lg:gap-3.5 lg:px-[22px] lg:py-[18px]"
                >
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-light text-brand lg:h-11 lg:w-11">
                    <EditIcon className="h-[18px] w-[18px] lg:h-5 lg:w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold lg:text-[15px]">Fix a missed punch</span>
                    <span className="mt-px block text-xs font-semibold text-slate-500 lg:text-[13px]">Forgot to check in or out?</span>
                  </span>
                  <ChevronRightIcon className="h-[18px] w-[18px] shrink-0 text-slate-500 lg:h-5 lg:w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setView('leave')}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left lg:gap-3.5 lg:px-[22px] lg:py-[18px]"
                >
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-light text-brand lg:h-11 lg:w-11">
                    <UmbrellaIcon className="h-[18px] w-[18px] lg:h-5 lg:w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold lg:text-[15px]">Leave requests</span>
                    <span className="mt-px block text-xs font-semibold text-slate-500 lg:text-[13px]">Casual, sick and annual</span>
                  </span>
                  {pendingLeave > 0 && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-[#ffedd5] px-2.5 py-[3px] text-xs font-extrabold text-[#c2410c]">
                      {pendingLeave} pending
                    </span>
                  )}
                  <ChevronRightIcon className="h-[18px] w-[18px] shrink-0 text-slate-500 lg:h-5 lg:w-5" />
                </button>
              </div>

              {pendingGpsRequests.length > 0 && (
                <section>
                  <h2 className="mb-2 text-base font-extrabold">Waiting for approval</h2>
                  {pendingGpsRequests.map(r => {
                    const key = localDateKey(r.punch_time);
                    return (
                      <div key={r.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                        <DateBlock day={dayNumber(key, system)} month={monthShort(key, system)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-extrabold">
                            {punchTypeLabel(r.punch_type)} · {formatTime(r.punch_time)}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold text-slate-500">GPS</div>
                        </div>
                        <StatusTag tone={statusTone(r.status)}>{r.status === 'approved' ? 'Accepted' : r.status}</StatusTag>
                      </div>
                    );
                  })}
                </section>
              )}

              {/* Computer only: the phone already has the recent-activity rows */}
              <section className="hidden rounded-[20px] border border-slate-200 bg-white p-6 lg:block">
                <h2 className="text-xl font-extrabold leading-[26px]">Last 7 days</h2>
                <p className="mb-3 mt-0.5 text-[13px] font-semibold text-slate-600">Hours from your accepted punches</p>
                {weekDays.map(day => (
                  <div key={day.key} className="flex h-14 items-center gap-3 border-t border-slate-100">
                    <span
                      className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] ${
                        day.isToday ? 'bg-brand text-white' : 'bg-slate-100 text-ink'
                      }`}
                    >
                      <span className={`text-[10px] font-extrabold uppercase leading-3 ${day.isToday ? '' : 'text-slate-600'}`}>
                        {weekday(day.key, 'short')}
                      </span>
                      <span className="text-base font-extrabold leading-[18px]">{dayNumber(day.key, system)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-extrabold ${day.sub ? '' : 'text-slate-600'}`}>{day.range}</span>
                      {day.sub && (
                        <span className={`block text-xs font-semibold ${day.missed ? 'text-[#c2410c]' : 'text-slate-600'}`}>{day.sub}</span>
                      )}
                    </span>
                    {day.missed ? (
                      <button
                        type="button"
                        onClick={() => setView('fix')}
                        className="rounded-full bg-[#ffedd5] px-2.5 py-1 text-[11px] font-extrabold text-[#c2410c] hover:bg-[#fed7aa]"
                      >
                        Fix it
                      </button>
                    ) : day.chip ? (
                      <span
                        className={`rounded-full px-2.5 py-[3px] text-[11px] font-extrabold ${
                          day.chip === 'Today' ? 'bg-brand-light text-brand' : 'bg-info-bg text-info-text'
                        }`}
                      >
                        {day.chip}
                      </span>
                    ) : null}
                  </div>
                ))}
              </section>
            </div>
          </div>
        </div>
      )}

      {view !== 'menu' && (
        <div className="lg:px-8 lg:pb-10 lg:pt-7">
          <HeroPanel pad="inner">
            <button
              type="button"
              onClick={() => setView('menu')}
              className="inline-flex h-8 items-center gap-1 text-sm font-bold text-white/95 hover:underline"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Check In/Out
            </button>
            {/* A phone shows the page name here; on a computer the header above already says it. */}
            <h2 className="text-2xl font-extrabold leading-8 tracking-[-0.3px] lg:hidden">
              {view === 'fix' ? 'Fix a Missed Punch' : 'Leave Requests'}
            </h2>
          </HeroPanel>

          <div className="relative mx-4 -mt-10 flex flex-col gap-4 lg:mx-5 lg:-mt-11 lg:flex-row lg:items-start lg:gap-6">
            {view === 'fix' && (
              <>
                <form
                  onSubmit={handleCorrectionSubmit}
                  className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_24px_rgba(6,78,59,0.10)] lg:w-[420px] lg:shrink-0 lg:p-6"
                >
                  <h2 className="text-xl font-extrabold leading-6">New correction</h2>
                  <p className="mb-4 mt-1.5 text-[13px] font-medium leading-[19px] text-slate-600">
                    Forgot to check in or out? Request a correction and HR/Admin will review it. Your current location is
                    captured automatically as confirmation.
                  </p>

                  <label className={FIELD_LABEL}>Date</label>
                  <DatePicker value={correctionForm.work_date} onChange={v => setCorrectionForm(f => ({ ...f, work_date: v }))} />

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <label className={FIELD_LABEL}>Check-in time</label>
                      <input
                        type="time"
                        value={correctionForm.check_in_time}
                        onChange={e => setCorrectionForm(f => ({ ...f, check_in_time: e.target.value }))}
                        className={TEXT_INPUT}
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>Check-out time</label>
                      <input
                        type="time"
                        value={correctionForm.check_out_time}
                        onChange={e => setCorrectionForm(f => ({ ...f, check_out_time: e.target.value }))}
                        className={TEXT_INPUT}
                      />
                    </div>
                  </div>

                  <label className={`${FIELD_LABEL} mt-4`}>Reason (optional)</label>
                  <textarea
                    value={correctionForm.reason}
                    onChange={e => setCorrectionForm(f => ({ ...f, reason: e.target.value }))}
                    className={`${TEXT_AREA} h-24`}
                    rows={3}
                  />
                  {correctionError && <p className="mt-3 text-sm text-critical">{correctionError}</p>}
                  <button type="submit" disabled={submittingCorrection || !employeeId} className={`${SUBMIT_BUTTON} mt-4`}>
                    {submittingCorrection ? 'Submitting…' : 'Submit request'}
                  </button>
                  {!employeeId && <p className="mt-2 text-xs text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>}
                </form>

                <section className="min-w-0 rounded-[20px] border border-slate-200 bg-white p-5 lg:flex-1 lg:p-6">
                  <h2 className="mb-4 text-xl font-extrabold leading-6">My requests</h2>
                  {requests.length === 0 ? (
                    <p className="text-center text-sm text-slate-500">No correction requests yet.</p>
                  ) : (
                    <>
                      <div className="lg:hidden">
                        {requests.map(r => (
                          <div key={r.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-extrabold">{formatAdDate(r.work_date, system)}</div>
                              <div className="mt-0.5 text-xs font-semibold text-slate-500">
                                In {formatTime(r.requested_check_in)} · Out {formatTime(r.requested_check_out)}
                              </div>
                              {r.reason && <div className="mt-0.5 text-xs font-semibold text-slate-500">{r.reason}</div>}
                            </div>
                            <StatusTag tone={statusTone(r.status)}>{r.status}</StatusTag>
                          </div>
                        ))}
                      </div>
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="w-full min-w-[520px] table-fixed text-left text-sm">
                          <thead>
                            <tr className={TABLE_HEAD}>
                              <th className="w-[24%] pl-3">Date</th>
                              <th className="w-[15%]">Check-in</th>
                              <th className="w-[15%]">Check-out</th>
                              <th className="w-[26%]">Reason</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {requests.map(r => (
                              <tr key={r.id} className="h-14 border-t border-slate-100">
                                <td className="pl-3 font-extrabold">{formatAdDate(r.work_date, system)}</td>
                                <td>{formatTime(r.requested_check_in)}</td>
                                <td>{formatTime(r.requested_check_out)}</td>
                                <td className="pr-2 text-slate-600">{r.reason ?? '—'}</td>
                                <td>
                                  <StatusTag tone={statusTone(r.status)}>{r.status}</StatusTag>
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
                <form
                  onSubmit={handleLeaveSubmit}
                  className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_24px_rgba(6,78,59,0.10)] lg:w-[420px] lg:shrink-0 lg:p-6"
                >
                  <h2 className="mb-4 text-xl font-extrabold leading-6">New request</h2>
                  <div className={FIELD_LABEL}>Type</div>
                  <div className="flex flex-wrap gap-2">
                    {LEAVE_TYPES.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setLeaveForm(f => ({ ...f, leave_type: t }))}
                        aria-pressed={leaveForm.leave_type === t}
                        className={`h-10 rounded-full border px-4 text-[13px] capitalize ${
                          leaveForm.leave_type === t
                            ? 'border-brand bg-brand font-bold text-white'
                            : 'border-slate-300 bg-white font-semibold text-slate-600'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={FIELD_LABEL}>Start date</label>
                      <DatePicker value={leaveForm.start_date} onChange={v => setLeaveForm(f => ({ ...f, start_date: v }))} />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>End date</label>
                      <DatePicker value={leaveForm.end_date} onChange={v => setLeaveForm(f => ({ ...f, end_date: v }))} />
                    </div>
                  </div>
                  {leaveSpan && (
                    <div className="mt-3 inline-block rounded-full bg-brand-light px-3 py-[5px] text-xs font-extrabold text-brand">
                      {leaveSpan} {leaveSpan === 1 ? 'day' : 'days'}
                    </div>
                  )}

                  <label className={`${FIELD_LABEL} mt-4`}>Reason (optional)</label>
                  <textarea
                    value={leaveForm.reason}
                    onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                    className={`${TEXT_AREA} h-24`}
                    rows={3}
                  />
                  {leaveError && <p className="mt-3 text-sm text-critical">{leaveError}</p>}
                  <button type="submit" disabled={submittingLeave || !employeeId} className={`${SUBMIT_BUTTON} mt-4`}>
                    {submittingLeave ? 'Submitting…' : 'Submit request'}
                  </button>
                  {!employeeId && <p className="mt-2 text-xs text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>}
                </form>

                <section className="min-w-0 rounded-[20px] border border-slate-200 bg-white p-5 lg:flex-1 lg:p-6">
                  <h2 className="mb-4 text-xl font-extrabold leading-6">My requests</h2>
                  {leaveRequests.length === 0 ? (
                    <p className="text-center text-sm text-slate-500">No leave requests yet.</p>
                  ) : (
                    <>
                      <div className="lg:hidden">
                        {leaveRequests.map(r => (
                          <div key={r.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-extrabold capitalize">
                                {r.leave_type} · {formatAdDate(r.start_date, system)} → {formatAdDate(r.end_date, system)}
                              </div>
                              {r.reason && <div className="mt-0.5 text-xs font-semibold text-slate-500">{r.reason}</div>}
                            </div>
                            <StatusTag tone={statusTone(r.status)}>{r.status}</StatusTag>
                          </div>
                        ))}
                      </div>
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="w-full min-w-[560px] table-fixed text-left text-sm">
                          <thead>
                            <tr className={TABLE_HEAD}>
                              <th className="w-[13%] pl-3">Type</th>
                              <th className="w-[21%]">From</th>
                              <th className="w-[21%]">To</th>
                              <th className="w-[8%]">Days</th>
                              <th className="w-[19%]">Reason</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaveRequests.map(r => (
                              <tr key={r.id} className="h-14 border-t border-slate-100">
                                <td className="pl-3 font-extrabold capitalize">{r.leave_type}</td>
                                <td>{formatAdDate(r.start_date, system)}</td>
                                <td>{formatAdDate(r.end_date, system)}</td>
                                <td>{inclusiveDays(r.start_date, r.end_date)}</td>
                                <td className="pr-2 text-slate-600">{r.reason ?? '—'}</td>
                                <td>
                                  <StatusTag tone={statusTone(r.status)}>{r.status}</StatusTag>
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
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Confirm ${punchTypeLabel(modal.punchType)}`}
            className="w-full max-w-sm rounded-[18px] bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-extrabold">Confirm {punchTypeLabel(modal.punchType)}</h3>
            <p className="mb-3.5 mt-1 text-[13px] font-semibold text-slate-600">{formatDateTime(modal.punchTime, system)}</p>

            {modal.status === 'locating' && (
              <div className="mb-5 flex items-center gap-2 rounded-[10px] bg-slate-100 px-3 py-2.5 text-[13px] font-bold text-slate-600">
                <PinIcon className="h-4 w-4 shrink-0" />
                Getting your location…
              </div>
            )}
            {modal.status === 'ready' && (
              <div className="mb-5 flex items-center gap-2 rounded-[10px] bg-[#e2f3e8] px-3 py-2.5 text-[13px] font-bold text-[#14532d]">
                <PinIcon className="h-4 w-4 shrink-0" />
                Location confirmed
              </div>
            )}
            {modal.status === 'error' && (
              <div className="mb-5 rounded-[10px] bg-[#fee2e2] px-3 py-2.5 text-[13px] font-bold text-[#b91c1c]">
                <div className="flex items-center gap-2">
                  <PinIcon className="h-4 w-4 shrink-0" />
                  {modal.error ?? 'Could not get your location.'}
                </div>
                <button type="button" onClick={retryLocate} className="mt-1.5 text-xs font-bold underline">
                  Try again
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="h-11 rounded-[10px] px-4 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPunch}
                disabled={modal.status !== 'ready' || busy}
                className="h-11 rounded-[10px] bg-brand px-6 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </EmployeeShell>
  );
}

/** Check In / Check Out. On the green hero panel (computer) they are white;
 * inside the white summary card (phone) they are green. */
function PunchButtons({
  onGreen = false,
  disabled,
  onIn,
  onOut,
}: {
  onGreen?: boolean;
  disabled: boolean;
  onIn: () => void;
  onOut: () => void;
}) {
  const base =
    'flex h-[52px] flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold disabled:opacity-50 lg:h-14 lg:w-[180px] lg:flex-none lg:rounded-[14px] lg:text-base';
  return (
    <div className="flex gap-2.5 lg:gap-3">
      <button
        type="button"
        onClick={onIn}
        disabled={disabled}
        className={`${base} ${onGreen ? 'bg-white text-brand' : 'bg-brand text-white'}`}
      >
        <SignInIcon className="h-[18px] w-[18px]" />
        Check In
      </button>
      <button
        type="button"
        onClick={onOut}
        disabled={disabled}
        className={`${base} border-[1.5px] ${onGreen ? 'border-white/80 text-white' : 'border-slate-300 bg-white text-brand'}`}
      >
        <SignOutIcon className="h-[18px] w-[18px]" />
        Check Out
      </button>
    </div>
  );
}

/** One of the three numbers on the summary card. */
function StatCell({
  label,
  value,
  disc,
  dot,
  first = false,
}: {
  label: string;
  value: string;
  disc: React.ReactNode;
  dot?: 'good' | 'warning' | 'neutral';
  first?: boolean;
}) {
  const dotColor = dot === 'good' ? 'bg-[#15803d]' : dot === 'warning' ? 'bg-warning' : 'bg-slate-500';
  return (
    <div
      className={`min-w-0 px-2.5 lg:flex lg:flex-1 lg:items-center lg:gap-4 lg:px-6 ${
        first ? 'flex-[1.3] pl-0 lg:pl-6' : 'flex-1 border-l border-slate-200'
      }`}
    >
      {disc}
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-slate-600">{label}</div>
        <div className="mt-1 flex items-center gap-1.5 lg:mt-0.5">
          {dot && <span className={`h-[7px] w-[7px] shrink-0 rounded-full lg:hidden ${dotColor}`} />}
          <span className="truncate text-[15px] font-extrabold lg:text-[28px] lg:leading-[34px]">{value}</span>
        </div>
      </div>
    </div>
  );
}

/** The day / month tile beside each activity row on a phone. */
function DateBlock({ day, month }: { day: string; month: string }) {
  return (
    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-slate-100">
      <span className="text-base font-extrabold leading-[18px]">{day}</span>
      <span className="mt-px text-[10px] font-extrabold text-slate-600">{month}</span>
    </div>
  );
}
