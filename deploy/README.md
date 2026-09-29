# Deploying admin-web to a Debian VPS

`admin-web` is a Next.js 14 app with server-side API routes (`app/api/**/route.ts`) that use
the Supabase service-role key, so it needs a running Node process — not a static export.
This runbook takes a bare Debian VPS to admin-web live behind HTTPS, as an alternative (or
addition) to the existing Vercel deploy (`admin-web/vercel.json`).

## 1. Point DNS at the VPS

Add an A record for your subdomain (e.g. `admin.yourcompany.com`) pointing at the VPS's
public IP. Give it a few minutes to propagate.

## 2. Initial server setup

SSH in as root the first time only, create a sudo user, and switch to it for everything else:

```bash
ssh root@your.vps.ip
apt update && apt full-upgrade -y

adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# from here on, log in as deploy
```

Firewall:

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. Install Node.js, Nginx, git, PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
```

## 4. Clone and configure the app

```bash
git clone <your-repo-url> ~/app
cd ~/app/admin-web
npm ci
```

Create `.env.local` on the server (never commit this — copy the values from your Vercel
project's Environment Variables settings, or your Supabase project settings):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 5. Build and run with PM2

```bash
cd ~/app/admin-web
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run the sudo command it prints, so PM2 survives reboots
```

Sanity check: `curl localhost:3000` should return HTML.

## 6. Nginx reverse proxy + TLS

```bash
sudo cp ~/app/deploy/nginx-admin-web.conf /etc/nginx/sites-available/admin-web
sudo nano /etc/nginx/sites-available/admin-web   # set server_name to your real domain
sudo ln -s /etc/nginx/sites-available/admin-web /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d admin.yourcompany.com
```

## 7. Redeploying after changes

```bash
cd ~/app
git pull
cd admin-web
npm ci
npm run build
pm2 restart admin-web
```

## 8. Auto-deploy on push (webhook, no manual `git pull`)

`deploy/webhook-listener.js` and `deploy/redeploy.sh` already do the work — this
wires them up so a push to `main` redeploys automatically.

**On the VPS**, create `~/app/deploy/webhook.ecosystem.config.js` (not committed —
it holds a secret):

```js
module.exports = {
  apps: [
    {
      name: 'deploy-webhook',
      cwd: __dirname,
      script: 'webhook-listener.js',
      env: {
        WEBHOOK_SECRET: 'generate-a-long-random-string-here',
      },
    },
  ],
};
```

Generate the secret with `openssl rand -hex 32`, then start it:

```bash
cd ~/app/deploy
pm2 start webhook.ecosystem.config.js
pm2 save
```

Add the `/deploy-webhook` location from `deploy/nginx-admin-web.conf` to the
server's nginx config (already in the template in this repo) and reload:

```bash
sudo cp ~/app/deploy/nginx-admin-web.conf /etc/nginx/sites-available/admin-web
sudo nginx -t && sudo systemctl reload nginx
```

**On GitHub**, repo → Settings → Webhooks → Add webhook:
- Payload URL: `https://attendance-nepal.com/deploy-webhook`
- Content type: `application/json`
- Secret: the same string as `WEBHOOK_SECRET` above
- Events: just "push"

Push to `main` and check `deploy/last-deploy.log` on the server (or
`pm2 logs deploy-webhook`) to confirm it ran. GitHub's webhook page also shows
delivery attempts and responses under "Recent Deliveries" for debugging.
