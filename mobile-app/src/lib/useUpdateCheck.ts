import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';

// Hosted as a static file at admin-web/public/mobile-update.json — Vercel
// serves it at this path and redeploys it live on every push to main. Bump
// versionCode/downloadUrl there after each EAS build (see mobile-app/eas.json);
// no GitHub involved anywhere in this loop.
const UPDATE_CHECK_URL =
  process.env.EXPO_PUBLIC_UPDATE_CHECK_URL ?? 'https://attendancenepal.vercel.app/mobile-update.json';

type UpdateInfo = { versionCode: number; downloadUrl: string };

function parseManifest(json: any): UpdateInfo | null {
  const versionCode = Number(json?.versionCode);
  const downloadUrl = json?.downloadUrl;
  if (!Number.isFinite(versionCode) || versionCode <= 0 || typeof downloadUrl !== 'string' || !downloadUrl) {
    return null;
  }
  return { versionCode, downloadUrl };
}

/** Checks the Vercel-hosted manifest once per app launch and reports back if
 * it's newer than the build currently installed — silently gives up on any
 * error (offline, misconfigured URL, no manifest yet) rather than ever
 * blocking the app on this being reachable. */
export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    (async () => {
      try {
        const currentVersionCode = Number(Application.nativeBuildVersion);
        if (!currentVersionCode) return;
        const res = await fetch(UPDATE_CHECK_URL, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const info = parseManifest(await res.json());
        if (!active || !info) return;
        if (info.versionCode > currentVersionCode) setUpdate(info);
      } catch {
        // Offline or manifest unreachable — not worth surfacing to the user.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return update;
}
