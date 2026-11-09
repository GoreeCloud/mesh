// One-shot GitHub Actions acceptance check for a reviewed, SHA-pinned Wardveil
// Go development binary. It launches only an isolated ephemeral 127.0.0.1 service.
// Not part of npm test, no deployment/telemetry, no production secrets or data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';
import { createWardveilHealthFixtureAdapter } from './wardveil-healthz.mjs';
import { createLoopbackWardveilHealthTransport } from './wardveil-loopback.mjs';

const capabilityId = 'fixture.alpha.status';
const clockValue = '2026-11-09T00:00:00.000Z';

async function pickUnprivilegedLoopbackPort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  await new Promise((resolveDone, reject) => server.close(err => err ? reject(err) : resolveDone()));
  assert.ok(Number.isInteger(address.port) && address.port >= 1024);
  // The service rebinds this port immediately; the test is not a port-locking
  // guarantee against a malicious, competing process on the same CI runner.
  return address.port;
}

function startWardveil(binary, dir, port, ingestToken, readToken) {
  const child = spawn(binary, [], {
    cwd: dir,
    env: {
      WARDVEIL_LISTEN: '127.0.0.1:' + port,
      WARDVEIL_DATA_DIR: join(dir, 'journal'),
      WARDVEIL_INGEST_TOKEN: ingestToken,
      WARDVEIL_READ_TOKEN: readToken,
    },
    stdio: 'ignore',
  });
  // Never forward a service log, environment, private token or journal content.
  child.on('error', () => {});
  return child;
}

async function stopWardveil(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolveDone => child.once('exit', () => resolveDone(true))),
    sleep(1800).then(() => false),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(resolveDone => child.once('exit', resolveDone)),
      sleep(1200),
    ]);
  }
}

async function awaitHealthy(child, harness, read) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('reviewed Wardveil Go development process exited before health acceptance');
    }
    const result = await read(harness);
    if (result.ok === true) {
      assert.deepEqual(result.data, { state: 'ok', observed_at: clockValue });
      return;
    }
    await sleep(80);
  }
  throw new Error('reviewed Wardveil Go development process did not become healthy on loopback');
}

async function unauthenticatedEventRouteStatus(port) {
  return new Promise((resolveStatus, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', family: 4, port,
      method: 'GET', path: '/v1/events', agent: false,
    }, res => {
      const status = res.statusCode;
      // Do not ingest or log an event body. This request sends no token.
      res.resume();
      res.once('end', () => resolveStatus(status));
      res.once('error', () => reject(new Error('unauthenticated route request failed')));
    });
    req.setTimeout(500, () => req.destroy());
    req.once('error', () => reject(new Error('unauthenticated route request failed')));
    req.end();
  });
}

async function main() {
  const binary = process.argv[2];
  const expectedBinary = process.env.RUNNER_TEMP
    ? resolve(process.env.RUNNER_TEMP, 'wardveil-dev') : '';
  if (process.env.GITHUB_ACTIONS !== 'true' || !binary ||
      resolve(binary) !== expectedBinary) {
    throw new Error('this smoke only accepts the reviewed build in a disposable GitHub runner');
  }
  assert.ok((await stat(expectedBinary)).isFile());

  const root = await mkdtemp(join(tmpdir(), 'mesh-wardveil-'));
  await chmod(root, 0o700);
  const ingestToken = randomBytes(32).toString('hex');
  const readToken = randomBytes(32).toString('hex');
  const port = await pickUnprivilegedLoopbackPort();
  const sourceTransport = createLoopbackWardveilHealthTransport({ port, timeoutMs: 400 });
  let transportCalls = 0;
  const transport = (...args) => { transportCalls++; return sourceTransport(...args); };
  let meshAllowed = true;
  let ownerAllowed = true;
  const adapter = createWardveilHealthFixtureAdapter({
    transport, permit: () => ownerAllowed, clock: () => clockValue,
  });
  const harness = createSyntheticHarness({
    manifest,
    adapters: { [capabilityId]: adapter },
    meshPermit: () => meshAllowed,
    timeoutMs: 800,
  });
  const read = h => h.read({ actor: 'synthetic-ci-reader', capabilityId });
  let child;

  try {
    // A denied Mesh request must perform zero owner-side transport calls.
    meshAllowed = false;
    const beforeMeshDeny = transportCalls;
    assert.equal((await read(harness)).error.code, 'denied');
    assert.equal(transportCalls, beforeMeshDeny);
    meshAllowed = true;

    // A denied source policy must also avoid even a loopback socket attempt.
    ownerAllowed = false;
    const beforeOwnerDeny = transportCalls;
    assert.equal((await read(harness)).error.code, 'denied');
    assert.equal(transportCalls, beforeOwnerDeny);
    ownerAllowed = true;

    child = startWardveil(expectedBinary, root, port, ingestToken, readToken);
    await awaitHealthy(child, harness, read);

    assert.equal(await unauthenticatedEventRouteStatus(port), 401);

    // Revocation is checked per request, not cached after a previous success.
    ownerAllowed = false;
    const beforeRevocation = transportCalls;
    assert.equal((await read(harness)).error.code, 'denied');
    assert.equal(transportCalls, beforeRevocation);
    ownerAllowed = true;
    assert.equal((await read(harness)).data.state, 'ok');

    await stopWardveil(child);
    child = null;
    assert.equal((await read(harness)).error.code, 'unavailable');

    // The exact reviewed Go service must reopen its private journal and recover
    // after a graceful stop; this is not a destructive crash recovery test.
    child = startWardveil(expectedBinary, root, port, ingestToken, readToken);
    await awaitHealthy(child, harness, read);
    console.log('PASS: reviewed Wardveil Go service /healthz + Mesh default deny, revocation, outage and restart (isolated CI loopback)');
  } finally {
    await stopWardveil(child);
    await rm(root, { recursive: true, force: true });
  }
}

await main();
