// Retro Booth website server for Fly.io.
// Serves the static site and emails enquiries from the homepage form.
// No dependencies: Node 22+ only.
//
// Environment variables (set with `fly secrets set ...`):
// Enquiries are sent through Resend (https://resend.com) using a sending-only
// API key restricted to the verified mail.retrobooth.com.au domain.
//   RESEND_API_KEY  Resend sending API key (keep secret; never commit)
//   MAIL_FROM       Sender shown to recipients; must be on the Resend-verified
//                   domain, e.g. "Retro Booth <enquiries@mail.retrobooth.com.au>"
//   ENQUIRY_TO      Where enquiries are delivered (comma-separated), e.g. hello@retrobooth.com.au
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
    const stream = fs.createReadStream(file);
    // A read error after headers are sent can only be handled by dropping the
    // connection; without this handler it would crash the process.
    stream.on('error', (e) => { console.error('Read error', file, e.code); res.destroy(); });
    stream.pipe(res);
  });
}

// ---- Resend mail ----
const RESEND_URL = process.env.RESEND_URL || 'https://api.resend.com';

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
  req.on('error', (e) => console.error('Enquiry request error', e.code || e.message));
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
    const { RESEND_API_KEY, MAIL_FROM, ENQUIRY_TO } = process.env;
    if (!RESEND_API_KEY || !MAIL_FROM || !ENQUIRY_TO) {
      console.error('Enquiry not sent: RESEND_API_KEY, MAIL_FROM or ENQUIRY_TO is not set');
      return errorPage(res, 503, 'Our enquiry form is temporarily unavailable.');
    }
    const rows = FIELDS.filter(([k]) => v[k]).map(([k, label]) => [label, v[k]]);
    const html = '<table cellpadding="6" style="font-family:sans-serif;border-collapse:collapse">' +
      rows.map(([l, val]) => `<tr><th align="left" valign="top">${esc(l)}</th><td>${esc(val).replace(/\n/g, '<br>')}</td></tr>`).join('') + '</table>';
    try {
      const r = await fetch(`${RESEND_URL}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: ENQUIRY_TO.split(',').map((s) => s.trim()).filter(Boolean),
          reply_to: [v.email],
          subject: `Website enquiry: ${v.name} (${v.venue})`,
          html,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        console.error('Resend send error', r.status, (await r.text()).slice(0, 500));
        return errorPage(res, 502, 'Our email service had a problem.');
      }
      const j = await r.json().catch(() => ({}));
      console.log('Enquiry sent for', v.venue, j.id || '');
      send(res, 303, '', { Location: '/thanks/' });
    } catch (e) {
      console.error('Enquiry send failed', e.message);
      errorPage(res, 502, 'Our email service could not be reached.');
    }
  });
}

const server = http.createServer((req, res) => {
  req.on('error', (e) => console.error('Request error', e.code || e.message));
  res.on('error', (e) => console.error('Response error', e.code || e.message));
  const host = (req.headers.host || '').toLowerCase();
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch {
    return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
  }
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
