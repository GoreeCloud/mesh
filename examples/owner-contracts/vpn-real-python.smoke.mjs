// Hosted-CI-only source acceptance against the reviewed VPN Python alpha.
// Uses one disposable loopback child and private SQLite file. No live VPN
// interface, route, DNS, nftables, tunnel, production identity or deployment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createVPNHealthFixtureAdapter } from './vpn-healthz.mjs';

const EXPECTED_WIRE = '{"status":"ok","maturity":"alpha","component":"management"}';
const OBSERVED_AT = '2026-11-09T12:00:00.000Z';
const CAPABILITY = 'vpn.health';

async function choosePort() {
  const socket = createServer();
  await new Promise((done, fail) => {
    socket.once('error', fail);
    socket.listen(0, '127.0.0.1', done);
  });
  const port = socket.address().port;
  await new Promise((done, fail) => socket.close(err => err ? fail(err) : done()));
  assert.ok(port >= 1024 && port <= 65535);
  // This is not protection against an adversarial sibling process racing to bind.
  return port;
}

function startVPN(source, root, port, token) {
  const child = spawn('python3', [
    '-m', 'goreecloud_vpn.server', '--host', '127.0.0.1',
    '--port', String(port), '--db', join(root, 'state.db'),
  ], {
    env: {
      PYTHONPATH: join(source, 'src'),
      GOREECLOUD_VPN_ADMIN_TOKEN: token,
      PYTHONUNBUFFERED: '1',
    },
    cwd: root,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  return child;
}

async function stopVPN(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise(resolveDone => child.once('exit', () => resolveDone(true)));
  child.kill('SIGTERM');
  if (!(await Promise.race([done, sleep(1400).then(() => false)])) &&
      child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(resolveDone => child.once('exit', resolveDone)), sleep(900),
    ]);
  }
}

function loopback(port, path = '/healthz', token = '', origin = '') {
  assert.ok(['/healthz', '/api/v1/peers', '/api/v1/status'].includes(path));
  return new Promise((resolveResponse, reject) => {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (origin) headers.Origin = origin;
    const req = httpRequest({
      host: '127.0.0.1', family: 4, port, path,
      method: 'GET', agent: false, headers,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > (path === '/healthz' ? 256 : 4096)) {
          req.destroy(new Error('bounded source reply exceeded limit'));
        }
      });
      res.once('error', () => reject(new Error('source response unavailable')));
      res.once('end', () => resolveResponse({
        status: res.statusCode,
        contentType: res.headers['content-type'],
        body,
      }));
    });
    req.setTimeout(500, () => req.destroy(new Error('source deadline')));
    req.once('error', () => reject(new Error('source request unavailable')));
    req.end();
  });
}

async function main() {
  const source = resolve(process.argv[2] || '');
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REPOSITORY !== 'GoreeCloud/mesh' ||
      process.env.GC_MESH_VPN_ISOLATED_TEST !== '1' ||
      source !== resolve('vpn-source')) {
    throw new Error('only the isolated, exact-source GitHub CI contract may run');
  }
  assert.ok((await stat(join(source, 'src/goreecloud_vpn/server.py'))).isFile());
  const root = await mkdtemp(join(tmpdir(), 'mesh-vpn-source-'));
  await chmod(root, 0o700);
  const token = randomBytes(48).toString('hex');
  const port = await choosePort();
  let transportCalls = 0;
  let meshPermit = false;
  let ownerPermit = false;
  const adapter = createVPNHealthFixtureAdapter({
    permit: () => ownerPermit,
    clock: () => OBSERVED_AT,
    transport: async ({ method, path, signal }) => {
      if (method !== 'GET' || path !== '/healthz' || signal?.aborted) {
        throw new Error('invalid contract request');
      }
      transportCalls++;
      return loopback(port);
    },
  });
  const harness = createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION, environment: 'synthetic-local-only',
      capabilities: [{
        id: CAPABILITY, owner: 'vpn', version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
      }],
    },
    adapters: { [CAPABILITY]: adapter },
    meshPermit: () => meshPermit, timeoutMs: 750,
  });
  const read = () => harness.read({
    actor: 'synthetic-ci', capabilityId: CAPABILITY, operation: 'status.read',
  });
  let child;
  try {
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, 0);
    meshPermit = true;
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, 0);
    ownerPermit = true;
    child = startVPN(source, root, port, token);
    let online = false;
    for (let n = 0; n < 35; n++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      const result = await read();
      if (result.ok) {
        assert.deepEqual(result.data, { state: 'ok', observed_at: OBSERVED_AT });
        online = true;
        break;
      }
      await sleep(120);
    }
    assert.equal(online, true, 'reviewed VPN source did not become healthy');
    process.stdout.write('checkpoint=source_loopback_healthy\n');
    assert.equal((await loopback(port)).body, EXPECTED_WIRE);
    assert.equal((await loopback(port, '/api/v1/peers')).status, 401);
    assert.equal((await loopback(port, '/api/v1/status', 'wrong-token')).status, 401);
    assert.equal((await loopback(port, '/api/v1/status', token)).status, 200);
    assert.equal((await loopback(port, '/api/v1/status', token,
                                 'http://127.0.0.1')).status, 403);
    process.stdout.write('checkpoint=source_auth_boundaries\n');

    ownerPermit = false;
    const count = transportCalls;
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, count);
    ownerPermit = true;
    await stopVPN(child);
    process.stdout.write('checkpoint=source_stopped\n');
    assert.equal((await read()).error.code, 'unavailable');

    child = startVPN(source, root, port, token);
    let recovered = false;
    for (let n = 0; n < 35; n++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      if ((await read()).ok === true) {
        recovered = true;
        break;
      }
      await sleep(120);
    }
    assert.equal(recovered, true, 'disposable management process failed to restart');
    assert.equal((await loopback(port, '/api/v1/peers')).status, 401);
    process.stdout.write('PASS: pinned VPN Python management/ Mesh local read-only contract\n');
  } finally {
    await stopVPN(child);
    await rm(root, { recursive: true, force: true });
  }
}

await main();
