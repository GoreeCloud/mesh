// CI-only source acceptance for the pinned genuine Go Gateway CONSOLE.
// Never contacts production Gateway/Caddy, ACME, DNS or public interfaces.
// Only an owned, disposable 127.0.0.1 child is started on an ephemeral port.
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
import { createGatewayHealthFixtureAdapter } from './gateway-healthz.mjs';

const CAPABILITY = 'gateway.health';
const OBSERVED_AT = '2026-11-10T12:00:00.000Z';
const BODY = '{"ok":true}\n';

async function choosePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  await new Promise((done, reject) => server.close(err => err ? reject(err) : done()));
  assert.ok(Number.isInteger(address.port) && address.port > 1023);
  return address.port;
}

function start(binary, directory, port, token) {
  const child = spawn(binary, ['-listen', '127.0.0.1:' + port], {
    cwd: directory,
    env: { GOREE_GATEWAY_CONSOLE_TOKEN: token },
    stdio: 'ignore',
  });
  child.on('error', () => {});
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(done => child.once('exit', () => done(true)));
  child.kill('SIGTERM');
  const done = await Promise.race([exited, sleep(1500).then(() => false)]);
  if (!done && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(done => child.once('exit', done)),
      sleep(900),
    ]);
  }
}

async function sourceRequest(port, path, { method = 'GET', token = '', origin = '' } = {}) {
  assert.ok(['/healthz', '/api/v1/overview'].includes(path));
  assert.ok(['GET', 'POST'].includes(method));
  return new Promise((resolveData, reject) => {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (origin) headers['Sec-Fetch-Site'] = origin;
    const req = httpRequest({
      host: '127.0.0.1', family: 4, port, path, method, headers, agent: false,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > 16384) {
          req.destroy(new Error('bounded local response exceeded limit'));
        }
      });
      res.once('error', () => reject(new Error('disposable source unavailable')));
      res.once('end', () => resolveData({
        status: res.statusCode,
        contentType: res.headers['content-type'],
        body,
      }));
    });
    req.setTimeout(500, () => req.destroy(new Error('source deadline')));
    req.once('error', () => reject(new Error('disposable source unavailable')));
    req.end();
  });
}

async function main() {
  const binary = process.argv[2];
  const expected = process.env.RUNNER_TEMP
    ? resolve(process.env.RUNNER_TEMP, 'gateway-console-dev') : '';
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REPOSITORY !== 'GoreeCloud/mesh' ||
      process.env.GC_MESH_GATEWAY_ISOLATED_TEST !== '1' ||
      !binary || resolve(binary) !== expected) {
    throw new Error('only the pinned reviewed CI Gateway console binary is allowed');
  }
  assert.ok((await stat(expected)).isFile());
  const directory = await mkdtemp(join(tmpdir(), 'mesh-gateway-'));
  await chmod(directory, 0o700);
  const token = randomBytes(48).toString('hex');
  const port = await choosePort();
  let meshAllowed = false;
  let ownerAllowed = false;
  let transportCalls = 0;
  const adapter = createGatewayHealthFixtureAdapter({
    permit: () => ownerAllowed,
    clock: () => OBSERVED_AT,
    transport: async ({ method, path, signal }) => {
      if (method !== 'GET' || path !== '/healthz' || signal?.aborted) {
        throw new Error('invalid source contract operation');
      }
      transportCalls++;
      return sourceRequest(port, '/healthz');
    },
  });
  const harness = createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION, environment: 'synthetic-local-only',
      capabilities: [{
        id: CAPABILITY, owner: 'gateway', version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
      }],
    },
    adapters: { [CAPABILITY]: adapter },
    meshPermit: () => meshAllowed,
    timeoutMs: 750,
  });
  const read = () => harness.read({
    actor: 'synthetic-ci', capabilityId: CAPABILITY, operation: 'status.read',
  });
  let child;
  try {
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, 0);
    meshAllowed = true;
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, 0);
    ownerAllowed = true;
    child = start(expected, directory, port, token);
    let healthy = false;
    for (let n = 0; n < 40; n++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      const result = await read();
      if (result.ok) {
        assert.deepEqual(result.data, { state: 'ok', observed_at: OBSERVED_AT });
        healthy = true;
        break;
      }
      await sleep(100);
    }
    assert.ok(healthy, 'reviewed Gateway console did not start on isolated loopback');
    const live = await sourceRequest(port, '/healthz');
    assert.equal(live.status, 200);
    assert.equal(live.contentType, 'application/json; charset=utf-8');
    assert.equal(live.body, BODY);
    assert.equal((await sourceRequest(port, '/healthz', { method: 'POST' })).status, 405);
    assert.equal((await sourceRequest(port, '/api/v1/overview')).status, 401);
    assert.equal((await sourceRequest(port, '/api/v1/overview',
      { token: 'incorrect' })).status, 401);
    assert.equal((await sourceRequest(port, '/api/v1/overview',
      { token, method: 'POST' })).status, 405);
    assert.equal((await sourceRequest(port, '/api/v1/overview',
      { token, origin: 'cross-site' })).status, 403);
    // This valid-token call may return "unreachable" because the pinned
    // console's default local admin API is NOT started. Never confuse
    // successful console auth with live Caddy ingress/route availability.
    const authorized = await sourceRequest(port, '/api/v1/overview', { token });
    assert.equal(authorized.status, 200);
    const projection = JSON.parse(authorized.body);
    assert.ok(['unreachable', 'connected'].includes(projection.state));
    assert.equal(projection.api_version, 'v1');
    assert.equal('raw_config' in projection, false);

    ownerAllowed = false;
    const priorCalls = transportCalls;
    assert.equal((await read()).error.code, 'denied');
    assert.equal(transportCalls, priorCalls);
    ownerAllowed = true;
    await stop(child);
    assert.equal((await read()).error.code, 'unavailable');
    child = start(expected, directory, port, token);
    let recovered = false;
    for (let n = 0; n < 40; n++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      if ((await read()).ok) {
        recovered = true;
        break;
      }
      await sleep(100);
    }
    assert.ok(recovered, 'disposable Gateway console did not recover after restart');
    process.stdout.write('PASS: pinned Gateway console/Mesh local liveness and denial\n');
  } finally {
    await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
