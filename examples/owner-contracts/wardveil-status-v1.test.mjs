import test from 'node:test';
import assert from 'node:assert/strict';
import { createWardveilScopedStatusAdapter, WARDVEIL_STATUS_VERSION } from './wardveil-status-v1.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const stamp = '2026-11-09T21:00:00.000Z';
const stampMs = Date.parse(stamp);
const body = (state, at = stamp) =>
  '{"schema_version":"wardveil.status.v1","state":"' + state + '","observed_at":"' + at + '"}\n';
const response = (state, at = stamp) => ({
  status: state === 'ok' ? 200 : 503,
  contentType: 'application/json; charset=utf-8',
  body: body(state, at),
});
const fixture = (transport, permit = () => true) =>
  createSyntheticHarness({
    manifest, meshPermit: () => true, timeoutMs: 150,
    adapters: { 'fixture.alpha.status': createWardveilScopedStatusAdapter({
      transport, permit, clock: () => stampMs,
    }) },
  });
const read = h => h.read({ actor: 'synthetic.reader', capabilityId: 'fixture.alpha.status' });

test('versioned owner contract is not an arbitrary event-read route', async () => {
  assert.equal(WARDVEIL_STATUS_VERSION, 'wardveil.status.v1');
  let called = 0;
  const h = fixture(async input => {
    called++;
    assert.deepEqual(Object.keys(input).sort(), ['method', 'path', 'signal']);
    assert.equal(input.method, 'GET');
    assert.equal(input.path, '/v1/status');
    assert.equal(input.signal.aborted, false);
    return response('ok');
  });
  const result = await read(h);
  assert.equal(called, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { state: 'ok', observed_at: stamp });
  assert.equal(result.evidence_status, 'prototype');
});

test('source-owned degraded 503 is distinguished from outage', async () => {
  const result = await read(fixture(async () => response('degraded')));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { state: 'degraded', observed_at: stamp });
});

test('local permit defaults to deny before transport and accepts only literal true', async () => {
  let calls = 0;
  const defaultDeny = createWardveilScopedStatusAdapter({
    transport: () => { calls++; return response('ok'); },
  });
  const h = createSyntheticHarness({
    manifest, meshPermit: () => true,
    adapters: { 'fixture.alpha.status': defaultDeny },
  });
  assert.equal((await read(h)).error.code, 'denied');
  for (const permit of [() => false, () => 'true', () => { throw new Error('private'); }]) {
    assert.equal((await read(fixture(() => { calls++; return response('ok'); }, permit))).error.code, 'denied');
  }
  assert.equal(calls, 0);
});

test('schema drift, duplicate JSON, wrong status and reflected private data fail closed', async () => {
  const invalid = [
    { ...response('ok'), status: 202 },
    { ...response('ok'), status: 503 },
    { ...response('degraded'), status: 200 },
    { ...response('ok'), contentType: 'text/plain' },
    { ...response('ok'), body: '{"schema_version":"wardveil.status.v1","state":"ok","state":"degraded","observed_at":"' + stamp + '"}\n' },
    { ...response('ok'), body: '{"schema_version":"wardveil.status.v2","state":"ok","observed_at":"' + stamp + '"}\n' },
    { ...response('ok'), body: '{"schema_version":"wardveil.status.v1","state":"ok","observed_at":"' + stamp + '","secrets":"private"}\n' },
    { ...response('ok'), body: '{"state":"ok","schema_version":"wardveil.status.v1","observed_at":"' + stamp + '"}\n' },
    { ...response('ok'), body: body('invalid') },
    { ...response('ok'), body: 'x'.repeat(257) },
    { ...response('ok'), extra: true },
    {}, null,
  ];
  for (const bad of invalid) {
    const result = await read(fixture(async () => bad));
    assert.equal(result.error.code, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  }
});

test('stale, future, invalid and impossible source timestamps never become healthy', async () => {
  const invalid = [
    '2026-11-09T20:59:29.000Z',
    '2026-11-09T21:00:31.000Z',
    '2026-11-09T21:00:00.00Z',
    '2026-02-30T21:00:00.000Z',
    'not-a-time',
  ];
  for (const observedAt of invalid) {
    const result = await read(fixture(async () => response('ok', observedAt)));
    assert.equal(result.error.code, 'unavailable');
  }
  const good = await read(fixture(async () => response('ok', '2026-11-09T21:00:30.000Z')));
  assert.equal(good.ok, true);
});

test('malicious response/accessor options never invoke getters or leak exceptions', async () => {
  let calls = 0;
  const poison = Object.defineProperty({ ...response('ok') }, 'body', {
    get() { calls++; throw Error('private bearer'); },
  });
  const trap = new Proxy({}, { ownKeys() { throw Error('private proxy'); } });
  for (const resultBody of [poison, trap]) {
    assert.equal((await read(fixture(async () => resultBody))).error.code, 'unavailable');
  }
  const opt = Object.defineProperty({}, 'transport', {
    get() { calls++; return () => response('ok'); },
  });
  for (const value of [opt, {}, null, [], { transport: () => response('ok'), url: 'http://evil' }, trap]) {
    assert.throws(() => createWardveilScopedStatusAdapter(value), TypeError);
  }
  assert.equal(calls, 0);
});

test('clock error and abort return only fixed unavailable result', async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = createWardveilScopedStatusAdapter({ transport: async () => response('ok') });
  await assert.rejects(adapter.readStatus({ signal: controller.signal }), /scoped status unavailable/);
  assert.equal(await adapter.authorize('actor', {}, { signal: controller.signal }), false);
  const bad = createWardveilScopedStatusAdapter({
    transport: async () => response('ok'), permit: () => true, clock: () => { throw Error('private'); },
  });
  await assert.rejects(bad.readStatus(), /scoped status unavailable/);
});
