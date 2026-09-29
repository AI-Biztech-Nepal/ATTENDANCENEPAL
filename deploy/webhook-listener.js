// Minimal GitHub webhook listener — no dependencies beyond Node's builtins.
// Verifies the HMAC signature GitHub sends, and on a push to main, runs
// redeploy.sh. Bound to 127.0.0.1 only; nginx proxies /deploy-webhook to it
// over the site's existing HTTPS, so this is never directly internet-facing.
// Verified working end-to-end 2026-08-12.
//
// Requires WEBHOOK_SECRET in the environment (set in
// deploy/webhook.ecosystem.config.js on the server — not committed to git).
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');

const SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.WEBHOOK_PORT || 9001;

if (!SECRET) {
  console.error('WEBHOOK_SECRET is not set — refusing to start.');
  process.exit(1);
}

function verifySignature(payload, signatureHeader) {
  if (!signatureHeader) return false;
  const digest = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let deploying = false;
let pending = false; // a push landed mid-deploy; redeploy once more when done

function runDeploy() {
  deploying = true;
  pending = false;
  const logFile = path.join(__dirname, 'last-deploy.log');
  exec(`bash ${path.join(__dirname, 'redeploy.sh')} > ${logFile} 2>&1`, err => {
    deploying = false;
    if (err) console.error('[deploy-webhook] redeploy failed:', err.message);
    else console.log('[deploy-webhook] redeploy succeeded');
    if (pending) runDeploy();
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy-webhook') {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 5e6) req.destroy();
  });
  req.on('end', () => {
    if (!verifySignature(body, req.headers['x-hub-signature-256'])) {
      res.writeHead(401);
      res.end('invalid signature');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('invalid payload');
      return;
    }

    if (payload.ref !== 'refs/heads/main') {
      res.writeHead(200);
      res.end('ignored (not a push to main)');
      return;
    }

    res.writeHead(200);
    if (deploying) {
      pending = true;
      res.end('deploy in progress, queued another run');
      return;
    }
    res.end('deploying');
    runDeploy();
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[deploy-webhook] listening on 127.0.0.1:${PORT}`));
