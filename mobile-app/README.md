# Attendance — Mobile App (React Native + Expo)

Employee-facing check-in app and a lightweight admin dashboard, both backed by Supabase.

## Setup

```bash
cd mobile-app
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm start               # opens Expo dev tools; scan the QR with Expo Go, or press a/i
```

Requires a Supabase project with `../supabase/schema.sql` applied, plus:
- A public Storage bucket named `attendance-selfies` (for the selfie check-in method).
- At least one `branches` row and one `employees` row linked to a `profiles` row (see
  `supabase/schema.sql` for the tables and RLS policies).

## Structure

- `src/lib/supabase.ts` — Supabase client (session persisted in AsyncStorage).
- `src/screens/LoginScreen.tsx` — Supabase Auth email/password sign-in.
- `src/screens/CheckInScreen.tsx` — employee check-in/out via GPS geofence, QR scan, or selfie.
- `src/screens/HistoryScreen.tsx` — an employee's own punch history.
- `src/screens/DashboardScreen.tsx` — admin-only live feed via Supabase Realtime.

`App.tsx` routes between the employee flow and the admin flow based on `profiles.role`.

## Shared logic (KPIs and feedback)

The KPI and feedback screens (My KPIs and Feedback for employees; KPIs, a person's Overview, Customer feedback, Colleague reviews and Import for
admin and HR) are the website's, ported to the phone. The numbers and rules live in plain TypeScript files that are **copies** of
`admin-web/lib/*.ts` (`kpi`, `kpiLoad`, `kpiSettings`, `taskKpi`, `rebookingKpi`, `feedbackKpi`, `npsKpi`, `colleagueKpi`, `colleagueFeedback`,
`customerFeedback`, `guestDetails`, `guestHistory`, `serviceImport`, `serviceKpi`, `reportKpi`, `compareKpi`, `ownKpi`, and the `use*` hooks).
Each starts with a "Ported from admin-web/lib/…" line. Only the import paths differ (`./types` becomes `../types`, `./taskSchedule` becomes
`./taskClock`). **When one of these changes on the website, make the same change here**, so a person sees the same number on both. The screens
themselves are rewritten for a phone and live in `src/screens` (MyKpisScreen, KpisScreen, KpiPersonScreen, EmployeeMoreScreen) and
`src/components/kpi`.

The employee bottom bar keeps five slots like the website's phone bar: Check In/Out, Calendar, My Tasks, My KPIs and More; More holds Payroll and
Profile. Feedback is a section of the My KPIs tab. Admin and HR reach KPIs from the More tab.

## Releasing a new build (EAS + Vercel, no GitHub involved)

1. Bump `version` and `android.versionCode` in `app.json` — `versionCode` must be
   strictly higher than whatever's currently live (check
   `admin-web/public/mobile-update.json` on your deployed site) or Android won't
   treat it as an update for anyone who already has the app installed.
2. `npx eas-cli@latest login` (free Expo account — one-time) then
   `npx eas-cli@latest build --platform android --profile preview`. Builds run on
   Expo's cloud infra; you'll get a download link when it finishes.
3. Download the resulting `.apk`, then in the Vercel dashboard for the `admin-web`
   project: **Storage → Blob → Upload** it and copy the public URL.
4. Edit `admin-web/public/mobile-update.json`: set `versionCode`/`version` to match
   step 1, and `downloadUrl` to the Blob URL from step 3. Commit + push — Vercel
   redeploys `admin-web` automatically, and the change is live immediately.
5. Anyone with the app open will see the in-app update banner
   (`src/components/UpdateBanner.tsx`) next launch, sourced from
   `src/lib/useUpdateCheck.ts` polling that JSON file — no GitHub release, token,
   or Actions run required at any step.

One-time setup: `EXPO_PUBLIC_UPDATE_CHECK_URL` in `.env` (and as an EAS project
env var for cloud builds) must point at your deployed `admin-web` domain, e.g.
`https://your-app.vercel.app/mobile-update.json`.
