// Attendance Nepal desktop wrapper: a real Windows app that opens the same
// live admin-web dashboard everyone already uses in a browser, in its own
// window instead of a browser tab — a taskbar icon, a Start Menu shortcut,
// remembers window size, and a proper offline/retry screen instead of
// Electron's default ugly error page. It doesn't run a second copy of the
// app locally: the dashboard and all its data are already fully hosted
// (Next.js on the VPS, data in Supabase), so pointing a window at the live
// URL gives 100% feature parity for free and always reflects whatever's
// currently deployed, with zero duplicate code to keep in sync.
//
// Logging into the dashboard inside this window works exactly like logging
// in via a browser — Supabase Auth, same per-company data via the same RLS
// rules — so this one build works for every company/customer, not just one;
// each admin just signs into their own account like they already do today.
//
// Also embeds the LAN device bridge — if a device bridge credential is
// configured (Tray icon → Configure Device Bridge…), this PC also pulls
// attendance from any ZKTeco terminal on its own local network and syncs it
// to the cloud, running in the background via the system tray even when
// this window is closed — this is the only process that ever talks to a LAN
// device (see zkteco-bridge/README.md), so it has to keep running
// unattended the way ZKTeco's own bridging software does, not just while a
// dashboard window happens to be open.
//
// Closing the window (the X button) always just hides it to the tray now,
// for every machine — Quit from the tray menu is what actually exits (see
// the isQuitting flag below). This isn't only about the device bridge: fully
// killing the process on every close also killed Supabase's background
// token-refresh loop, so on a machine with no bridge (most of them), closing
// the window and reopening it later than the access token's lifetime forced
// a real re-login — the refresh only gets a chance to run while the process
// is alive. Keeping the process resident in the tray avoids that entirely.
//
// Unlike the dashboard (which is never bundled at all, just loaded live),
// the bridge logic itself is fetched from admin-web/public/lan-bridge.js at
// every startup instead of being frozen into this .exe forever — a bug fix
// there ships the moment it's deployed, the same way a dashboard change
// does, with no new .exe to hand out. The bundled lan-bridge.js next to this
// file is only a fallback for the (rare) case a machine's very first launch
// has no internet yet; once a fetch ever succeeds, the fetched copy — cached
// to disk — is preferred over the bundled one from then on, including for
// any offline launch after that.
//
// The app shell itself (this file, the tray, the settings window) updates
// the traditional way instead — via electron-updater, checking
// admin-web/public/desktop-updates/ (a static folder on the same server,
// outside git — these installer files are far too large to belong in a git
// repo) for a newer installed version and silently installing it. This ONLY
// works for the installer distribution (Setup.exe), not the portable
// single-file exe — a portable app has no fixed install location for an
// updater to replace in place, so it can't self-update by design. Use the
// installer on every device that should stay current without manual action.
const { app, BrowserWindow, Menu, Tray, ipcMain, safeStorage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Without this, launching the app a second time (double-clicking the
// Desktop shortcut again, clicking it in the Start Menu while it's already
// running, etc.) starts a completely independent second copy — its own
// Electron main process plus its own full set of Chromium sub-processes
// (GPU, renderer, network service...) on top of the first one, and a third
// launch stacks a third full copy on top of that. Each individual copy
// isn't unusually heavy; the multiplying is the problem. This claims a lock
// so only the FIRST launch actually starts the app — any later launch
// attempt just asks that first instance to focus its window (below) and
// then quits immediately instead of spawning anything.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const APP_URL = 'https://attendance-nepal.com';
const LAN_BRIDGE_URL = `${APP_URL}/lan-bridge.js`;
const LAN_BRIDGE_FETCH_TIMEOUT_MS = 5000;

const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');
const bridgeConfigFile = path.join(app.getPath('userData'), 'bridge-config.json');
const lanBridgeCacheFile = path.join(app.getPath('userData'), 'lan-bridge-cached.js');

let lanBridge = null;

// A file fetched to userData has no node_modules anywhere near it, so a
// plain require() of it would fail to resolve node-zklib/@supabase/
// supabase-js/ws — this loads it as a real module but resolves ITS require()
// calls against this app's own bundled node_modules (via __dirname) instead
// of wherever the file happens to live on disk, so the fetched code can stay
// a plain, dependency-using Node file with no special packaging of its own.
function loadModuleWithOwnDependencies(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(code, filePath);
  return mod.exports;
}

async function loadLanBridge() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LAN_BRIDGE_FETCH_TIMEOUT_MS);
    const res = await fetch(LAN_BRIDGE_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    fs.writeFileSync(lanBridgeCacheFile, code);
    console.log('[main] fetched latest lan-bridge.js');
  } catch (err) {
    console.warn(`[main] could not fetch latest lan-bridge.js (${err.message}), using a cached/bundled copy instead`);
  }

  const sourcePath = fs.existsSync(lanBridgeCacheFile) ? lanBridgeCacheFile : path.join(__dirname, 'lan-bridge.js');
  lanBridge = loadModuleWithOwnDependencies(sourcePath);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveBounds(win) {
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(win.getBounds()));
  } catch {
    // Not worth surfacing to the user — worst case the window just opens at
    // the default size next time.
  }
}

