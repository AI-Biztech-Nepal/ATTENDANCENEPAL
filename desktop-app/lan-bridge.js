// Embedded version of zkteco-bridge/index.js — polls ZKTeco terminals on
// this PC's local network over TCP/IP (port 4370) and upserts punches into
// Supabase, exactly like the standalone script, but living inside this
// Electron app instead of needing its own separate always-running process.
// Runs only once configure() has been given a device-bridge credential
// (generated from the dashboard's Devices page) — until then it's inert.
//
// Kept at feature parity with zkteco-bridge/index.js (batched employee
// lookups, batched upserts, longer upsert timeout, backoff, periodic
// enrollment auto-detection) — this had drifted badly out of sync with it
// (still doing a Supabase round-trip per punch, the exact bug that made a
// device's first sync time out having uploaded nothing) since this file was
// forked into its own module shape and never revisited. Whenever index.js
// changes, port the same fix here AND to admin-web/public/lan-bridge.js (see
// desktop-app/README.md — that's the copy every already-installed app
// actually fetches and runs; this bundled copy is only its first-launch,
// no-internet-yet fallback).
//
// Same trust model as the standalone bridge: signs in as a normal Supabase
// Auth user (never the service-role master key), so everything below is
// automatically scoped to that credential's own company by Postgres RLS,
// not by trusting this code to filter correctly.
const ZKLib = require('node-zklib');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Same values admin-web's own browser code already ships with — the anon
// key is meant to be public (protected by RLS, not secrecy), same as
// SUPABASE_URL in main.js.
const SUPABASE_URL = 'https://whaahjtqmlbwrfppogsw.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoYWFoanRxbWxid3JmcHBvZ3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDk4NzEsImV4cCI6MjEwMDcyNTg3MX0.DZiANjUeVkelmk59ttdOu-6YaHCrjtEaW9sCxo3P4D4';

const SYNC_INTERVAL_MS = 15 * 1000;
const SYNC_REQUEST_POLL_MS = 15 * 1000;
const MAX_BACKOFF_MS = 2 * 60 * 1000;
// Uploading a device's whole stored history on a first sync is a lot more
// than 30s allows — the batched upsert below still has to make one
// round-trip per 500 punches.
const UPSERT_TIMEOUT_MS = 120000;
// getUsers() pulls the device's *entire* enrolled-fingerprint list (template
// data included) over the same slow ZK link as getAttendances() — doing
// that on every single automatic poll (every SYNC_INTERVAL_MS) made each
// cycle noticeably heavier for no real benefit, since enrollment doesn't
// happen anywhere near that often. The periodic poll only pulls the user
// list once per this interval; punches still sync every SYNC_INTERVAL_MS.
// On-demand syncs (the dashboard's Sync Log/Sync Users buttons) are
// one-off, not a tight loop, so they always pull both and ignore this.
const USERS_POLL_INTERVAL_MS = 2 * 60 * 1000;

let supabase = null;
let companyId = null;
let syncTimer = null;
let syncRequestTimer = null;
let running = false;
const failureCounts = new Map();
const warnedUnmappedFingerprints = new Set();
// A ZKTeco terminal generally only accepts one active TCP session at a
// time — the periodic full poll (syncAllDevices, every SYNC_INTERVAL_MS)
// and the on-demand sync-request poll (pollSyncRequests, e.g. the
// dashboard's "Sync Now" button) are two independent timers with no
// coordination between them, so without this a device could get hit by
// both at once. Whichever connection loses that race fails, and its catch
// block marks the device 'offline' even though it's perfectly reachable —
// this is the most likely cause of a device flickering to "offline" while
// actually online. This set makes the two loops take turns per device
// instead of racing into it.
const busyDeviceIds = new Set();
// Backoff was computed on every failure but never actually used to slow
// anything down — syncAllDevices() kept retrying a dead device every
// SYNC_INTERVAL_MS regardless, hammering it and making it less likely to
// ever settle. This now actually gates the periodic poll (not on-demand
// "Sync Now" requests, which always represent explicit intent and should
// still try right away).
const nextRetryAt = new Map();
// device_id -> last time the enrolled-user list was actually pulled, so
// syncDevice() can throttle getUsers() to USERS_POLL_INTERVAL_MS.
const lastUsersPullAt = new Map();

const status = {
  configured: false,
  running: false,
  companyId: null,
  lastError: null,
  lastSyncAt: null,
};

function getStatus() {
  return { ...status };
}

