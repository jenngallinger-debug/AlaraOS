'use strict';
// AlaraOS site server.
//
// Canonical decision (docs/SYSTEM-ARCHITECTURE.md, Decision 2): the static
// build in public/ IS the website. This server's only jobs are:
//   1. serve the static public/ files (with clean, extensionless URLs)
//   2. enforce the staging noindex/robots guard until SITE_MODE=production
//   3. host the small /api/event analytics endpoint
//
// No HTML is generated here anymore; design lives in one place (public/).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
// AlaraOS Engine V1 (internal): workflow engine + staff console, active only
// when ENGINE_KEY is set. See docs/ENGINE-V1.md.
const engineWeb = require('./engine/web');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ANALYTICS_LOG = path.join(__dirname, 'data', 'analytics.log');
const IS_PRODUCTION = process.env.SITE_MODE === 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

function send(res, code, type, body, extra) {
  const headers = Object.assign({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' }, extra || {});
  // Until launch, every response tells crawlers to stay out.
  if (!IS_PRODUCTION) headers['X-Robots-Tag'] = 'noindex, nofollow';
  res.writeHead(code, headers);
  res.end(body);
}

// Map a request path to a file inside public/. Supports:
//   /                -> public/home.html
//   /white-card      -> public/white-card.html
//   /white-card.html -> public/white-card.html
//   /site.css        -> public/site.css
function resolveFile(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '' ) rel = 'home.html';
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return null; // traversal guard
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  // extensionless pretty URL -> .html
  if (!path.extname(file)) {
    const asHtml = file + '.html';
    if (fs.existsSync(asHtml) && fs.statSync(asHtml).isFile()) return asHtml;
  }
  return null;
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = /\.(css|js|svg|webp|png|jpe?g|woff2?|ico)$/i.test(file)
      ? { 'Cache-Control': 'public, max-age=3600' } : { 'Cache-Control': 'no-cache' };
    send(res, 200, type, data, cache);
  });
}

function notFound(res) {
  const custom = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(custom)) return fs.readFile(custom, (e, d) => send(res, 404, MIME['.html'], d || '404'));
  send(res, 404, MIME['.html'], '<!doctype html><meta charset="utf-8"><title>Not found</title><p>404 &mdash; <a href="/">Go home</a></p>');
}

function logEvent(req, res) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
  req.on('end', () => {
    let ev = {};
    try { ev = JSON.parse(raw || '{}'); } catch (e) {}
    // Anonymous navigation/question-demand signal. No PII, no IP.
    const rec = {
      ts: new Date().toISOString(), day: new Date().toISOString().slice(0, 10),
      type: String(ev.type || 'unknown').slice(0, 40), nodeId: String(ev.nodeId || '').slice(0, 60),
      label: String(ev.label || '').slice(0, 120)
    };
    fs.appendFile(ANALYTICS_LOG, JSON.stringify(rec) + '\n', () => {});
    res.writeHead(204); res.end();
  });
}

// ---------------------------------------------------------------------------
// Form submissions (case review / referral / begin).
// Delivery is key-ready: set ONE of SENDGRID_API_KEY (Twilio SendGrid) or
// RESEND_API_KEY in the Render env and submissions are emailed to EMAIL_TO.
// EMAIL_FROM must be a sender the provider has verified. Every submission is
// ALSO appended to data/submissions.log as a local safety net. The client asks
// /api/config whether email delivery is live; until it is, pages keep their
// mailto flow and this endpoint is the backup record.
const SUBMISSIONS_LOG = path.join(__dirname, 'data', 'submissions.log');
const EMAIL_TO = process.env.EMAIL_TO || 'referrals@alarahomecare.com';
const EMAIL_FROM = process.env.EMAIL_FROM || 'website@alarahomecare.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const EMAIL_DELIVERY = !!(SENDGRID_API_KEY || RESEND_API_KEY);

// Send via whichever provider has a key (SendGrid wins if both are set).
// Resolves true on acceptance; logs and resolves false on any failure.
async function sendEmail(subject, text) {
  try {
    let r;
    if (SENDGRID_API_KEY) {
      r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + SENDGRID_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: EMAIL_TO }] }],
          from: { email: EMAIL_FROM, name: 'Alara Website' },
          subject: subject,
          content: [{ type: 'text/plain', value: text }]
        })
      });
    } else {
      r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [EMAIL_TO], subject: subject, text: text })
      });
    }
    if (r.ok || r.status === 202) return true; // SendGrid acceptance is 202
    console.error('[submit] email send failed', r.status, await r.text().catch(() => ''));
  } catch (e) { console.error('[submit] email send error', e.message); }
  return false;
}

function handleSubmit(req, res) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 16384) req.destroy(); });
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch (e) {}
    const kind = String(body.kind || 'submission').slice(0, 40);
    const subject = String(body.subject || ('Website ' + kind)).slice(0, 140);
    const text = String(body.text || '').slice(0, 8000);
    if (!text.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"ok":false,"error":"empty"}'); }

    // Safety net first: the local log always gets the record.
    const rec = { ts: new Date().toISOString(), kind, subject, text };
    try { fs.appendFileSync(SUBMISSIONS_LOG, JSON.stringify(rec) + '\n'); } catch (e) {}

    // Every website conversion becomes an engine case: pre-read runs, the
    // nurse prompt lands in the /os work queue with its 1-hour clock started.
    if (engineWeb.ENGINE_KEY) engineWeb.intakeFromSubmission(kind, subject, text);

    let delivered = 'log';
    if (EMAIL_DELIVERY && await sendEmail(subject, text)) delivered = 'email';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, delivered }));
  });
}

function robotsTxt() {
  // Staging: disallow everything. Production: allow.
  return IS_PRODUCTION ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p === '/healthz') return send(res, 200, 'text/plain', 'ok');
    if (p.startsWith('/os') && engineWeb.handle(req, res, u)) return;
    if (p === '/robots.txt') return send(res, 200, MIME['.txt'], robotsTxt());
    if (p === '/api/event' && req.method === 'POST') return logEvent(req, res);
    if (p === '/api/submit' && req.method === 'POST') return handleSubmit(req, res);
    if (p === '/api/config') return send(res, 200, MIME['.json'], JSON.stringify({ emailDelivery: EMAIL_DELIVERY }));

    const file = resolveFile(p);
    if (file) return serveFile(res, file);
    return notFound(res);
  } catch (e) {
    console.error('[server] error on', p, e);
    send(res, 500, MIME['.html'], '<!doctype html><meta charset="utf-8"><title>Error</title><p>Something went wrong.</p>');
  }
});

server.listen(PORT, () => console.log(`AlaraOS serving public/ on http://localhost:${PORT} (${IS_PRODUCTION ? 'production' : 'staging'})`));
// Engine heartbeat: wakes sleeping cases and spawns due renewals every 15
// minutes — the claim-companion pipeline never depends on a console visit.
engineWeb.startSchedule();
