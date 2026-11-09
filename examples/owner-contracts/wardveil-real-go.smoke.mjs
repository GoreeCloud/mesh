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
import { createSyntheticReadObserver, EVIDENCE_VERSION } from '../synthetic/evidence.mjs';
import { manifest } from '../synthetic/fixtures.mjs';
import { createWardveilHealthFixtureAdapter } from './wardveil-healthz.mjs';
import { createLoopbackWardveilHealthTransport } from './wardveil-loopback.mjs';
import { createLoopbackWardveilStatusTransport } from './wardveil-status-loopback.mjs';
import { createWardveilScopedStatusAdapter } from './wardveil-status-v1.mjs';

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

function startWardveil(binary, dir, port, ingestToken, readToken, statusToken) {
  const child = spawn(binary, [], {
    cwd: dir,
    env: {
      WARDVEIL_LISTEN: '127.0.0.1:' + port,
      WARDVEIL_DATA_DIR: join(dir, 'journal'),
      WARDVEIL_INGEST_TOKEN: ingestToken,
      WARDVEIL_READ_TOKEN: readToken,
      WARDVEIL_STATUS_TOKEN: statusToken,
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

// Disposable GitHub-hosted child only: verify the service can reopen its
// synthetic private journal after an abrupt process termination. This does
// not validate recovery of a partially written event or a production crash.
async function killDisposableWardveil(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    throw new Error('disposable Wardveil child is not running');
  }
  const exit = new Promise(resolveDone => child.once('exit', (_code, signal) => resolveDone(signal)));
  if (!child.kill('SIGKILL')) {
    throw new Error('could not stop disposable Wardveil child');
  }
  const signal = await Promise.race([exit, sleep(2000).then(() => null)]);
  if (signal !== 'SIGKILL') {
    throw new Error('disposable Wardveil child did not exit after abrupt stop');
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

async function directProtectedRouteStatus(port, path, token = '', method = 'GET') {
  assert.ok(['/v1/events', '/v1/status'].includes(path));
  assert.ok(['GET', 'POST'].includes(method));
  return new Promise((resolveStatus, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', family: 4, port,
      method, path, agent: false,
      headers: token ? { Authorization: 'Bearer ' + token } : {},
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
  const statusToken = randomBytes(32).toString('hex');
  const rotatedStatusToken = randomBytes(32).toString('hex');
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
  const scopedHarness = token => createSyntheticHarness({
    manifest, meshPermit: () => meshAllowed, timeoutMs: 800,
    adapters: { [capabilityId]: createWardveilScopedStatusAdapter({
      transport: createLoopbackWardveilStatusTransport({ port, token, timeoutMs: 400 }),
      permit: () => ownerAllowed,
    }) },
  });
  const statusHarness = scopedHarness(statusToken);
  const scopedRead = h => read(h);
  // Opt-in outcome-only diagnostics; no log sink, actor IDs, tokens or payload.
  const observer = createSyntheticReadObserver(harness, { capacity: 2, maxInFlight: 2 });
  const observedRead = () => observer.read({ actor: 'synthetic-ci-reader', capabilityId });
  const outcomeList = () => observer.records().map(event => event.outcome);
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

    child = startWardveil(expectedBinary, root, port, ingestToken, readToken, statusToken);
    await awaitHealthy(child, harness, read);
    const scopedOk = await scopedRead(statusHarness);
    assert.equal(scopedOk.ok, true);
    assert.equal(scopedOk.data.state, 'ok');
    assert.ok(Math.abs(Date.now() - Date.parse(scopedOk.data.observed_at)) < 30_000);
    assert.notEqual(scopedOk.data.observed_at, clockValue);
    const firstEvidence = await observedRead();
    assert.equal(firstEvidence.response.ok, true);
    assert.match(firstEvidence.correlation_id, /^[a-f0-9-]{36}$/);
    assert.equal(observer.records()[0].schema_version, EVIDENCE_VERSION);
    assert.deepEqual(outcomeList(), ['ok']);

    // Real Go endpoint enforces three independently scoped credentials.
    assert.equal(await directProtectedRouteStatus(port, '/v1/events'), 401);
    assert.equal(await directProtectedRouteStatus(port, '/v1/status'), 401);
    assert.equal(await directProtectedRouteStatus(port, '/v1/status', readToken), 403);
    assert.equal(await directProtectedRouteStatus(port, '/v1/status', ingestToken), 403);
    assert.equal(await directProtectedRouteStatus(port, '/v1/events', statusToken), 403);
    assert.equal(await directProtectedRouteStatus(port, '/v1/events', statusToken, 'POST'), 403);

    // Revocation is checked per request, not cached after a previous success.
    ownerAllowed = false;
    const beforeRevocation = transportCalls;
    assert.equal((await read(harness)).error.code, 'denied');
    assert.equal(transportCalls, beforeRevocation);
    const revokedEvidence = await observedRead();
    assert.equal(revokedEvidence.response.error.code, 'denied');
    assert.equal(transportCalls, beforeRevocation);
    assert.deepEqual(outcomeList(), ['ok', 'denied']);
    assert.equal((await scopedRead(statusHarness)).error.code, 'denied');
    ownerAllowed = true;
    assert.equal((await read(harness)).data.state, 'ok');

    await stopWardveil(child);
    child = null;
    assert.equal((await read(harness)).error.code, 'unavailable');
    const downEvidence = await observedRead();
    assert.equal(downEvidence.response.error.code, 'unavailable');
    assert.deepEqual(outcomeList(), ['denied', 'unavailable']);
    assert.equal((await scopedRead(statusHarness)).error.code, 'unavailable');

    // The exact reviewed Go service must reopen its private journal and recover
    // after a graceful stop; this is not a destructive crash recovery test.
    child = startWardveil(expectedBinary, root, port, ingestToken, readToken, rotatedStatusToken);
    await awaitHealthy(child, harness, read);
    // The prior bearer is rejected by the *source* following a controlled
    // restart/credential rotation. No local callback is allowed to bypass it.
    assert.equal(await directProtectedRouteStatus(port, '/v1/status', statusToken), 403);
    assert.equal((await scopedRead(statusHarness)).error.code, 'unavailable');
    const rotated = await scopedRead(scopedHarness(rotatedStatusToken));
    assert.equal(rotated.ok, true);
    assert.equal(rotated.data.state, 'ok');
    assert.equal(await directProtectedRouteStatus(port, '/v1/events', rotatedStatusToken), 403);
    const recoveredEvidence = await observedRead();
    assert.equal(recoveredEvidence.response.ok, true);
    assert.deepEqual(outcomeList(), ['unavailable', 'ok']);
    const redacted = JSON.stringify(observer.records());
    assert.equal(redacted.includes(ingestToken), false);
    assert.equal(redacted.includes(readToken), false);
    assert.equal(redacted.includes(statusToken), false);
    assert.equal(redacted.includes(rotatedStatusToken), false);
    assert.equal(redacted.includes('synthetic-ci-reader'), false);
    assert.equal(redacted.includes('journal'), false);
    assert.deepEqual(Object.keys(observer.records()[0]).sort(), [
      'correlation_id', 'observed_at', 'outcome', 'schema_version',
    ]);
    observer.clear();
    assert.deepEqual(observer.records(), []);

    // Exercise abrupt failure separately from the earlier graceful restart.
    // There are no persisted synthetic events in this probe, so it proves
    // journal reopening and fresh authorization, not torn-write durability.
    await killDisposableWardveil(child);
    child = null;
    assert.equal((await scopedRead(scopedHarness(rotatedStatusToken))).error.code, 'unavailable');
    child = startWardveil(expectedBinary, root, port, ingestToken, readToken, rotatedStatusToken);
    await awaitHealthy(child, harness, read);
    const afterAbruptRestart = await scopedRead(scopedHarness(rotatedStatusToken));
    assert.equal(afterAbruptRestart.ok, true);
    assert.equal(afterAbruptRestart.data.state, 'ok');
    assert.equal(await directProtectedRouteStatus(port, '/v1/status', statusToken), 403);
    assert.equal(await directProtectedRouteStatus(port, '/v1/events', rotatedStatusToken), 403);

    console.log('PASS: actual Wardveil Go scoped status, token rotation, graceful and abrupt isolated restart, denial and bounded redacted outcomes');
  } finally {
    await stopWardveil(child);
    await rm(root, { recursive: true, force: true });
  }
}

await main();
