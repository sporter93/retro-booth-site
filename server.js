// Retro Booth website server for Fly.io.
// Serves the static site and emails enquiries from the homepage form.
// No dependencies: Node 22+ only.
//
// Environment variables (set with `fly secrets set ...`):
// Enquiries are sent through Microsoft 365 (Microsoft Graph sendMail) using an
// Entra app registration with the Mail.Send application permission.
//   MS_TENANT_ID      Directory (tenant) ID of the Microsoft 365 organisation
//   MS_CLIENT_ID      Application (client) ID of the app registration
//   MS_CLIENT_SECRET  Client secret value of the app registration
//   MAIL_FROM         Mailbox the email is sent from, e.g. hello@retrobooth.com.au
//   ENQUIRY_TO        Where enquiries are delivered (comma-separated), e.g. hello@retrobooth.com.au
//   PORT            Defaults to 8080

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'site');
const PORT = Number(process.env.PORT) || 8080;
const MAX_BODY = 20 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function notFound(res, head) {
  const file = path.join(ROOT, '404.html');
  fs.readFile(file, (err, data) => {
    send(res, 404, head ? undefined : (err ? 'Not found' : data),
      { 'Content-Type': err ? 'text/plain; charset=utf-8' : TYPES['.html'], 'Cache-Control': 'no-cache' });
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return notFound(res); }
  if (rel.includes('\0')) return notFound(res);
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return notFound(res);
  // Block server/source files that live outside site/ anyway; and hidden files.
  if (rel.split('/').some((p) => p.startsWith('.'))) return notFound(res);

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return send(res, 301, '', { Location: pathname + '/' + q });
      }
      return serveFile(req, res, path.join(file, 'index.html'));
    }
    if (err) return notFound(res, req.method === 'HEAD');
    serveFile(req, res, file, st);
  });
}

function serveFile(req, res, file, st) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res, req.method === 'HEAD');
    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html';
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': isHtml || ext === '.xml' || ext === '.txt' ? 'no-cache' : 'public, max-age=604800',
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
    };
    if (req.headers['if-none-match'] === etag) return send(res, 304, undefined, headers);
    headers['Content-Length'] = stat.size;
    res.writeHead(200, { ...SECURITY_HEADERS, ...headers });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---- Microsoft 365 (Graph) mail ----
const LOGIN_URL = process.env.MS_LOGIN_URL || 'https://login.microsoftonline.com';
const GRAPH_URL = process.env.MS_GRAPH_URL || 'https://graph.microsoft.com';
let cachedToken = null; // { value, expires }
async function graphToken(tenant, clientId, secret) {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const r = await fetch(`${LOGIN_URL}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token request failed (${r.status}) ${j.error || ''} ${(j.error_description || '').slice(0, 200)}`);
  cachedToken = { value: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

// ---- Enquiry form ----
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 5; // max 5 enquiries per IP per 10 minutes
}

const FIELDS = [
  ['name', 'Name'], ['venue', 'Business or venue'], ['email', 'Email'], ['phone', 'Phone'],
  ['location', 'Location'], ['business_type', 'Business type'], ['interest', 'Interested in'],
  ['booth_model', 'Booth model'], ['notes', 'Additional information'],
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function errorPage(res, status, message) {
  send(res, status, `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Enquiry not sent | Retro Booth</title>
<style>body{font-family:Archivo,system-ui,sans-serif;background:#F6F4EF;color:#16141A;max-width:640px;margin:0 auto;padding:64px 20px;line-height:1.5}a{color:#D7261E;font-weight:600}</style></head>
<body><h1>Sorry, your enquiry wasn't sent.</h1><p>${esc(message)}</p><p>Please call <a href="tel:+61388998999">03 8899 8999</a> or email <a href="mailto:hello@retrobooth.com.au">hello@retrobooth.com.au</a>, or <a href="/#enquire">go back and try again</a>.</p></body></html>`,
  { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
}

function handleEnquiry(req, res) {
  const ip = (req.headers['fly-client-ip'] || req.socket.remoteAddress || '').toString();
  let size = 0; const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (size > MAX_BODY) return errorPage(res, 413, 'The form was too large to send.');
    const data = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    // Honeypot: real people leave this empty. Pretend success for bots.
    if (data.get('bot-field')) return send(res, 303, '', { Location: '/thanks/' });
    if (rateLimited(ip)) return errorPage(res, 429, 'Too many enquiries were sent from your connection in a short time.');

    const v = Object.fromEntries(FIELDS.map(([k]) => [k, (data.get(k) || '').trim().slice(0, 3000)]));
    if (!v.name || !v.venue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
      return errorPage(res, 400, 'Please include your name, business or venue, and a valid email address.');
    }
    const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM, ENQUIRY_TO } = process.env;
    if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !MAIL_FROM || !ENQUIRY_TO) {
      console.error('Enquiry not sent: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM or ENQUIRY_TO is not set');
      return errorPage(res, 503, 'Our enquiry form is temporarily unavailable.');
    }
    const rows = FIELDS.filter(([k]) => v[k]).map(([k, label]) => [label, v[k]]);
    const html = '<table cellpadding="6" style="font-family:sans-serif;border-collapse:collapse">' +
      rows.map(([l, val]) => `<tr><th align="left" valign="top">${esc(l)}</th><td>${esc(val).replace(/\n/g, '<br>')}</td></tr>`).join('') + '</table>';
    try {
      const token = await graphToken(MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET);
      const r = await fetch(`${GRAPH_URL}/v1.0/users/${encodeURIComponent(MAIL_FROM)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: `Website enquiry: ${v.name} (${v.venue})`,
            body: { contentType: 'HTML', content: html },
            toRecipients: ENQUIRY_TO.split(',').map((s) => s.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } })),
            replyTo: [{ emailAddress: { address: v.email, name: v.name } }],
          },
          saveToSentItems: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status !== 202) {
        console.error('Microsoft Graph sendMail error', r.status, (await r.text()).slice(0, 500));
        if (r.status === 401) cachedToken = null;
        return errorPage(res, 502, 'Our email service had a problem.');
      }
      console.log('Enquiry sent for', v.venue);
      send(res, 303, '', { Location: '/thanks/' });
    } catch (e) {
      console.error('Enquiry send failed', e.message);
      errorPage(res, 502, 'Our email service could not be reached.');
    }
  });
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').toLowerCase();
  const url = new URL(req.url, 'http://localhost');
  // Redirect www to the bare domain.
  if (host === 'www.retrobooth.com.au') {
    return send(res, 301, '', { Location: `https://retrobooth.com.au${url.pathname}${url.search}` });
  }
  if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (url.pathname === '/api/enquiry') {
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'POST' });
    return handleEnquiry(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Retro Booth site on :${PORT}`));
