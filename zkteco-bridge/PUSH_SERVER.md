# Push Server — centrally-hosted, multi-tenant ZKTeco receiver

`push-server.js` is the alternative to `index.js`. Instead of one bridge
process per company polling into that company's LAN, this is **one process
for all companies** — every registered device pushes its own punches out to
this server directly, over a normal internet connection. No laptop or PC
needs to stay on at any company's office; the ZKTeco terminal just needs a
network connection.

## How it decides which company a push belongs to

Every request from a device carries its serial number as `?SN=...`. This
server looks that serial number up against the `devices` table (via the
Supabase service-role key, bypassing RLS) to resolve a `device_id` and
`company_id`. A device whose serial number isn't registered in `devices` is
refused — its data is dropped, not guessed at — so **a device must be
registered on the admin Devices page, with its correct serial number, before
it can push data here**. That lookup is cached and refreshed every
`REFRESH_INTERVAL_MS` (default 60s), so a newly-registered device is picked
up without restarting this process.

## What it does and doesn't handle

- **Attendance punches (`ATTLOG`)**: fully handled — parsed and upserted
  into `attendance_logs`, same idempotent `(employee_id, punch_time)` upsert
  as `index.js` uses, so it's safe to run both this and a company's old
  `index.js` bridge at the same time during migration.
- **New employee enrollment (`OPERLOG`)**: handled — each `FP PIN=<id> ...`
  line (one per enrolled finger) auto-creates an `employees` row the moment
  someone enrolls on the device, same as a punch would, so there's no need
  to wait for their first punch anymore.
- **`BIODATA`**: still not parsed — a different table name some
  device/firmware combos use instead of/alongside `OPERLOG`. Logged raw to
  the console only, same "inspect a real payload before writing a parser"
  policy `index.js` and `OPERLOG` both followed until a real sample existed.
- **Online/offline status**: unlike `index.js` (which knows a device is
  offline because a poll attempt failed), this server has no way to
  actively check — a device just stops pushing. So a device is marked
  `offline` if it hasn't pushed anything in `OFFLINE_AFTER_MS` (default 5
  minutes), swept every 60s.

## Running it

```bash
cd zkteco-bridge
npm install
cp .env.push-server.example .env
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run start:push-server
```

Note there is deliberately no `COMPANY_ID` in its `.env` — that's the whole
point of this file vs. `index.js`'s `.env.example`.

## Deploying it centrally

This needs to run somewhere **always-on and reachable over the public
internet** — not on anyone's laptop. A small VM works fine (this is a single
lightweight Node process, no GPU/heavy compute needed):

- A $5-6/mo droplet/VM (DigitalOcean, Fly.io, Railway, a cheap VPS, etc.)
- Run it under a process manager so it restarts on crash/reboot, e.g.
  `pm2 start push-server.js --name zkteco-push` or a systemd service
- Put it behind a domain (even a free one) so devices have a stable
  hostname to push to instead of a raw IP that might change
- Open/forward whatever port you set `PUSH_PORT` to (default `8088`)

## Pointing a device at it

**Use port 80, not `PUSH_PORT` (8088), unless this device is one of the
known clock-skew units.** Two separate customer sites (Gokarna Hillside,
Safe Driving) both had a device whose settings looked completely correct —
server reachable, serial registered — that still never sent a single
packet, confirmed all the way down at `tcpdump`. Root cause in both cases:
their router/ISP silently drops outbound traffic to non-standard ports like
`8088`, while ordinary web traffic on 80/443 goes through fine. Nothing on
this server or in the device's config was actually broken; it just never
got a chance to send anything.

nginx already proxies `/iclock/` on port 80 (and 443) straight through to
this server (see `admin-web`'s nginx site config) — that path has been
available the whole time, this was previously just never documented as the
one to use. So, on the ZKTeco terminal's **Cloud Server / ADMS** settings:

- Server address: this server's public domain or IP
- Server port: **`80`** (falls back to `8088` only if you specifically need
  the clock-display correction below, which requires bypassing nginx)
- Enable "Cloud Server" / ADMS mode

The device will then start POSTing to `http://<your-server>/iclock/cdata`
on its own. Confirm it worked by watching this server's logs for
`[push] device <name> initializing` and `[push] <name>: N punch(es) upserted`,
and by checking that device's `status`/`last_sync` update on the admin
Devices page.

**When to still use port `8088` directly**: only a device known to need
the on-screen clock correction in `push-server.js` (see
`CLOCK_OFFSET_MINUTES_BY_SERIAL`) requires connecting straight to
`PUSH_PORT`, bypassing nginx — nginx regenerates the HTTP `Date` header on
every response and can't be made to pass the server's spoofed one through,
which is what that correction depends on. This only affects the device's
own on-screen clock display, never the actual attendance data recorded
(`correctDeviceTimestamp()` corrects the stored punch time independently
of that header) — so a device not on that list has no reason to ever use
`8088`, and one that is should stay on it rather than move to port 80.

## Migration safety

Because both `index.js` and this server write through the same idempotent
`(employee_id, punch_time)` upsert, there's no risk in running the old
per-company `index.js` bridge and this central push server side by side
while cutting a company over — punches arriving from both paths just
de-duplicate. No flag-day cutover is required per company.
