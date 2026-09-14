'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import { useConfirm } from '@/components/ConfirmDialog';
import type { AttendanceLog, Branch, Device, DeviceSyncEvent, Employee } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS } from '@/lib/types';

const EMPTY_FORM = { name: '', branch_id: '', ip_address: '', port: 4370, serial_number: '' };

function deviceErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'That serial number is already registered to another device.';
  return error.message;
}

// A LAN-bridge device (desktop-app/lan-bridge.js, zkteco-bridge/index.js)
// polls every 15s and only writes status: 'online'/'offline' when a poll
// actually runs — if the bridge process itself isn't running (window
// closed, pm2 stopped, machine off), no code runs at all and the row just
// keeps whatever status the last successful poll wrote, usually 'online',
// forever. A cloud/ADMS device (zkteco-bridge/push-server.js) is different:
// nothing polls it, the DEVICE pushes on its own schedule, and that
// server's own offline sweep only flags one stale after OFFLINE_AFTER_MS
// (5 minutes by default, push-server.js) — so this threshold has to be at
// least that lenient, or a perfectly healthy cloud device flips to
// "offline" here well before the server itself would ever call it stale.
// There's no separate "connection type" column to pick a threshold per
// device (see ARCHITECTURE.md), so one shared value has to cover both.
const STALE_AFTER_MS = 5 * 60 * 1000;

function computeRawOnline(d: Device, now: number): boolean {
  return d.status === 'online' && !!d.last_sync && now - new Date(d.last_sync).getTime() < STALE_AFTER_MS;
}

// zkteco-bridge/push-server.js documents an unresolved bug of its own: something
// occasionally flips a cloud device's status back to 'offline' within seconds of it
// going 'online', self-correcting a few seconds later (see its reassertOnlineForRecentDevices
// comment) — a brief, real flap in the underlying column, not a display bug here. Rather than
// showing that flicker to the admin (which reads exactly like "the site says offline when the
// device is online"), only actually render "offline" once a device has stayed non-online for
// this long continuously — a genuine outage still shows up, just a few seconds later, while a
// sub-debounce blip never reaches the screen at all.
const FLAP_DEBOUNCE_MS = 20_000;

function isDeviceOnline(d: Device, now: number, notOnlineSince: Map<string, number>): boolean {
  const raw = computeRawOnline(d, now);
  if (raw) {
    notOnlineSince.delete(d.id);
    return true;
  }
  const since = notOnlineSince.get(d.id) ?? now;
  if (!notOnlineSince.has(d.id)) notOnlineSince.set(d.id, since);
  return now - since < FLAP_DEBOUNCE_MS;
}

type BridgeCredential = { id: string; email: string; createdAt: string };
type BridgeResult = { email: string; password: string; envFile: string };

