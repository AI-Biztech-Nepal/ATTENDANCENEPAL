// ZKTeco PUSH/ADMS receiver — multi-tenant, meant to run as ONE centrally
// hosted service for every company, not per-company like index.js. Here the
// device is the client: it's configured (in its own on-device Cloud Server /
// ADMS settings) to POST its data to this server over plain HTTP, so no
// process needs LAN access into any company's network and no laptop needs
// to stay on — the device just needs its own internet connection.
//
// Every request carries the device's serial number as the SN query param.
// That's the only way this server knows which company a push belongs to —
// it looks SN up against the `devices` table itself (service-role key,
// bypasses RLS) rather than trusting a single hardcoded COMPANY_ID the way
// the old single-tenant version of this file did. A device whose serial
// number isn't registered on the admin Devices page yet is refused (its
// data is dropped, not guessed at); a device already registered under
// company A can never have its punches attributed to company B, since the
// device_id/company_id pairing comes from that same devices-table lookup.
//
// The protocol itself is plain text, not JSON: tab-separated fields, records
// separated by \r\n. ATTLOG (attendance punches) and OPERLOG (user
// enrollment) are both parsed — see handleAttlog()/handleOperlog() below.
// BIODATA is still logged raw instead of guessed at (a different table name
// some device/firmware combos use instead of/alongside OPERLOG) — inspect a
// real payload from a live device before writing a parser for it.
require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// This server never uses Supabase Realtime (no .channel() subscriptions,
// just plain REST calls) — but createClient() eagerly constructs a
// RealtimeClient regardless, which throws on Node <22 without a native
// WebSocket global. Passing `ws` explicitly avoids that crash without
// requiring a Node upgrade.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket },
});

const PORT = Number(process.env.PUSH_PORT || 8088);
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60 * 1000);
// No active poll can fail here the way index.js's TCP connect can — a
// device just stops pushing. Staleness is the only signal, so anything that
// hasn't pushed within this window gets swept to 'offline'.
const OFFLINE_AFTER_MS = Number(process.env.OFFLINE_AFTER_MS || 5 * 60 * 1000);

// serial_number -> { deviceId, companyId, name }, refreshed periodically so
// a device registered (or re-keyed to a new serial) on the admin Devices
// page is picked up without restarting this process.
let deviceBySerial = new Map();
async function refreshDevices() {
  const { data, error } = await supabase.from('devices').select('id, company_id, name, serial_number');
  if (error) {
    console.error('[push] refreshing device list failed:', error.message);
    return;
  }
  deviceBySerial = new Map(
    data.filter(d => d.serial_number).map(d => [d.serial_number, { deviceId: d.id, companyId: d.company_id, name: d.name }])
  );
}

// company_id -> (fingerprint_id -> employee_id). Scoped per company, never
// a single flat map — fingerprint IDs are small sequential integers that
// are very likely to collide across two different companies' devices.
let employeesByCompany = new Map();
async function refreshEmployees() {
  const { data, error } = await supabase.from('employees').select('id, fingerprint_id, company_id');
  if (error) {
    console.error('[push] refreshing employee cache failed:', error.message);
    return;
  }
  const next = new Map();
  for (const e of data) {
    if (!e.fingerprint_id) continue;
    let byFingerprint = next.get(e.company_id);
    if (!byFingerprint) {
      byFingerprint = new Map();
      next.set(e.company_id, byFingerprint);
    }
    byFingerprint.set(e.fingerprint_id, e.id);
  }
  employeesByCompany = next;
}

function cacheEmployeeId(companyId, fingerprintId, employeeId) {
  let byFingerprint = employeesByCompany.get(companyId);
  if (!byFingerprint) {
    byFingerprint = new Map();
    employeesByCompany.set(companyId, byFingerprint);
  }
  byFingerprint.set(fingerprintId, employeeId);
}

