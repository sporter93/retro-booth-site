// Tests for server.js. No dependencies: run with `node --test`.
// Each test starts the real server as a child process on a free port.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stop, raw } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await stop(srv); });

test('malformed request target returns 400 and the server stays up', async () => {
  const res = await raw(srv.port, 'GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match(res, /^HTTP\/1\.1 400 /);
  assert.equal(srv.child.exitCode, null, 'server process exited: ' + srv.output());
  const ok = await fetch(`${srv.base}/healthz`);
  assert.equal(ok.status, 200);
});

test('a client aborting an enquiry upload does not crash the server', async () => {
  await raw(srv.port, 'POST /api/enquiry HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 5000\r\n\r\nname=half');
  const ok = await fetch(`${srv.base}/healthz`);
  assert.equal(ok.status, 200);
  assert.equal(srv.child.exitCode, null);
});

test('static pages, 404 and healthz still work', async () => {
  assert.equal((await fetch(`${srv.base}/`)).status, 200);
  assert.equal((await fetch(`${srv.base}/privacy/`)).status, 200);
  assert.equal((await fetch(`${srv.base}/no-such-page`)).status, 404);
  assert.equal(await (await fetch(`${srv.base}/healthz`)).text(), 'ok');
});
