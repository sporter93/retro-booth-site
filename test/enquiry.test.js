// Enquiry form tests against a local stub of the Resend API (no real email
// is sent; the key is a dummy). Run with `node --test test/*.test.js`.
// Set SHOW_PAYLOAD=1 to print the JSON the stub receives.
'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { startServer, stop } = require('./helpers');

let stub; let received = []; let srv; let ipCounter = 0;

before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'stub-email-id' }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  srv = await startServer({
    RESEND_API_KEY: 're_dummy_test_key',
    MAIL_FROM: 'Retro Booth <enquiries@mail.retrobooth.com.au>',
    ENQUIRY_TO: 'hello@retrobooth.com.au',
    RESEND_URL: `http://127.0.0.1:${stub.address().port}`,
  });
});
after(async () => { await stop(srv); stub.close(); });
beforeEach(() => { received = []; });

// Each post gets its own client IP so the rate limit doesn't interfere.
function post(form, headers = {}) {
  return fetch(`${srv.base}/api/enquiry`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Fly-Client-IP': `10.0.0.${++ipCounter}`, ...headers },
    body: typeof form === 'string' ? form : new URLSearchParams(form).toString(),
  });
}

const GOOD = {
  name: 'Sam Example', venue: 'The Example Hotel', email: 'sam@example.com', phone: '0400 000 000',
  location: 'Fitzroy VIC', business_type: 'Pub', interest: 'Buying a booth', booth_model: 'Standing Booth',
  notes: 'Line one\nLine two', 'bot-field': '',
};

test('a valid enquiry is sent to Resend and redirects to /thanks/', async () => {
  const res = await post(GOOD);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/thanks/');
  assert.equal(received.length, 1);
  const { method, url, auth, body } = received[0];
  if (process.env.SHOW_PAYLOAD) console.log('Stub received:', JSON.stringify({ method, url, auth: auth.replace(/re_\w+/, 're_***'), body }, null, 2));
  assert.equal(method, 'POST');
  assert.equal(url, '/emails');
  assert.equal(auth, 'Bearer re_dummy_test_key');
  assert.equal(body.from, 'Retro Booth <enquiries@mail.retrobooth.com.au>');
  assert.deepEqual(body.to, ['hello@retrobooth.com.au']);
  assert.deepEqual(body.reply_to, ['sam@example.com']);
  assert.equal(body.subject, 'Website enquiry: Sam Example (The Example Hotel)');
  assert.match(body.html, /Line one<br>Line two/);
});

test('CR/LF and control characters are stripped from header-bound fields', async () => {
  const res = await post({ ...GOOD, name: 'Eve\r\nBcc: victim@example.com', venue: 'Bar\u0000\u0007\u2028Two' });
  assert.equal(res.status, 303);
  const { subject, html } = received[0].body;
  if (process.env.SHOW_PAYLOAD) console.log('Sanitised subject:', JSON.stringify(subject));
  assert.doesNotMatch(subject, /[\r\n\u0000-\u001f\u2028]/);
  assert.equal(subject, 'Website enquiry: Eve Bcc: victim@example.com (Bar Two)');
  assert.doesNotMatch(html, /[\r\u0000\u0007]/);
});

for (const email of ['a@example.com, b@example.com', 'a@example.com\r\nBcc: b@example.com', 'Sam <sam@example.com>', 'a@b', 'a..b@example.com', 'a@-example.com']) {
  test(`reply_to must be one plain address: rejects ${JSON.stringify(email)}`, async () => {
    const res = await post({ ...GOOD, email });
    assert.equal(res.status, 400);
    assert.equal(received.length, 0);
  });
}

test('an oversized form gets a readable 413 page, not a reset connection', async () => {
  const res = await post({ ...GOOD, notes: 'x'.repeat(30 * 1024) });
  assert.equal(res.status, 413);
  assert.match(await res.text(), /too large to send/);
  assert.equal(received.length, 0);
});

test('an oversized body without Content-Length still gets the 413 page', async () => {
  const big = new URLSearchParams({ ...GOOD, notes: 'x'.repeat(30 * 1024) }).toString();
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const res = await fetch(`${srv.base}/api/enquiry`, {
    method: 'POST', redirect: 'manual', duplex: 'half', body: stream,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Fly-Client-IP': `10.0.1.${++ipCounter}` },
  });
  assert.equal(res.status, 413);
  assert.match(await res.text(), /too large to send/);
});

test('text responses are gzipped when the client accepts it', async () => {
  const res = await new Promise((resolve, reject) => {
    http.get(`${srv.base}/`, { headers: { 'Accept-Encoding': 'gzip' } }, resolve).on('error', reject);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(res.headers.vary, 'Accept-Encoding');
  const chunks = []; for await (const c of res) chunks.push(c);
  assert.match(zlib.gunzipSync(Buffer.concat(chunks)).toString(), /<html/i);
  // Images are not recompressed.
  const img = await new Promise((resolve) => http.get(`${srv.base}/apple-touch-icon.png`, { headers: { 'Accept-Encoding': 'gzip' } }, resolve));
  img.resume();
  assert.equal(img.headers['content-encoding'], undefined);
});

test('the *.fly.dev host redirects to https://retrobooth.com.au', async () => {
  const get = (p, host) => new Promise((resolve) => http.get(`${srv.base}${p}`, { headers: { Host: host } }, (r) => { r.resume(); resolve(r); }));
  const r = await get('/venues/?a=1', 'retro-booth-site-mmim3a.fly.dev');
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location, 'https://retrobooth.com.au/venues/?a=1');
  const www = await get('/', 'www.retrobooth.com.au');
  assert.equal(www.headers.location, 'https://retrobooth.com.au/');
  // Health checks still answer on any host.
  assert.equal((await get('/healthz', 'retro-booth-site-mmim3a.fly.dev')).statusCode, 200);
  assert.equal((await get('/', 'retrobooth.com.au')).statusCode, 200);
});