async function fetchActiveDevices() {
  const { data, error } = await supabase.from('devices').select('*').eq('company_id', companyId);
  if (error) throw error;
  return data;
}

// fingerprint_id -> employee id for the whole company, in ONE query. This
// used to be a query per punch — a device holds its entire history in
// memory (over a thousand records on a two-month-old unit is normal), so a
// first sync fired that many sequential round-trips and blew the timeout
// long before it reached the insert, so the sync failed having uploaded
// nothing, over and over. Re-read at the start of each sync, so a
// fingerprint_id set in the dashboard a minute ago is picked up.
async function fetchEmployeesByFingerprint() {
  const byFingerprint = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, fingerprint_id')
      .eq('company_id', companyId)
      .not('fingerprint_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const e of data) byFingerprint.set(String(e.fingerprint_id), e.id);
    if (data.length < PAGE) break;
  }
  return byFingerprint;
}

// See index.js's withDevice() for why this timeout wrapper exists — a
// hung getAttendances()/getUsers() call (no error event ever fires) leaves
// busyDeviceIds wedged forever without it, confirmed happening live.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function withDevice(device, fn, operationTimeoutMs = 120000) {
  const zk = new ZKLib(device.ip_address, device.port, 10000, 4000);
  await withTimeout(zk.createSocket(), 15000, `${device.name}: connect`);
  try {
    return await withTimeout(fn(zk), operationTimeoutMs, `${device.name}: operation`);
  } finally {
    await withTimeout(zk.disconnect(), 5000, `${device.name}: disconnect`).catch(() => {});
  }
}

async function pullDeviceLogs(device) {
  return withDevice(device, async zk => {
    const result = await zk.getAttendances();
    return result.data || [];
  });
}

async function pullDeviceUsers(device) {
  return withDevice(device, async zk => {
    const result = await zk.getUsers();
    return result.data || [];
  });
}

// One connection, both pulls — a ZKTeco terminal only tolerates one session
// at a time, so opening a second one right after the first just to fetch
// users would double how often the device gets connected to.
async function pullDeviceLogsAndUsers(device) {
  return withDevice(
    device,
    async zk => {
      const logsResult = await zk.getAttendances();
      const usersResult = await zk.getUsers();
      return { rawLogs: logsResult.data || [], rawUsers: usersResult.data || [] };
    },
    600000
  );
}

// employeeIdByFingerprint can be passed in by a caller that's about to make
// this same call for upsertUsers() too, so the whole-company fingerprint
// map is fetched once per sync instead of twice.
async function upsertLogs(device, rawLogs, employeeIdByFingerprint) {
  employeeIdByFingerprint = employeeIdByFingerprint || (await fetchEmployeesByFingerprint());
  const rows = [];
  for (const log of rawLogs) {
    const employeeId = employeeIdByFingerprint.get(String(log.deviceUserId));
    if (!employeeId) {
      const key = `${device.id}:${log.deviceUserId}`;
      if (!warnedUnmappedFingerprints.has(key)) {
        warnedUnmappedFingerprints.add(key);
        console.warn(`[lan-bridge] ${device.name}: no employee mapped to fingerprint_id ${log.deviceUserId}, skipping (won't repeat this warning)`);
      }
      continue;
    }
    rows.push({
      employee_id: employeeId,
      device_id: device.id,
      punch_time: new Date(log.recordTime).toISOString(),
      punch_type: String(log.type ?? '0'),
      method: 'zkteco',
      verification_mode: String(log.verifyMethod ?? '1'),
    });
  }
  if (rows.length === 0) return 0;

  // A first sync can carry the device's whole history; send it in batches
  // so one request never has to hold thousands of rows.
  const BATCH = 500;
  let insertedCount = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data: inserted, error } = await supabase
      .from('attendance_logs')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'employee_id,punch_time', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    insertedCount += inserted.length;
  }
  return insertedCount;
}

// A device user is only ever matched by fingerprint_id — if one already maps
// to an existing employee, that row (name, employee_code, etc, set by an
// admin) is left alone. Only device users with no matching employee yet get
// a brand-new employees row, so this is safe to run repeatedly.
async function upsertUsers(device, rawUsers, employeeIdByFingerprint) {
  employeeIdByFingerprint = employeeIdByFingerprint || (await fetchEmployeesByFingerprint());
  let added = 0;
  for (const u of rawUsers) {
    const fingerprintId = String(u.userId);
    if (employeeIdByFingerprint.has(fingerprintId)) continue;
    const { error } = await supabase.from('employees').insert({
      employee_code: `ZK-${device.id.slice(0, 8)}-${fingerprintId}`,
      name: u.name || `Device user ${fingerprintId}`,
      fingerprint_id: fingerprintId,
      status: 'active',
      company_id: companyId,
    });
    if (error) throw error;
    added++;
  }
  return { total: rawUsers.length, added };
}