function downloadEnvFile(envFile: string) {
  // application/octet-stream, not text/plain: Chrome/Edge on Windows silently
  // append .txt to a dotfile (no name before the extension) downloaded as
  // text/plain, turning .env into .env.txt with the visible name unchanged
  // when "hide known extensions" is on — invisible until the bridge can't
  // find its credential file.
  const blob = new Blob([envFile], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '.env';
  a.click();
  URL.revokeObjectURL(url);
}

export default function DevicesPage() {
  const confirm = useConfirm();
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [syncEvents, setSyncEvents] = useState<DeviceSyncEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [queuing, setQueuing] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [bridgeCredentials, setBridgeCredentials] = useState<BridgeCredential[]>([]);
  const [generatingBridge, setGeneratingBridge] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeResult, setBridgeResult] = useState<BridgeResult | null>(null);
  const [revokingBridgeId, setRevokingBridgeId] = useState<string | null>(null);

  // Ticks so a device's badge flips from online to offline as soon as
  // last_sync goes stale, even with no new row update arriving to trigger it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  // deviceId -> when it first stopped looking online, for isDeviceOnline()'s
  // flap debounce — a plain ref (not state) since it's read/written in
  // render, not something that should itself trigger a re-render.
  const notOnlineSinceRef = useRef<Map<string, number>>(new Map());

  function reload() {
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).eq('method', 'zkteco').then(({ data }) => setLogs(data ?? []));
    supabase
      .from('device_sync_events')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setSyncEvents(data ?? []));
    loadBridgeCredentials();
  }
  useEffect(reload, []);

  // While a RECENT sync is still queued/running, poll every 3s so a click on
  // "Sync Now" reflects the bridge (desktop app or standalone worker) picking
  // it up and finishing without the admin having to hit Refresh. The 2-minute
  // cutoff on requested_at stops the poll from running forever when a sync is
  // stuck 'pending' because the bridge is offline.
  useEffect(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    const active = syncEvents.some(
      e => (e.status === 'pending' || e.status === 'running') && new Date(e.requested_at).getTime() > cutoff
    );
    if (!active) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [syncEvents]);

  async function queueSync(deviceId: string, syncType: 'users' | 'logs') {
    setQueuing(`${deviceId}-${syncType}`);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from('device_sync_events').insert({
      device_id: deviceId,
      sync_type: syncType,
      requested_by: user?.id ?? null,
    });
    setQueuing(null);
    if (error) alert(`Could not queue sync: ${error.message}`);
    reload();
  }

  async function cancelSync(eventId: string) {
    const { error } = await supabase
      .from('device_sync_events')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', eventId);
    if (error) alert(`Could not cancel: ${error.message}`);
    reload();
  }

  async function loadBridgeCredentials() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const res = await fetch('/api/bridge-credentials', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setBridgeCredentials(body.credentials ?? []);
  }

  async function handleGenerateBridge() {
    setGeneratingBridge(true);
    setBridgeError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setGeneratingBridge(false);
      setBridgeError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/bridge-credentials', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setGeneratingBridge(false);
    if (!res.ok) {
      setBridgeError(body.error ?? 'Could not generate the credential.');
      return;
    }
    setBridgeResult({ email: body.email, password: body.password, envFile: body.envFile });
    loadBridgeCredentials();
  }

  async function handleRevokeBridge(id: string) {
    if (
      !(await confirm('Revoke this bridge credential? Any machine still using it will stop being able to sync immediately.', {
        title: 'Revoke credential?',
        confirmLabel: 'Revoke',
        tone: 'danger',
      }))
    )
      return;
    setRevokingBridgeId(id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setRevokingBridgeId(null);
      alert('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/bridge-credentials', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    setRevokingBridgeId(null);
    if (!res.ok) {
      alert(body.error ?? 'Could not revoke the credential.');
      return;
    }
    loadBridgeCredentials();
  }

  // Reflects zkteco-bridge's status/last_sync writes the moment they land, instead of
  // requiring a manual "Refresh" click.
  useEffect(() => {
    const channel = supabase
      .channel('devices-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'devices' }, payload => {
        setDevices(prev => [...prev, payload.new as Device]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
        const updated = payload.new as Device;
        setDevices(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'devices' }, payload => {
        const removed = payload.old as Device;
        setDevices(prev => prev.filter(d => d.id !== removed.id));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.from('devices').insert({
      name: form.name,
      branch_id: form.branch_id || null,
      ip_address: form.ip_address,
      port: form.port,
      serial_number: form.serial_number,
      status: 'offline',
    });
    setSaving(false);
    if (error) {
      setFormError(deviceErrorMessage(error));
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm('Remove this device? Past punches synced from it are kept, but it will stop being polled.', {
        title: 'Remove device?',
        confirmLabel: 'Remove',
        tone: 'danger',
      }))
    )
      return;
    const { error } = await supabase.from('devices').delete().eq('id', id);
    if (error) alert(`Could not remove: ${error.message}`);
    reload();
  }

  function openEdit(d: Device) {
    setEditingDevice(d);
    setEditForm({
      name: d.name,
      branch_id: d.branch_id ?? '',
      ip_address: d.ip_address,
      port: d.port,
      serial_number: d.serial_number ?? '',
    });
    setEditError(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDevice) return;
    setSavingEdit(true);
    setEditError(null);
    const { error } = await supabase
      .from('devices')
      .update({
        name: editForm.name,
        branch_id: editForm.branch_id || null,
        ip_address: editForm.ip_address,
        port: editForm.port,
        serial_number: editForm.serial_number || null,
      })
      .eq('id', editingDevice.id);
    setSavingEdit(false);
    if (error) {
      setEditError(deviceErrorMessage(error));
      return;
    }
    setEditingDevice(null);
    reload();
  }

  return (
    <AppShell title="Biometric Sync Devices">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Biometric terminal integrations, synced automatically both ways — but if a device hasn&apos;t polled on its own (bridge
          just started, missed a cycle), use <strong>Sync Now</strong> to fetch immediately instead of waiting up to 15s for the
          next automatic poll. Renaming an employee here pushes that name back down to every device. For a cloud-connected device,
          a punch from a fingerprint the app doesn&apos;t recognize yet creates a placeholder employee right away; for a LAN-bridge
          device, register the employee first and set their Biometric/Registration ID to match, or its punches are skipped rather
          than recorded — use <strong>Sync Users</strong> to pull the device&apos;s enrolled users in as new employees instead.
        </p>
        <div className="flex gap-2">
          <button onClick={reload} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ⟳ Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
            + Add Device
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map(d => {
          const branch = branches.find(b => b.id === d.branch_id);
          const registered = employees.filter(e => e.branch_id === d.branch_id && e.fingerprint_id).length;
          const fetched = logs.filter(l => l.device_id === d.id).length;
          const online = isDeviceOnline(d, now, notOnlineSinceRef.current);
          const deviceEvents = syncEvents.filter(e => e.device_id === d.id);
          const busy = (type: 'users' | 'logs') =>
            queuing === `${d.id}-${type}` ||
            deviceEvents.some(e => e.sync_type === type && (e.status === 'pending' || e.status === 'running'));
          // Only a still-pending request can be cancelled — once the bridge
          // flips it to 'running' it's already claimed and can't be stopped
          // from here.
          const pendingEvent = (type: 'users' | 'logs') => deviceEvents.find(e => e.sync_type === type && e.status === 'pending');
          const lastLogEvent = deviceEvents.find(e => e.sync_type === 'logs' && (e.status === 'success' || e.status === 'failed'));
          return (
            <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-ink">{d.name}</h3>
                <Badge tone={online ? 'good' : 'critical'}>{online ? 'online' : 'offline'}</Badge>
              </div>
              <p className="mb-3 text-sm text-slate-500">{d.ip_address}:{d.port}</p>
              <p className="text-sm text-slate-600">📍 {branch?.name ?? 'Unassigned branch'}</p>
              <p className="text-sm text-slate-600">🔢 Serial: {d.serial_number ?? '—'}</p>
              <p className="text-sm text-slate-600">
                🔄 Last sync: {d.last_sync ? new Date(d.last_sync).toLocaleString() : 'never'}
              </p>
              {/* Employees link to a branch, not a specific device, so this
                  is the same number on every device at this branch — not
                  this device's own enrollment count. */}
              <p className="text-sm text-slate-600">👥 Registered at this branch: {registered} staff</p>

              <div className="mt-3 flex gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <button
                    onClick={() => queueSync(d.id, 'logs')}
                    disabled={busy('logs')}
                    title="Fetch attendance from this device right now, instead of waiting for the next automatic poll"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busy('logs') ? 'Syncing…' : '🔄 Sync Now'}
                  </button>
                  {pendingEvent('logs') && (
                    <button
                      onClick={() => cancelSync(pendingEvent('logs')!.id)}
                      title="Cancel pending sync"
                      className="text-xs font-medium text-critical hover:underline"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <button
                    onClick={() => queueSync(d.id, 'users')}
                    disabled={busy('users')}
                    title="Import any device-enrolled user with no matching employee yet"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busy('users') ? 'Syncing…' : '👥 Sync Users'}
                  </button>
                  {pendingEvent('users') && (
                    <button
                      onClick={() => cancelSync(pendingEvent('users')!.id)}
                      title="Cancel pending sync"
                      className="text-xs font-medium text-critical hover:underline"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {lastLogEvent && (
                <p className={`mt-1.5 text-xs ${lastLogEvent.status === 'failed' ? 'text-critical' : 'text-slate-400'}`}>
                  Last manual sync: {lastLogEvent.status === 'failed' ? lastLogEvent.error : lastLogEvent.summary}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="font-medium text-accent">{fetched} punches fetched</span>
                <div className="flex gap-3">
                  <button onClick={() => openEdit(d)} className="text-xs font-medium text-slate-600 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(d.id)} className="text-xs font-medium text-critical hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {devices.length === 0 && <p className="text-sm text-slate-400">No devices registered yet.</p>}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Device Bridge Credentials</h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              For a device that only reaches you over a local network, not the internet: generate a credential scoped to
              just this company, and hand its <code className="rounded bg-slate-100 px-1 py-0.5">.env</code> file to
              whoever runs the bridge on-site — no GitHub access or shared master key involved.
            </p>
          </div>
          <button
            onClick={handleGenerateBridge}
            disabled={generatingBridge}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {generatingBridge ? 'Generating…' : '+ Generate Bridge Credentials'}
          </button>
        </div>
        {bridgeError && <p className="mb-3 text-sm text-critical">{bridgeError}</p>}
        {bridgeCredentials.length === 0 ? (
          <p className="text-sm text-slate-400">No bridge credentials issued yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {bridgeCredentials.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-ink">{c.email}</div>
                  <div className="text-xs text-slate-400">Issued {new Date(c.createdAt).toLocaleString()}</div>
                </div>
                <button
                  onClick={() => handleRevokeBridge(c.id)}
                  disabled={revokingBridgeId === c.id}
                  className="shrink-0 text-xs font-medium text-critical hover:underline disabled:opacity-60"
                >
                  {revokingBridgeId === c.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {bridgeResult && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-ink">Bridge credential created</h3>
            <p className="mb-4 text-xs text-slate-500">
              This password won&apos;t be shown again. Download the <code className="rounded bg-slate-100 px-1 py-0.5">.env</code>{' '}
              below and place it alongside <code className="rounded bg-slate-100 px-1 py-0.5">index.js</code> on the
              on-site machine.
            </p>
            <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div>
                <span className="text-xs uppercase text-slate-400">Email</span>
                <div className="break-all font-mono text-xs font-medium text-ink">{bridgeResult.email}</div>
              </div>
              <div>
                <span className="text-xs uppercase text-slate-400">Password</span>
                <div className="break-all font-mono text-xs font-medium text-ink">{bridgeResult.password}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => downloadEnvFile(bridgeResult.envFile)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ⬇ Download .env
              </button>
              <button
                onClick={() => setBridgeResult(null)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleCreate} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Device</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <label className="mb-1 block text-xs font-medium text-slate-600">Branch (optional)</label>
            <select value={form.branch_id} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Unassigned</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">IP address</label>
                <input
                  value={form.ip_address}
                  onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))}
                  placeholder="192.168.1.201"
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Port</label>
                <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Serial number</label>
            <input
              required
              value={form.serial_number}
              onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))}
              placeholder="Unique per device — printed on the unit"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
                {saving ? 'Saving…' : 'Add device'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingDevice && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleEdit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Edit Device</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Branch (optional)</label>
            <select
              value={editForm.branch_id}
              onChange={e => setEditForm(f => ({ ...f, branch_id: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">IP address</label>
                <input
                  value={editForm.ip_address}
                  onChange={e => setEditForm(f => ({ ...f, ip_address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Port</label>
                <input
                  type="number"
                  value={editForm.port}
                  onChange={e => setEditForm(f => ({ ...f, port: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Serial number</label>
            <input
              required
              value={editForm.serial_number}
              onChange={e => setEditForm(f => ({ ...f, serial_number: e.target.value }))}
              placeholder="Unique per device — printed on the unit"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {editError && <p className="mb-3 text-sm text-critical">{editError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingDevice(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={savingEdit} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
