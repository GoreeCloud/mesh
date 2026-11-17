import test from 'node:test';
import assert from 'node:assert/strict';
import { createWardveilHealthFixtureAdapter, WARDVEIL_HEALTH_CONTRACT } from './wardveil-healthz.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const id = 'fixture.alpha.status';
const observed_at = '2026-11-09T00:00:00.000Z';
const response = (status, body) => ({
  status, contentType: 'application/json; charset=utf-8', body,
});
const healthy = response(200, '{"status":"ok"}\n');
const degraded = response(503, '{"error":"event ingestion unavailable"}\n');

function harness({ transport = async () => healthy, permit = () => true, clock = () => observed_at } = {}) {
  const adapter = createWardveilHealthFixtureAdapter({ transport, permit, clock });
  return createSyntheticHarness({
    manifest,
    adapters: { [id]: adapter },
    meshPermit: () => true,
    timeoutMs: 100,
  });
}
const read = h => h.read({ actor: 'fixture.reader', capabilityId: id, operation: 'status.read' });

test('contract pins Wardveil owner source, fixed method and health path', () => {
  assert.equal(WARDVEIL_HEALTH_CONTRACT.source, 'GoreeCloud/wardveil');
  assert.equal(WARDVEIL_HEALTH_CONTRACT.source_blob, 'e4d8d68a9a1ed5c2fb28c6fc9c6956c2027c548a');
  assert.equal(WARDVEIL_HEALTH_CONTRACT.method, 'GET');
  assert.equal(WARDVEIL_HEALTH_CONTRACT.path, '/healthz');
});

test('a trusted injected transport receives only the fixed read route and cancellation signal', async () => {
  let calls = 0;
  const h = harness({ transport: async request => {
    calls++;
    assert.deepEqual(Object.keys(request).sort(), ['method', 'path', 'signal']);
    assert.equal(request.method, 'GET');
    assert.equal(request.path, '/healthz');
    assert.equal(request.signal.aborted, false);
    return healthy;
  } });
  const result = await read(h);
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { state: 'ok', observed_at });
  assert.equal(result.evidence_status, 'prototype');
});

test('source-observed Wardveil 503 has degraded state, not success health', async () => {
  const result = await read(harness({ transport: async () => degraded }));
  assert.equal(result.ok, true);
  assert.equal(result.data.state, 'degraded');
  assert.equal(result.kind, 'synthetic_result');
});

test('default deny does not call transport until a separate policy permits', async () => {
  let calls = 0;
  const adapter = createWardveilHealthFixtureAdapter({ transport: async () => { calls++; return healthy; } });
  const h = createSyntheticHarness({
    manifest, meshPermit: () => true, adapters: { [id]: adapter },
  });
  assert.deepEqual(await read(h), { ok: false, error: { code: 'denied' } });
  assert.equal(calls, 0);
});

test('owner policy rejection or throw never invokes transport', async () => {
  let calls = 0;
  for (const permit of [() => false, () => { throw Error('private error'); }, () => 'true']) {
    const result = await read(harness({ permit, transport: async () => { calls++; return healthy; } }));
    assert.equal(result.error.code, 'denied');
  }
  assert.equal(calls, 0);
});

test('bad HTTP status, content type, response shape and unknown body fail closed', async () => {
  const invalid = [
    response(201, '{"status":"ok"}'), response(401, '{"status":"ok"}'),
    response(200, '{"status":"degraded"}'), response(503, '{"error":"other"}'),
    response(200, '{"status":"degraded","status":"ok"}'),
    response(200, '{"status":"ok","secret":"payload"}'),
    { ...healthy, contentType: 'text/html' },
    { ...healthy, body: 'x'.repeat(257) },
    { ...healthy, injected: true },
    null, [],
  ];
  for (const bad of invalid) {
    const result = await read(harness({ transport: async () => bad }));
    assert.equal(result.error.code, 'unavailable', JSON.stringify(bad));
  }
});

test('malicious response getters and proxy traps cannot be evaluated', async () => {
  let invoked = 0;
  const getter = Object.defineProperty({ ...healthy }, 'body', {
    get() { invoked++; throw Error('poisoned owner body'); },
  });
  const trap = new Proxy({}, { ownKeys() { throw Error('poisoned proxy'); } });
  for (const body of [getter, trap]) {
    assert.equal((await read(harness({ transport: async () => body }))).error.code, 'unavailable');
  }
  assert.equal(invoked, 0);
});

test('malicious adapter option getters are rejected before invocation', () => {
  let invoked = 0;
  const options = Object.defineProperty({ transport: async () => healthy }, 'permit', {
    get() { invoked++; return () => true; },
  });
  assert.throws(() => createWardveilHealthFixtureAdapter(options), TypeError);
  assert.equal(invoked, 0);
  for (const options of [null, [], {}, { transport: () => healthy, url: 'https://example.com' },
    new Proxy({}, { ownKeys() { throw Error('trap'); } })]) {
    assert.throws(() => createWardveilHealthFixtureAdapter(options), TypeError);
  }
});

test('transport failures, abort and invalid local clock never disclose payloads', async () => {
  assert.equal((await read(harness({ transport: () => { throw Error('secret token'); } }))).error.code, 'unavailable');
  assert.equal((await read(harness({ clock: () => 'bad date' }))).error.code, 'unavailable');
  const controller = new AbortController();
  controller.abort();
  const adapter = createWardveilHealthFixtureAdapter({
    transport: async () => healthy, permit: () => true,
  });
  assert.equal(await adapter.authorize('fixture.reader', {}, { signal: controller.signal }), false);
  await assert.rejects(adapter.readStatus({ signal: controller.signal }), /health probe unavailable/);
});