// node-zklib rejects with plain objects ({ err, ip }) as often as with real
// Errors, so err.message is frequently undefined.
function describeError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.err) return describeError(err.err);
  if (err.code) return `${err.code}${err.address ? ` (${err.address}:${err.port ?? ''})` : ''}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Every write to `devices` status/last_sync went through unchecked before —
// a failed write (a network blip, an RLS surprise) vanished with no log and
// no way to tell the status column had gone stale for a reason other than
// the device itself.
async function markDeviceStatus(deviceId, fields) {
  const { error } = await supabase.from('devices').update(fields).eq('id', deviceId);
  if (error) console.error('[lan-bridge] could not update device status:', error.message);
}

async function syncDevice(device) {
  if (busyDeviceIds.has(device.id)) {
    console.log(`[lan-bridge] ${device.name}: skipping this poll, already being synced right now`);
    return;
  }
  const retryAt = nextRetryAt.get(device.id);
  if (retryAt && Date.now() < retryAt) {
    console.log(`[lan-bridge] ${device.name}: backing off after a failed sync, next attempt in ${Math.ceil((retryAt - Date.now()) / 1000)}s`);
    return;
  }

  busyDeviceIds.add(device.id);
  try {
    // Pulls the device's current enrolled-user list too, but only once per
    // USERS_POLL_INTERVAL_MS rather than every single cycle — see that
    // constant's comment. Punches (rawLogs) are still pulled every poll, so
    // a fingerprint enrolled directly on the device gets its own employees
    // row on its own within a couple of minutes, without anyone having to
    // click "Sync Users" on the dashboard.
    const dueForUsers = Date.now() - (lastUsersPullAt.get(device.id) || 0) >= USERS_POLL_INTERVAL_MS;
    const { rawLogs, rawUsers } = dueForUsers
      ? await pullDeviceLogsAndUsers(device)
      : { rawLogs: await pullDeviceLogs(device), rawUsers: null };

    const employeeIdByFingerprint = await fetchEmployeesByFingerprint();
    const count = await withTimeout(
      upsertLogs(device, rawLogs, employeeIdByFingerprint),
      UPSERT_TIMEOUT_MS,
      `${device.name}: upsertLogs`
    );
    let added = 0;
    if (rawUsers) {
      ({ added } = await withTimeout(
        upsertUsers(device, rawUsers, employeeIdByFingerprint),
        UPSERT_TIMEOUT_MS,
        `${device.name}: upsertUsers`
      ));
      lastUsersPullAt.set(device.id, Date.now());
    }
    if (count > 0) console.log(`[lan-bridge] ${device.name}: synced ${count} new punch(es)`);
    if (added > 0) console.log(`[lan-bridge] ${device.name}: added ${added} new employee(s) from device enrollment`);
    failureCounts.set(device.id, 0);
    nextRetryAt.delete(device.id);
    await markDeviceStatus(device.id, { last_sync: new Date().toISOString(), status: 'online' });
    status.lastSyncAt = new Date().toISOString();
    status.lastError = null;
  } catch (err) {
    const failures = (failureCounts.get(device.id) || 0) + 1;
    failureCounts.set(device.id, failures);
    const backoff = Math.min(MAX_BACKOFF_MS, SYNC_INTERVAL_MS * 2 ** failures);
    nextRetryAt.set(device.id, Date.now() + backoff);
    console.error(`[lan-bridge] ${device.name} sync failed (attempt ${failures}), next retry in ${Math.round(backoff / 1000)}s:`, describeError(err));
    await markDeviceStatus(device.id, { status: 'offline' });
    status.lastError = `${device.name}: ${describeError(err)}`;
  } finally {
    busyDeviceIds.delete(device.id);
  }
}

async function syncAllDevices() {
  const devices = await fetchActiveDevices();
  for (const device of devices) {
    await syncDevice(device);
  }
}

async function fetchPendingSyncEvents() {
  const { data, error } = await supabase
    .from('device_sync_events')
    .select('*, device:devices(*)')
    .eq('status', 'pending')
    .eq('company_id', companyId)
    .order('requested_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function processSyncEvent(event) {
  const device = event.device;
  // Leave it pending (don't even mark it 'running' yet) if the periodic
  // poll already has a connection open to this exact device right now —
  // it'll be picked up on the very next SYNC_REQUEST_POLL_MS tick instead
  // of racing a second TCP session into a device that can usually only
  // hold one.
  if (busyDeviceIds.has(device.id)) return;

  busyDeviceIds.add(device.id);
  await supabase.from('device_sync_events').update({ status: 'running' }).eq('id', event.id);
  try {
    let summary;
    if (event.sync_type === 'users') {
      const rawUsers = await pullDeviceUsers(device);
      const { total, added } = await withTimeout(upsertUsers(device, rawUsers), UPSERT_TIMEOUT_MS, `${device.name}: upsertUsers`);
      summary = `${total} user(s) on device, ${added} new employee(s) added`;
    } else {
      // Pulls users alongside logs here too (previously logs only) — a
      // newly-enrolled fingerprint shouldn't need a separate "Sync Users"
      // click just because someone hit "Sync Log" first.
      const { rawLogs, rawUsers } = await pullDeviceLogsAndUsers(device);
      const employeeIdByFingerprint = await fetchEmployeesByFingerprint();
      const count = await withTimeout(
        upsertLogs(device, rawLogs, employeeIdByFingerprint),
        UPSERT_TIMEOUT_MS,
        `${device.name}: upsertLogs`
      );
      const { added } = await withTimeout(
        upsertUsers(device, rawUsers, employeeIdByFingerprint),
        UPSERT_TIMEOUT_MS,
        `${device.name}: upsertUsers`
      );
      summary = `${rawLogs.length} record(s) on device, ${count} matched to an employee` + (added > 0 ? `, ${added} new employee(s) added` : '');
    }
    console.log(`[lan-bridge] ${device.name} ${event.sync_type} sync: ${summary}`);
    await supabase
      .from('device_sync_events')
      .update({ status: 'success', completed_at: new Date().toISOString(), summary })
      .eq('id', event.id);
    failureCounts.set(device.id, 0);
    nextRetryAt.delete(device.id);
    await markDeviceStatus(device.id, { last_sync: new Date().toISOString(), status: 'online' });
  } catch (err) {
    console.error(`[lan-bridge] ${device.name} ${event.sync_type} sync failed:`, describeError(err));
    await supabase
      .from('device_sync_events')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error: describeError(err) })
      .eq('id', event.id);
    const failures = (failureCounts.get(device.id) || 0) + 1;
    failureCounts.set(device.id, failures);
    nextRetryAt.set(device.id, Date.now() + Math.min(MAX_BACKOFF_MS, SYNC_INTERVAL_MS * 2 ** failures));
    await markDeviceStatus(device.id, { status: 'offline' });
  } finally {
    busyDeviceIds.delete(device.id);
  }
}

async function pollSyncRequests() {
  const events = await fetchPendingSyncEvents();
  for (const event of events) {
    await processSyncEvent(event);
  }
}

// Called once at startup (with saved credentials, if any) and again
// whenever the settings window saves a new/changed credential.
async function configure(email, password) {
  stop();
  status.configured = false;
  status.lastError = null;

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: false },
    realtime: { transport: WebSocket },
  });

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    status.lastError = `Sign-in failed: ${authError.message}`;
    throw new Error(status.lastError);
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
  if (profileError || !profile?.company_id) {
    status.lastError = 'Signed in, but this account has no company — it may not be a valid device bridge credential.';
    throw new Error(status.lastError);
  }

  companyId = profile.company_id;
  status.configured = true;
  status.companyId = companyId;
  start();
}

function start() {
  if (running || !supabase) return;
  running = true;
  status.running = true;
  console.log(`[lan-bridge] starting, polling every ${SYNC_INTERVAL_MS / 1000}s for company ${companyId}`);
  syncAllDevices().catch(err => console.error('[lan-bridge] initial sync failed:', err.message));
  syncTimer = setInterval(() => syncAllDevices().catch(err => console.error('[lan-bridge] device sync poll failed:', err.message)), SYNC_INTERVAL_MS);
  syncRequestTimer = setInterval(
    () => pollSyncRequests().catch(err => console.error('[lan-bridge] sync request poll failed:', err.message)),
    SYNC_REQUEST_POLL_MS
  );
}

function stop() {
  if (syncTimer) clearInterval(syncTimer);
  if (syncRequestTimer) clearInterval(syncRequestTimer);
  syncTimer = null;
  syncRequestTimer = null;
  running = false;
  status.running = false;
}

module.exports = { configure, start, stop, getStatus };