// Encrypted at rest via the OS's own credential store (DPAPI on Windows) —
// falls back to plain JSON only on a system where that's unavailable, which
// is rare and still no worse than the .env file the standalone bridge uses.
function saveBridgeConfig(email, password) {
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const payload = {
    email,
    encrypted: canEncrypt,
    password: canEncrypt ? safeStorage.encryptString(password).toString('base64') : password,
  };
  fs.writeFileSync(bridgeConfigFile, JSON.stringify(payload));
}

function loadBridgeConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(bridgeConfigFile, 'utf8'));
    const password = saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.password, 'base64')) : saved.password;
    return { email: saved.email, password };
  } catch {
    return null;
  }
}

function errorPageUrl(message) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Attendance Nepal</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #e2e8f0;
    display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 360px; }
  h1 { font-size: 18px; margin-bottom: 8px; }
  p { color: #94a3b8; font-size: 13px; line-height: 1.5; }
  button { margin-top: 16px; padding: 10px 20px; border-radius: 8px; border: none;
    background: #2563eb; color: white; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
</style></head>
<body>
  <div class="box">
    <h1>Can't reach the dashboard</h1>
    <p>${message}</p>
    <p>Check the internet connection on this PC, then try again.</p>
    <button onclick="location.href='${APP_URL}'">Retry</button>
  </div>
</body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createWindow() {
  const bounds = loadBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    title: 'Attendance Nepal',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Explicit, not the implicit default — makes it unambiguous that
      // Supabase's login session (stored via localStorage by its SDK) is
      // meant to survive between app restarts, the same way it would in a
      // real browser tab, instead of relying on nobody ever changing this.
      partition: 'persist:dashboard',
      // NOT sandboxed: on some Windows setups, Chromium's renderer sandbox
      // has been observed interfering with a renderer's ability to persist
      // its own storage partition to disk between process restarts — which
      // is exactly the "have to log in every single time" symptom this was
      // causing. The real security boundary for a website-wrapper app like
      // this is contextIsolation + nodeIntegration: false above (stops the
      // loaded site from ever reaching Node/the filesystem) — sandbox is an
      // extra hardening layer on top of that, not the boundary itself, so
      // dropping it here doesn't meaningfully weaken anything.
      sandbox: false,
    },
  });

  win.loadURL(APP_URL);

  // A link the dashboard opens with target="_blank" (or window.open) should
  // go to the person's actual default browser, not spawn a second app
  // window with no menu/controls of its own.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // -3 is Chromium's ERR_ABORTED, which fires harmlessly on normal
    // in-app navigations (e.g. clicking a sidebar link) — not a real
    // failure, so it's excluded here to avoid flashing the error screen.
    if (errorCode === -3) return;
    if (validatedURL && validatedURL.startsWith('data:')) return;
    win.loadURL(errorPageUrl(`${errorDescription} (${errorCode})`));
  });

  let saveTimeout;
  const scheduleSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveBounds(win), 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  // Always hide instead of closing (see the module comment above for why) —
  // Quit from the tray menu is the only thing that actually exits.
  win.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  mainWindow = win;
  return win;
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

let settingsWindow = null;
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'Device Bridge Settings',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload-settings.js'),
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function buildTrayMenu() {
  const status = lanBridge?.getStatus();
  const bridgeLabel = !lanBridge
    ? 'Device bridge: loading…'
    : !status.configured
      ? 'Device bridge: not configured'
      : status.running
        ? 'Device bridge: syncing'
        : 'Device bridge: stopped';
  return Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: showMainWindow },
    { label: bridgeLabel, enabled: false },
    { label: 'Configure Device Bridge…', click: openSettingsWindow },
    {
      label: 'Open DevTools (troubleshooting)',
      click: () => {
        showMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.openDevTools({ mode: 'detach' });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  tray.setToolTip('Attendance Nepal');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showMainWindow);
  // Keeps the "syncing"/"stopped"/error state in the tray menu roughly
  // current without the user needing to reopen Settings to check it.
  setInterval(() => tray.setContextMenu(buildTrayMenu()), 15000);
}

