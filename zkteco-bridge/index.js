// Standalone worker: polls registered ZKTeco K40 terminals over TCP/IP (port 4370) and
// upserts raw punches into Supabase's attendance_logs table.
//
// Deploy this on-prem or on a small VM with LAN access to the devices — it needs a raw
// socket connection that a hosted Supabase Edge Function cannot provide. The mobile app and
// admin console never talk to devices directly; everything flows through attendance_logs.
//
// This is the version meant to be handed to an outside customer's own machine, so unlike
// push-server.js (which runs on infrastructure we control and can safely hold the
// service-role master key) it never sees that key at all — it signs in as a normal
// Supabase Auth user instead (a "device bridge" account, generated from the dashboard's
// Devices page, scoped to exactly one company). Every query below then goes through the
// SAME RLS policies (is_admin() and company_id = my_company_id()) a human admin's own
// dashboard session already goes through, enforced by Postgres itself — a stolen/leaked
// .env from one customer's machine can only ever touch that one customer's data, never
// another company's, which a shared master key could not promise.
require('dotenv').config();
// Node 16 (the build that still runs on Windows 8.1) has no global fetch /
// Headers — @supabase/supabase-js reaches for both and dies with
// "Headers is not defined" the moment createClient() runs. Node 18+ has them
// natively, where this is a no-op. Kept here rather than in the build so the
// same index.js runs on either.
if (typeof globalThis.fetch === 'undefined' || typeof globalThis.Headers === 'undefined') {
  const nodeFetch = require('node-fetch');
  globalThis.fetch = nodeFetch;
  globalThis.Headers = nodeFetch.Headers;
  globalThis.Request = nodeFetch.Request;
  globalThis.Response = nodeFetch.Response;
}
const ZKLib = require('node-zklib');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 15 * 1000);
const SYNC_REQUEST_POLL_MS = Number(process.env.SYNC_REQUEST_POLL_MS || 15000);
const MAX_BACKOFF_MS = 10 * 60 * 1000;
// Uploading a device's whole stored history on a first sync is a lot more
// than the 30s this used to allow — the batched upsert below still has to
// make one round-trip per 500 punches.
const UPSERT_TIMEOUT_MS = Number(process.env.UPSERT_TIMEOUT_MS || 120000);

// Set by sync.bat (or any .env) when the device's real LAN address differs
// from the one registered on the dashboard's Devices page — a device that
// got a new DHCP lease, or was registered with a typo. The dashboard row is
// still what identifies the device (id, serial, company); only the address
// this process dials is overridden, and nothing is written back, so the
// dashboard stays the single place that owns the record.
const DEVICE_IP_OVERRIDE = (process.env.DEVICE_IP || '').trim();
const DEVICE_PORT_OVERRIDE = Number(process.env.DEVICE_PORT || 0) || null;
// One connect-sync-exit run instead of staying resident — what the
// click-to-sync batch file uses, so the window reports what happened and
// closes on its own rather than living forever in the taskbar.
const SYNC_ONCE = /^(1|true|yes)$/i.test(process.env.SYNC_ONCE || '');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BRIDGE_EMAIL = process.env.BRIDGE_EMAIL;
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BRIDGE_EMAIL || !BRIDGE_PASSWORD) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_ANON_KEY, BRIDGE_EMAIL, and BRIDGE_PASSWORD are all required in .env — ' +
      'generate a ready-made .env for this from the dashboard\'s Devices page ("Generate Bridge Credentials") ' +
      'rather than typing these by hand.'
  );
}

// Same Node<22 WebSocket workaround as push-server.js — see its comment.
// autoRefreshToken keeps the sign-in above alive indefinitely as long as this
// process keeps running; persistSession is off since there's no browser
// storage to persist to here.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: false },
  realtime: { transport: WebSocket },
});

// Tracks consecutive failures per device_id for exponential backoff.
const failureCounts = new Map();
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

