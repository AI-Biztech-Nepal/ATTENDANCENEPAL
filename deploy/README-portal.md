# Attendance inside AIBIZTECH, on the VPS

The existing admin-web in `~/app` keeps running untouched (it still deploys from `main`). A second copy, built from the
`aibiztech-embed` branch, runs beside it (PM2 name `attendance-portal`, port 3100). It signs people in with the AIBIZTECH
portal and serves its pages under `/attendance`.

1. DNS: add an A record for a new name, e.g. `attendance-portal.yourdomain.com`, pointing at the VPS.
2. On the VPS as the deploy user:
   ```
   git clone <this repo's url> ~/app-portal
   cd ~/app-portal && git checkout aibiztech-embed
   ```
3. Create `~/app-portal/admin-web/.env.local` (never commit it):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://feylbretbknouzxxyjwg.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<the portal's publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<the portal project's secret key>
   PORTAL_SIGNUP_URL=https://aibiztech.vercel.app/signup
   ```
   The address and publishable key are built into the pages, so rebuild after changing them.
4. `bash ~/app-portal/deploy/redeploy-portal.sh` (installs, builds, starts or restarts the process).
5. Nginx and HTTPS: `deploy/nginx-attendance-portal.conf` (set your name), then `sudo certbot --nginx -d <name>`.
6. Check on the VPS: `curl -I http://localhost:3100/attendance/login` returns 200.
7. In Vercel, project `aibiztech`: add `ATTENDANCE_URL=https://<name>` (no trailing slash) and redeploy.

Later updates: push to `aibiztech-embed`, then run step 4 again.