ipcMain.handle('bridge:save', async (_event, { email, password }) => {
  if (!lanBridge) return { ok: false, error: 'Still starting up — try again in a moment.' };
  try {
    await lanBridge.configure(email, password);
    saveBridgeConfig(email, password);
    if (tray) tray.setContextMenu(buildTrayMenu());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bridge:status', () => lanBridge?.getStatus() ?? { configured: false, running: false, lastError: null, lastSyncAt: null });

ipcMain.handle('bridge:get-saved', () => {
  const saved = loadBridgeConfig();
  return saved ? { email: saved.email } : null;
});

const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function setupAutoUpdater() {
  // Only meaningful for an installed build — running via `npm start`
  // (app.isPackaged === false) has no update metadata to check against and
  // would just log noisy errors every launch during development.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  // Installs the next time the app actually quits, not the instant a
  // download finishes — this app is meant to sit in the tray for long
  // stretches, so this avoids yanking the window/tray away from someone
  // mid-use. Quit only ever happens via the tray menu, so in practice an
  // update applies the next time this machine restarts or someone chooses
  // Quit.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', err => console.error('[main] auto-update error:', err.message));
  autoUpdater.on('update-available', info => console.log(`[main] update v${info.version} found, downloading…`));
  autoUpdater.on('update-downloaded', info => console.log(`[main] update v${info.version} downloaded — installs next time the app quits`));

  const check = () => autoUpdater.checkForUpdates().catch(err => console.error('[main] update check failed:', err.message));
  check();
  setInterval(check, AUTO_UPDATE_CHECK_INTERVAL_MS);
}

// Registers this app (the installed .exe, not this dev checkout) to launch
// automatically at Windows login — idempotent, so calling it on every start
// is fine. Without this, a device bridge configured via the tray only
// resumes syncing once someone happens to reopen the app after a reboot;
// Windows Update forces plenty of those, and a bridge silently offline until
// someone notices is exactly the "have to babysit it" problem this app
// exists to remove. Only meaningful for an installed build — a portable exe
// run from an arbitrary folder has no stable path for Windows to relaunch,
// and there's no login-item concept to register in dev (`npm start`).
function enableAutoLaunch() {
  if (!app.isPackaged) return;
  try {
    // args: ['--hidden'] marks a login-triggered launch so it can open
    // straight to the tray below, instead of popping the dashboard window
    // in front of whoever just logged in.
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  } catch (err) {
    console.error('[main] enabling auto-launch at login failed:', err.message);
  }
}

const launchedHidden = process.argv.includes('--hidden');

app.whenReady().then(async () => {
  // Nothing in the dashboard needs File/Edit/View/Window/Help — this is a
  // wrapped website, not a native editor, and that default Electron menu
  // just looks like leftover dev tooling.
  Menu.setApplicationMenu(null);
  enableAutoLaunch();
  // The dashboard window shows immediately — it doesn't wait on the bridge
  // fetch below, since that's a background concern only relevant to whoever
  // has actually configured a device bridge. Skipped when Windows itself
  // triggered this launch at login (--hidden): the point of auto-launch is
  // the bridge quietly resuming in the tray, not the dashboard window
  // popping up unasked-for every time someone signs in.
  if (!launchedHidden) createWindow();

  // Each of these is independent — a failure in one (e.g. a bad icon path
  // throwing inside createTray()) must never silently abort the ones after
  // it the way an unguarded synchronous throw here once did, taking down
  // the tray icon, the auto-updater, AND the device bridge auto-start
  // together from a single unrelated failure.
  try {
    createTray();
  } catch (err) {
    console.error('[main] createTray failed:', err.message);
  }
  try {
    setupAutoUpdater();
  } catch (err) {
    console.error('[main] setupAutoUpdater failed:', err.message);
  }
  try {
    await loadLanBridge();
    if (tray) tray.setContextMenu(buildTrayMenu());
    const saved = loadBridgeConfig();
    if (saved) {
      lanBridge.configure(saved.email, saved.password).catch(err => {
        console.error('[main] auto-starting device bridge failed:', err.message);
      });
    }
  } catch (err) {
    console.error('[main] device bridge startup failed:', err.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });

  // Fires in THIS (the first, already-running) instance whenever a second
  // launch attempt happens and gets turned away by the lock above — bring
  // the existing window to the front instead of leaving the user wondering
  // why clicking the icon again seemingly did nothing.
  app.on('second-instance', () => {
    showMainWindow();
  });
});

// Not wired to quit on this anymore: win.on('close') above always hides
// instead of letting the window actually close, so this only fires from
// paths that destroy the window outright (there are none currently) —
// Quit from the tray menu is the sole way the app exits.

app.on('before-quit', () => {
  isQuitting = true;
});
