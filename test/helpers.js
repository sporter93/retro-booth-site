// Shared helpers for the server tests.
'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + output)), 5000);
    child.stdout.on('data', () => { if (output.includes(`:${port}`)) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  return { port, child, output: () => output, base: `http://127.0.0.1:${port}` };
}

function stop(srv) {
  return new Promise((resolve) => {
    if (srv.child.exitCode !== null) return resolve();
    srv.child.on('exit', resolve);
    srv.child.kill();
  });
}

// Send raw bytes and return the raw response (or '' if the socket died).
function raw(port, payload) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    let data = '';
    sock.on('data', (d) => { data += d; });
    sock.on('error', () => resolve(data));
    sock.on('close', () => resolve(data));
    sock.write(payload);
    setTimeout(() => sock.end(), 300);
  });
}

module.exports = { startServer, stop, raw };
