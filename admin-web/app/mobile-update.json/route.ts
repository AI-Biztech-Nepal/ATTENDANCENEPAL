// Polled by the mobile app on launch (mobile-app/src/lib/useUpdateCheck.ts)
// to offer its in-app "A new version is available" banner. Answers from the
// newest GitHub release, which .github/workflows/build-android.yml publishes
// for every Android build, so each new build reaches installed apps on its
// own — this replaced a hand-edited public/mobile-update.json at the same
// URL (installed apps keep polling it), which went stale whenever nobody
// remembered to bump it.
const LATEST_RELEASE_URL = 'https://api.github.com/repos/AI-Biztech-Nepal/ATTENDANCENEPAL/releases/latest';

type Release = { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };

export async function GET() {
  // Cached for 5 minutes: GitHub allows 60 unauthenticated requests an hour
  // per server IP, and every app launch hits this route.
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    next: { revalidate: 300 },
  }).catch(() => null);
  if (!res?.ok) {
    return Response.json({ error: 'Latest release is unavailable right now.' }, { status: 502 });
  }

  const release = (await res.json()) as Release;
  // Tags are v<versionCode> (e.g. v158), the same number the workflow stamps
  // into android.versionCode — what the app compares its installed build to.
  const versionCode = Number((release.tag_name ?? '').replace(/^v/, ''));
  const apk = release.assets?.find(a => a.name.endsWith('.apk'));
  if (!Number.isInteger(versionCode) || versionCode <= 0 || !apk) {
    return Response.json({ error: 'Latest release has no APK.' }, { status: 502 });
  }

  return Response.json({ versionCode, version: `1.0.${versionCode}`, downloadUrl: apk.browser_download_url });
}