// Devices keep old attendance records in their log memory even after the
// user is deleted from the device's user list, so getAttendances() keeps
// returning the same orphaned punches on every single poll forever. Warn
// once per (device, fingerprint) instead of re-warning every 15s for
// records that were never going to map to an employee.
const warnedUnmappedFingerprints = new Set();

// One bridge deployment = one company's LAN = one company_id, but unlike the
// old service-role version, that's no longer trusted from a hand-typed env
// var — it's read back from the signed-in bridge account's OWN profile
// (set once when the dashboard generated this credential), so a .env with a
// mistyped/mismatched company id simply can't happen. Every query below
// still filters by it explicitly (defense in depth on top of RLS, not a
// replacement for it) and is set by signIn() before main()'s loops start.
let COMPANY_ID;

async function signIn() {
  const { error: authError } = await supabase.auth.signInWithPassword({ email: BRIDGE_EMAIL, password: BRIDGE_PASSWORD });
  if (authError) {
    throw new Error(
      `Could not sign in with the configured bridge credentials: ${authError.message}. If this credential was ` +
        'revoked or regenerated, generate a fresh .env from the dashboard\'s Devices page.'
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
  if (profileError || !profile?.company_id) {
    throw new Error('Signed in, but this account has no company_id set on its profile — it may not be a valid device bridge credential.');
  }
  COMPANY_ID = profile.company_id;
  console.log(`Signed in as device bridge account for company ${COMPANY_ID}.`);
}

async function fetchActiveDevices() {
  const { data, error } = await supabase.from('devices').select('*').eq('company_id', COMPANY_ID);
  if (error) throw error;
  if (!DEVICE_IP_OVERRIDE && !DEVICE_PORT_OVERRIDE) return data;
  return (data || []).map(d => ({
    ...d,
    ip_address: DEVICE_IP_OVERRIDE || d.ip_address,
    port: DEVICE_PORT_OVERRIDE || d.port,
  }));
}

// fingerprint_id -> employee id for the whole company, in ONE query.
//
// This used to be a query per punch. A device holds its entire history in
// memory (1,180 records on a two-month-old unit is normal), so a first sync
// fired 1,180 sequential round-trips and blew the 30s upsertLogs timeout
// long before it reached the insert -- the sync then failed having uploaded
// nothing, over and over. Re-read at the start of each upsertLogs() run, so
// a fingerprint_id set in the dashboard a minute ago is picked up.
async function fetchEmployeesByFingerprint() {
  const byFingerprint = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, fingerprint_id')
      .eq('company_id', COMPANY_ID)
      .not('fingerprint_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const e of data) byFingerprint.set(String(e.fingerprint_id), e.id);
    if (data.length < PAGE) break;
  }
  return byFingerprint;
}

// node-zklib's own 10s constructor timeout only covers createSocket() — a
// getAttendances()/getUsers() call that hangs partway through a data pull
// (device closes the connection uncleanly mid-transfer, no error event ever
// fires) can leave its promise never settling. That's fatal here specifically
// because syncDevice() holds a device in busyDeviceIds for the *entire*
// duration of this call — a promise that never settles means that lock is
// never released, silently wedging that device's sync forever (every future
// poll just logs "already being synced" and returns) until the process is
// manually restarted. Confirmed happening live, twice, in the same session.
// Wrapping every step in an explicit outer timeout guarantees withDevice()
// always resolves or rejects within a bounded window regardless of what
// node-zklib does internally, so the busyDeviceIds lock can never wedge.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function withDevice(device, fn) {
  const zk = new ZKLib(device.ip_address, device.port, 10000, 4000);
  await withTimeout(zk.createSocket(), 15000, `${device.name}: connect`);
  try {
    return await withTimeout(fn(zk), 30000, `${device.name}: operation`);
  } finally {
    // Best-effort and separately capped — a hung disconnect must never block
    // releasing the busyDeviceIds lock either. Its own failure is swallowed;
    // the socket gets cleaned up by the OS/device on its own either way.
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

async function upsertLogs(device, rawLogs) {
  const employeeIdByFingerprint = await fetchEmployeesByFingerprint();
  const rows = [];
  for (const log of rawLogs) {
    const employeeId = employeeIdByFingerprint.get(String(log.deviceUserId));
    if (!employeeId) {
      const key = `${device.id}:${log.deviceUserId}`;
      if (!warnedUnmappedFingerprints.has(key)) {
        warnedUnmappedFingerprints.add(key);
        console.warn(`[${device.name}] no employee mapped to fingerprint_id ${log.deviceUserId}, skipping (will not repeat this warning)`);
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

  // Composite unique key (employee_id, punch_time) makes this idempotent regardless of
  // how many times a device is polled or a sync is retried after a network blip. .select()
  // makes the response only contain rows actually inserted (ignoreDuplicates -> ON CONFLICT
  // DO NOTHING, which returns nothing for a skipped conflict) — devices keep their entire
  // punch history in memory, so without this every poll would report its whole log size,
  // not just what's new since last time.
  // A first sync can carry the device's whole history; send it in batches so
  // one request never has to hold thousands of rows.
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
async function upsertUsers(device, rawUsers) {
  const employeeIdByFingerprint = await fetchEmployeesByFingerprint();
  let added = 0;
  for (const u of rawUsers) {
    const fingerprintId = String(u.userId);
    if (employeeIdByFingerprint.has(fingerprintId)) continue;
    const { error } = await supabase.from('employees').insert({
      employee_code: `ZK-${device.id.slice(0, 8)}-${fingerprintId}`,
      name: u.name || `Device user ${fingerprintId}`,
      fingerprint_id: fingerprintId,
      status: 'active',
      company_id: COMPANY_ID,
    });
    if (error) throw error;
    added++;
  }
  return { total: rawUsers.length, added };
}

// Every write to `devices` status/last_sync went through unchecked before —
// a failed write (a network blip, an RLS surprise) vanished with no log and
// no way to tell the status column had gone stale for a reason other than
// the device itself.
// node-zklib rejects with plain objects ({ err, ip }) as often as with real
// Errors, so err.message is frequently undefined — which is why a failed
// sync reached the dashboard with no reason attached at all. Always produce
// something a human can act on.
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

async function markDeviceStatus(deviceId, fields) {
  const { error } = await supabase.from('devices').update(fields).eq('id', deviceId);
  if (error) console.error('could not update device status:', error.message);
}

async function syncDevice(device) {
  if (busyDeviceIds.has(device.id)) {
    console.log(`[${device.name}] skipping this poll, already being synced right now`);
    return;
  }
  const retryAt = nextRetryAt.get(device.id);
  if (retryAt && Date.now() < retryAt) return;

  busyDeviceIds.add(device.id);
  try {
    const rawLogs = await pullDeviceLogs(device);
    // upsertLogs() makes its own per-row Supabase calls (fetchEmployeeByFingerprint
    // for each punch, then the upsert itself) with no timeout of their own — a
    // stalled connection here (this machine's network has been observed dropping
    // out for stretches) would wedge busyDeviceIds exactly like the unbounded ZK
    // call did before withDevice() got its own timeout. Same fix, same reason.
    const count = await withTimeout(upsertLogs(device, rawLogs), UPSERT_TIMEOUT_MS, `${device.name}: upsertLogs`);
    if (count > 0) console.log(`[${device.name}] synced ${count} new punch(es)`);
    failureCounts.set(device.id, 0);
    nextRetryAt.delete(device.id);
    await markDeviceStatus(device.id, { last_sync: new Date().toISOString(), status: 'online' });
  } catch (err) {
    const failures = (failureCounts.get(device.id) || 0) + 1;
    failureCounts.set(device.id, failures);
    const backoff = Math.min(MAX_BACKOFF_MS, SYNC_INTERVAL_MS * 2 ** failures);
    nextRetryAt.set(device.id, Date.now() + backoff);
    console.error(`[${device.name}] sync failed (attempt ${failures}), next retry in ${Math.round(backoff / 1000)}s:`, describeError(err));
    await markDeviceStatus(device.id, { status: 'offline' });
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

// On-demand "Sync Users"/"Sync Log" buttons on the admin Devices page just
// insert a pending row here (the web app can never reach a LAN device
// directly) — this is the other half, run wherever this worker has network
// access to the device itself.
async function fetchPendingSyncEvents() {
  const { data, error } = await supabase
    .from('device_sync_events')
    .select('*, device:devices(*)')
    .eq('status', 'pending')
    .eq('company_id', COMPANY_ID)
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
      const rawLogs = await pullDeviceLogs(device);
      const count = await withTimeout(upsertLogs(device, rawLogs), UPSERT_TIMEOUT_MS, `${device.name}: upsertLogs`);
      summary = `${rawLogs.length} record(s) on device, ${count} matched to an employee`;
    }
    console.log(`[${device.name}] ${event.sync_type} sync: ${summary}`);
    await supabase
      .from('device_sync_events')
      .update({ status: 'success', completed_at: new Date().toISOString(), summary })
      .eq('id', event.id);
    failureCounts.set(device.id, 0);
    nextRetryAt.delete(device.id);
    await markDeviceStatus(device.id, { last_sync: new Date().toISOString(), status: 'online' });
  } catch (err) {
    console.error(`[${device.name}] ${event.sync_type} sync failed:`, describeError(err));
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

async function main() {
  if (SYNC_ONCE) {
    console.log('ZKTeco bridge: one-off sync' + (DEVICE_IP_OVERRIDE ? ` against ${DEVICE_IP_OVERRIDE}` : ''));
    await signIn();
    const devices = await fetchActiveDevices();
    if (devices.length === 0) {
      console.log('No devices registered for this company on the Devices page — nothing to sync.');
      return;
    }
    let failed = 0;
    for (const device of devices) {
      console.log(`[${device.name}] connecting to ${device.ip_address}:${device.port} ...`);
      try {
        const rawLogs = await pullDeviceLogs(device);
        const count = await withTimeout(upsertLogs(device, rawLogs), UPSERT_TIMEOUT_MS, `${device.name}: upsertLogs`);
        console.log(`[${device.name}] ${rawLogs.length} record(s) on the device, ${count} new punch(es) uploaded.`);
        await markDeviceStatus(device.id, { last_sync: new Date().toISOString(), status: 'online' });
      } catch (err) {
        failed += 1;
        console.error(`[${device.name}] FAILED: ${describeError(err)}`);
        await markDeviceStatus(device.id, { status: 'offline' });
      }
    }
    process.exitCode = failed > 0 ? 1 : 0;
    return;
  }
  console.log(`ZKTeco bridge starting, polling every ${SYNC_INTERVAL_MS / 1000}s (sync requests every ${SYNC_REQUEST_POLL_MS / 1000}s)`);
  if (DEVICE_IP_OVERRIDE || DEVICE_PORT_OVERRIDE) {
    console.log(`Device address overridden by DEVICE_IP/DEVICE_PORT: ${DEVICE_IP_OVERRIDE || '(dashboard)'}:${DEVICE_PORT_OVERRIDE || '(dashboard)'}`);
  }
  await signIn();
  await syncAllDevices();
  setInterval(() => syncAllDevices().catch(err => console.error('Device sync poll failed:', err.message)), SYNC_INTERVAL_MS);
  setInterval(() => pollSyncRequests().catch(err => console.error('Sync request poll failed:', err.message)), SYNC_REQUEST_POLL_MS);
}

// A transient network blip (Supabase unreachable for a moment, etc.) should
// never take the whole worker down — every known interval already has its
// own .catch(), this is the safety net for anything that doesn't.
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection (ignored, worker keeps running):', err);
});

main().catch(err => {
  console.error('Fatal error in ZKTeco bridge:', err);
  process.exit(1);
});