// A fingerprint enrolled directly on the device (never entered in the admin
// UI first) has no employees row yet — rather than dropping its punches
// forever, auto-create a placeholder ("Device User <id>") the first time one
// shows up, same naming scheme index.js's old upsertUsers() used for its
// LAN-pull "Sync Users" flow. The admin renames it later via the normal Edit
// flow; that rename automatically pushes the corrected name back down to
// every device (see queue_device_userinfo_sync in the device_command_queue
// migration) — so a device-enrolled person just needs one punch to appear,
// then a rename, and both the cloud record and the device's own display end
// up correct.
async function getOrCreateEmployeeId(companyId, deviceId, fingerprintId) {
  const existing = employeesByCompany.get(companyId)?.get(fingerprintId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('employees')
    .insert({
      employee_code: `ZK-${deviceId.slice(0, 8)}-${fingerprintId}`,
      name: `Device User ${fingerprintId}`,
      fingerprint_id: fingerprintId,
      status: 'active',
      company_id: companyId,
    })
    .select('id')
    .single();

  if (error) {
    // Unique violation on (company_id, fingerprint_id) means a request
    // processed a moment ago already created this exact employee (e.g. two
    // lines for the same brand-new fingerprint in one ATTLOG batch) — look
    // it up instead of dropping this punch. Anything else is a real failure.
    const { data: found } = await supabase
      .from('employees')
      .select('id')
      .eq('company_id', companyId)
      .eq('fingerprint_id', fingerprintId)
      .maybeSingle();
    if (found) {
      cacheEmployeeId(companyId, fingerprintId, found.id);
      return found.id;
    }
    console.error(`[push] auto-creating employee for fingerprint ${fingerprintId} failed:`, error.message);
    return null;
  }

  cacheEmployeeId(companyId, fingerprintId, data.id);
  console.log(`[push] auto-created "Device User ${fingerprintId}" (company ${companyId}) for a previously unknown fingerprint — rename it on the Employee Directory`);
  return data.id;
}

async function sweepOfflineDevices() {
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();
  const { error } = await supabase.from('devices').update({ status: 'offline' }).eq('status', 'online').lt('last_sync', cutoff);
  if (error) console.error('[push] offline sweep failed:', error.message);
}

// Defensive counterpart to sweepOfflineDevices(): something outside this
// process has been observed re-marking a device 'offline' within seconds of
// markOnline() setting it 'online' (last_sync stays fresh, only status
// reverts) — a source never pinned down despite checking every known
// process/trigger/cron. Running this every REASSERT_INTERVAL_MS, well under
// that observed ~10-15s window, wins the race and keeps the displayed status
// honest regardless of what the other writer turns out to be. Actual
// attendance data was never affected by this — only the online/offline badge.
const REASSERT_INTERVAL_MS = Number(process.env.REASSERT_INTERVAL_MS || 10 * 1000);
async function reassertOnlineForRecentDevices() {
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();
  const { error } = await supabase.from('devices').update({ status: 'online' }).eq('status', 'offline').gte('last_sync', cutoff);
  if (error) console.error('[push] reassert-online failed:', error.message);
}

refreshDevices();
refreshEmployees();
setInterval(refreshDevices, REFRESH_INTERVAL_MS);
setInterval(refreshEmployees, REFRESH_INTERVAL_MS);
setInterval(sweepOfflineDevices, 60 * 1000);
setInterval(reassertOnlineForRecentDevices, REASSERT_INTERVAL_MS);

// Warn once per unknown device serial instead of spamming the log every
// single push from the same unregistered device.
const warnedUnknownSerial = new Set();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// These K40 units run their internal clock exactly 2h15m ahead of real time
// — confirmed by comparing server receipt time against reported punch time
// (matches China Standard Time, UTC+8, vs Nepal, UTC+5:45 — very likely a
// factory-hardcoded home-region default in the firmware that only manifests
// once a device gets real internet access). No exposed setting on the
// device corrects this, so we compensate for each known-bad unit's clock
// here instead of at the device itself. A different device with correct
// time reporting would NOT get this adjustment — keyed by serial number,
// not applied globally.
//
// GED7261303176 (Crossfire Attendance Machine / Soulful Motor) and
// MFP3261000484 (Ashadeep Nepal / Ashadeep Foundation) added the same way —
// each one's first live punches landed with punch_time ~2h15m AFTER their
// own created_at (receipt time), impossible for a real punch, same exact
// signature and magnitude as A6F5211860719 above. Three-for-three now, so
// this is a firmware default on this whole hardware batch/vendor, not a
// one-off unit — expect to keep adding new serials here as more come online.
const CLOCK_OFFSET_MINUTES_BY_SERIAL = {
  A6F5211860719: -135,
  GED7261303176: -135,
  MFP3261000484: -135,
  // K40 (Tranquality Spa): its 2026-09-29 punch landed with punch_time exactly
  // 2h15m after created_at — same firmware skew as the units above.
  BKIH240105032: -135,
};

// How far a raw timestamp's apparent skew is allowed to drift from the
// expected ~135 minutes before we stop trusting "yes, this one needs the
// correction" — real network/processing delay between a punch and this
// server receiving it is seconds, not minutes, so this tolerance exists
// only to absorb minor clock jitter, not to paper over genuine uncertainty.
const CLOCK_SKEW_TOLERANCE_MINUTES = 15;

// The blanket "always subtract 135 minutes" version of this function
// (this device's fix from earlier) turned out to be unsafe once the
// separate Date-header display fix started intermittently correcting the
// device's own internal clock too, not just its on-screen display — some
// punches now arrive with an ALREADY-correct raw timestamp, and blindly
// subtracting 135 minutes from one of those shoves it 2h15m into the wrong
// past, which is exactly what made a later punch sort before an earlier
// one in the report. Confirmed via a direct data check: one live punch had
// created_at (real receipt time) 135 minutes AFTER its stored punch_time,
// the opposite direction from every other correctly-adjusted row.
//
// Fix: only apply the known offset when the raw timestamp actually looks
// skewed the way this device is known to sometimes be — i.e. close to 135
// minutes ahead of the server's own current clock (which is real, since
// this server's own time isn't in question). A raw timestamp that's
// already close to "now" is trusted as-is instead.
function correctDeviceTimestamp(serialNumber, rawTimestamp) {
  const raw = new Date(rawTimestamp.replace(' ', 'T'));
  const offsetMinutes = CLOCK_OFFSET_MINUTES_BY_SERIAL[serialNumber];
  if (offsetMinutes === undefined) return raw;

  const expectedSkewMinutes = -offsetMinutes; // e.g. 135, for a -135 correction
  const actualSkewMinutes = (raw.getTime() - Date.now()) / 60000;
  const looksSkewed = Math.abs(actualSkewMinutes - expectedSkewMinutes) <= CLOCK_SKEW_TOLERANCE_MINUTES;
  return looksSkewed ? new Date(raw.getTime() + offsetMinutes * 60000) : raw;
}

// This device reads the HTTP `Date` response header off its cloud-server
// requests and sets its own on-screen clock from it (applying its own
// fixed/unchangeable +8h-ish internal offset on top) — which is exactly why
// its display runs 2h15m ahead of real time once it starts talking to a
// cloud server at all. We can't change the device's internal offset, but we
// CAN pre-cancel it: send a `Date` header that is already offsetMinutes
// early, so after the device applies its own bad offset the displayed time
// lands on the real one. This only works when reached directly on this port —
// nginx's proxy in front of port 80 unconditionally regenerates a fresh,
// genuine `Date` header on every response and can't be made to pass a
// custom one through, which is why this device's Cloud Server port must
// point at this server directly (8088), not through the nginx proxy.
function spoofedDateHeader(serialNumber) {
  const offsetMinutes = CLOCK_OFFSET_MINUTES_BY_SERIAL[serialNumber];
  if (offsetMinutes === undefined) return null;
  return new Date(Date.now() + offsetMinutes * 60000).toUTCString();
}

// ATTLOG line format (from the device vendor's own protocol doc):
// UserID <tab> Timestamp <tab> State <tab> VerifyType <tab> ...
// State: 0=check-in, 1=check-out, 2=break-start ("break-out" in vendor
// terms), 3=break-end ("break-in") — matches attendance_logs.punch_type
// exactly, so no translation needed beyond defaulting an unrecognized state
// to check-in (today's existing safe fallback, unchanged).
const KNOWN_PUNCH_STATES = new Set(['0', '1', '2', '3']);
async function handleAttlog(companyId, deviceId, serialNumber, body) {
  const lines = body.split(/\r\n|\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const fields = line.split('\t');
    const [userId, timestamp, state, verifyType] = fields;
    if (!userId || !timestamp) continue;

    const employeeId = await getOrCreateEmployeeId(companyId, deviceId, String(userId));
    if (!employeeId) continue;

    rows.push({
      employee_id: employeeId,
      device_id: deviceId,
      punch_time: correctDeviceTimestamp(serialNumber, timestamp).toISOString(),
      punch_type: KNOWN_PUNCH_STATES.has(state) ? state : '0',
      method: 'zkteco',
      verification_mode: verifyType ?? '1',
    });
  }
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('attendance_logs')
    .upsert(rows, { onConflict: 'employee_id,punch_time', ignoreDuplicates: true })
    .select();
  if (error) {
    console.error('[push] attendance_logs upsert failed:', error.message);
    return 0;
  }
  return rows.length;
}

// OPERLOG carries mixed line types (tab-separated, one event per line):
// `OPLOG <opcode> ...` bookkeeping entries (add/delete user, etc — not
// parsed, no PIN-to-name mapping in them anyway) and, for each enrolled
// finger, a self-labeled `FP PIN=<id> FID=<finger-index> Size=<n> Valid=<n>
// TMP=<base64 template>` line. That PIN is the exact same numeric ID ATTLOG
// calls deviceUserId elsewhere in this file — captured from a real device
// payload (see the comment above CLOCK_OFFSET_MINUTES_BY_SERIAL's siblings
// for the same "inspect a real payload first" policy). Reusing
// getOrCreateEmployeeId() here means a person enrolled directly on the
// device gets an employees row the moment they're enrolled, instead of
// only on their first punch — previously the only trigger, which is why
// enrolled-but-never-punched users silently never showed up in the app.
async function handleOperlog(companyId, deviceId, body) {
  const lines = body.split(/\r\n|\n/).map(l => l.trim()).filter(Boolean);
  let created = 0;
  for (const line of lines) {
    const match = line.match(/^FP\s+PIN=(\d+)/);
    if (!match) continue;
    const fingerprintId = match[1];
    if (employeesByCompany.get(companyId)?.has(fingerprintId)) continue;
    const employeeId = await getOrCreateEmployeeId(companyId, deviceId, fingerprintId);
    if (employeeId) created++;
  }
  return created;
}

function logRawPayload(table, sn, body) {
  console.log(`[push] device ${sn} sent table=${table} (${body.length} bytes) — logging raw, no parser yet:`);
  console.log(body.slice(0, 2000));
}

async function markOnline(deviceId) {
  const { error } = await supabase.from('devices').update({ status: 'online', last_sync: new Date().toISOString() }).eq('id', deviceId);
  if (error) console.error('[push] marking device online failed:', error.message);
}

// A device's periodic GET /iclock/getrequest poll is the ONLY way to reach
// it — there's no way to push a command outside that window. Queued rows
// come from queue_device_userinfo_sync() (a trigger on employees, see the
// device_command_queue migration): a name/fingerprint_id change there queues
// one row per device for that employee's company. Serves up to 10 at once,
// each as its own `C:<cmd_seq>:<command>` line (the format this protocol's
// command channel uses), and marks them 'sent' immediately — a device that
// never ACKs (see ackPendingCommands) just leaves that row stuck at 'sent'
// forever rather than retried, since we have no reliable way to tell "device
// ignored it" apart from "device hasn't polled again yet".
async function deliverPendingCommands(deviceId, res) {
  const { data: pending, error } = await supabase
    .from('device_command_queue')
    .select('id, cmd_seq, command')
    .eq('device_id', deviceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) {
    console.error('[push] fetching pending commands failed:', error.message);
    return 0;
  }
  if (!pending || pending.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('device_command_queue')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .in(
      'id',
      pending.map(p => p.id)
    );
  if (updateError) console.error('[push] marking commands sent failed:', updateError.message);

  const body = pending.map(p => `C:${p.cmd_seq}:${p.command}`).join('\r\n') + '\r\n';
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(body);
  return pending.length;
}

// The device ACKs each command it received on its next POST /iclock/devicecmd,
// one `ID=<cmd_seq>&Return=<code>&CMD=<name>` line per command — Return=0
// means it applied the command, anything else means it rejected it (bad
// field, unsupported command, etc). cmd_seq is the same short sequential
// token deliverPendingCommands() embedded, not the device_command_queue uuid.
async function ackPendingCommands(body) {
  const lines = body.split(/\r\n|\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const params = new URLSearchParams(line);
    const cmdSeq = params.get('ID');
    if (!cmdSeq) continue;
    const { error } = await supabase
      .from('device_command_queue')
      .update({
        status: params.get('Return') === '0' ? 'success' : 'failed',
        acked_at: new Date().toISOString(),
        response: line,
      })
      .eq('cmd_seq', cmdSeq);
    if (error) console.error('[push] recording command ack failed:', error.message);
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const sn = url.searchParams.get('SN');
  const device = sn ? deviceBySerial.get(sn) : undefined;

  const dateOverride = sn ? spoofedDateHeader(sn) : null;
  if (dateOverride) {
    res.sendDate = false;
    res.setHeader('Date', dateOverride);
  }

  // Always answer 200/OK even for an unrecognized device — returning an
  // error here just makes the device retry-storm the exact same rejected
  // request. Its data is simply dropped until its serial number is
  // registered on the admin Devices page (refreshDevices() picks up a new
  // registration within REFRESH_INTERVAL_MS, no restart needed).
  if (!device) {
    if (sn && !warnedUnknownSerial.has(sn)) {
      warnedUnknownSerial.add(sn);
      console.warn(`[push] unknown device serial "${sn}" — register it (with this exact serial number) on the admin Devices page first`);
    }
    res.writeHead(sn ? 200 : 400, { 'Content-Type': 'text/plain' });
    res.end(sn ? 'OK' : 'Missing SN');
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/iclock/cdata') {
      console.log(`[push] device ${device.name} (${sn}) initializing:`, url.search);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(
        [
          `GET OPTION FROM: ${sn}`,
          'Stamp=9999',
          'OpStamp=9999',
          'ErrorDelay=30',
          'Delay=30',
          'TransTimes=00:00;23:59',
          'TransInterval=1',
          'TransFlag=1111000000',
          'Realtime=1',
          'Encrypt=0',
          '',
        ].join('\r\n')
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/iclock/cdata') {
      const table = url.searchParams.get('table') ?? '';
      const body = await readBody(req);
      if (table === 'ATTLOG') {
        const count = await handleAttlog(device.companyId, device.deviceId, sn, body);
        console.log(`[push] ${device.name}: ${count} punch(es) upserted`);
      } else if (table === 'OPERLOG') {
        const created = await handleOperlog(device.companyId, device.deviceId, body);
        if (created > 0) console.log(`[push] ${device.name}: ${created} new employee(s) auto-created from device enrollment`);
      } else {
        logRawPayload(table, sn, body);
      }
      await markOnline(device.deviceId);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/iclock/getrequest') {
      const count = await deliverPendingCommands(device.deviceId, res);
      if (count === 0) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/iclock/devicecmd') {
      const body = await readBody(req);
      console.log(`[push] ${device.name} command ack:`, body);
      await ackPendingCommands(body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    res.writeHead(404);
    res.end();
  } catch (err) {
    console.error('[push] request handling failed:', err.message);
    res.writeHead(500);
    res.end();
  }
});

process.on('unhandledRejection', err => {
  console.error('[push] unhandled rejection (ignored, server keeps running):', err);
});

// Two instances of this process both handling the same devices (e.g. a
// deploy that started a new one before the old one fully exited) would
// independently run markOnline/sweepOfflineDevices/reassertOnlineForRecentDevices
// against the same rows — a plausible source of the still-unexplained status
// flapping documented above reassertOnlineForRecentDevices(). A second
// instance can't actually bind the same PORT (Node throws EADDRINUSE), so
// this can't happen silently, but without a listener that failure is an
// opaque uncaught exception — this makes it a clear, loggable signal instead
// of a confusing crash/restart loop under pm2.
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[push] port ${PORT} is already in use — is another copy of this server already running? Refusing to start a second instance.`);
  } else {
    console.error('[push] server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`ZKTeco PUSH/ADMS receiver (multi-tenant) listening on 0.0.0.0:${PORT}`);
});
