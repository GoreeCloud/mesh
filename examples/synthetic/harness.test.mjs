import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticHarness, validateManifest } from './harness.mjs';
import { createFixtureHarness, manifest } from './fixtures.mjs';

const capabilityId = 'fixture.alpha.status';
const status = () => ({ state: 'ok', observed_at: '2026-10-26T00:00:00.000Z' });
const fixtureAdapter = (overrides = {}) => ({
  authorize: () => true,
  readStatus: async () => status(),
  ...overrides,
});
function harness(overrides = {}) {
  return createSyntheticHarness({
    manifest,
    adapters: { [capabilityId]: fixtureAdapter() },
    meshPermit: () => true,
    ...overrides,
  });
}
const read = (h, actor = 'fixture.reader', id = capabilityId, operation = 'status.read') =>
  h.read({ actor, capabilityId: id, operation });

test('discovery remains a bounded, non-authorizing prototype inventory', async () => {
  const h = createFixtureHarness();
  const catalog = h.discover();
  assert.equal(catalog.length, 2);
  assert(catalog.every(c => c.evidence_status === 'prototype' && c.sensitivity === 'synthetic'));
  catalog[0].evidence_status = 'verified';
  assert.equal(h.discover()[0].evidence_status, 'prototype');
  assert.deepEqual(await read(h, 'fixture.stranger'), { ok: false, error: { code: 'denied' } });
});

test('success is explicitly synthetic, not a product health assertion', async () => {
  const result = await read(createFixtureHarness());
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'synthetic_result');
  assert.equal(result.evidence_status, 'prototype');
  assert.deepEqual(result.data, status());
});

test('unknown capabilities and mutation operations are unsupported', async () => {
  const h = harness();
  assert.equal((await read(h, 'fixture.reader', 'unlisted.service')).error.code, 'unsupported');
  assert.equal((await read(h, 'fixture.reader', capabilityId, 'status.write')).error.code, 'unsupported');
});

test('malformed and hostile request envelopes return typed denial instead of throwing', async () => {
  const h = harness();
  const hostile = new Proxy({}, { ownKeys() { throw new Error('untrusted request trap'); } });
  const accessor = Object.defineProperty({ capabilityId, operation: 'status.read' }, 'actor', {
    enumerable: true,
    get() { throw new Error('untrusted actor getter'); },
  });
  for (const request of [null, [], 'untrusted', 42, hostile, accessor,
    { actor: 'fixture.reader', capabilityId, payload: 'not a declared field' }]) {
    assert.deepEqual(await h.read(request), { ok: false, error: { code: 'unsupported' } });
  }
});

test('request inspection rejects accessors and hidden fields without evaluating them', async () => {
  const h = harness();
  let getterCalls = 0;
  const accessor = Object.defineProperty({ capabilityId }, 'actor', {
    enumerable: true,
    get() { getterCalls++; return 'fixture.reader'; },
  });
  assert.equal((await h.read(accessor)).error.code, 'unsupported');
  assert.equal(getterCalls, 0, 'request getters must not execute');
  const normal = { actor: 'fixture.reader', capabilityId, operation: 'status.read' };
  const hidden = Object.defineProperty({ ...normal }, 'secret', { value: 'never accepted' });
  const symbol = { ...normal, [Symbol('secret')]: 'never accepted' };
  for (const envelope of [hidden, symbol]) {
    assert.equal((await h.read(envelope)).error.code, 'unsupported');
  }
});

test('Mesh and owner both independently default deny', async () => {
  let ownerCalls = 0;
  const adapters = { [capabilityId]: fixtureAdapter({
    authorize: () => { ownerCalls += 1; return true; },
  }) };
  assert.equal((await read(harness({ adapters, meshPermit: () => false }))).error.code, 'denied');
  assert.equal(ownerCalls, 0);
  assert.equal((await read(harness({ adapters, meshPermit: () => { throw new Error('no'); } }))).error.code, 'denied');
  assert.equal(ownerCalls, 0);
  assert.equal((await read(harness({ adapters: { [capabilityId]: fixtureAdapter({ authorize: () => false }) } }))).error.code, 'denied');
  assert.equal((await read(harness({ adapters: { [capabilityId]: fixtureAdapter({ authorize: () => { throw Error('no'); } }) } }))).error.code, 'denied');
  assert.equal((await read(harness({ meshPermit: () => undefined }))).error.code, 'denied');
  assert.equal((await read(harness(), '../invalid')).error.code, 'denied');
});

test('unavailable owner and owner read errors never become success', async () => {
  assert.equal((await read(harness({ adapters: {} }))).error.code, 'unavailable');
  assert.equal((await read(harness({ adapters: { [capabilityId]: fixtureAdapter({ readStatus: () => { throw Error('offline'); } }) } }))).error.code, 'unavailable');
});

test('invalid, unexpected and oversized owner responses fail closed', async () => {
  const invalid = [
    { state: 'ok', observed_at: 'not-a-date' },
    { state: 'ok', observed_at: status().observed_at, secret: 'not allowed' },
    { state: 'unknown', observed_at: status().observed_at },
    ['ok'],
    null,
    new Proxy({}, { ownKeys() { throw Error('hostile source object'); } }),
  ];
  for (const value of invalid) {
    const h = harness({ adapters: { [capabilityId]: fixtureAdapter({ readStatus: async () => value }) } });
    assert.equal((await read(h)).error.code, 'invalid_response');
  }
  const capped = harness({
    maxResponseBytes: 60,
    adapters: { [capabilityId]: fixtureAdapter({ readStatus: async () => ({ ...status(), state: 'degraded' }) }) },
  });
  assert.equal((await read(capped)).error.code, 'invalid_response');
});

test('hung owner decisions and reads have bounded typed timeouts', async () => {
  const never = () => new Promise(() => {});
  const auth = harness({ timeoutMs: 15, meshPermit: never });
  assert.equal((await read(auth)).error.code, 'timed_out');
  const operation = harness({ timeoutMs: 15, adapters: { [capabilityId]: fixtureAdapter({ readStatus: never }) } });
  assert.equal((await read(operation)).error.code, 'timed_out');
});

test('stale, duplicate or non-synthetic manifests are rejected before use', () => {
  const wrong = [
    { ...manifest, schema_version: 'mesh.capabilities.v0' },
    { ...manifest, environment: 'production' },
    { ...manifest, capabilities: [...manifest.capabilities, manifest.capabilities[0]] },
    { ...manifest, capabilities: [{ ...manifest.capabilities[0], operation: 'status.write' }] },
    { ...manifest, capabilities: [{ ...manifest.capabilities[0], evidence_status: 'verified' }] },
    { ...manifest, capabilities: [{ ...manifest.capabilities[0], secret: 'accidental' }] },
    { ...manifest, capabilities: [] },
    { ...manifest, capabilities: Array(33).fill(manifest.capabilities[0]) },
  ];
  for (const value of wrong) assert.throws(() => validateManifest(value), TypeError);
  assert.throws(() => createSyntheticHarness({ manifest, timeoutMs: 0 }), TypeError);
  assert.throws(() => createSyntheticHarness({ manifest, maxResponseBytes: 100000 }), TypeError);
  assert.equal(validateManifest(manifest).length, 2);
});

test('source-controlled accessors cannot change a validated status after inspection', async () => {
  let getterCalls = 0;
  const accessorStatus = {
    get state() { getterCalls += 1; return getterCalls === 1 ? 'ok' : 'degraded'; },
    observed_at: status().observed_at,
  };
  const adapter = fixtureAdapter({ readStatus: async () => accessorStatus });
  const result = await read(harness({ adapters: { [capabilityId]: adapter } }));
  assert.deepEqual(result, { ok: false, error: { code: 'invalid_response' } });
  assert.equal(getterCalls, 0, 'untrusted getters must not be invoked');

  const hidden = { ...status() };
  Object.defineProperty(hidden, 'secret', { value: 'unapproved', enumerable: false });
  const withSymbol = { ...status(), [Symbol('secret')]: 'unapproved' };
  for (const value of [hidden, withSymbol]) {
    const response = await read(harness({
      adapters: { [capabilityId]: fixtureAdapter({ readStatus: async () => value }) },
    }));
    assert.equal(response.error.code, 'invalid_response');
  }
});

test('owner data is captured once and returned as inert primitives', async () => {
  const source = status();
  const result = await read(harness({
    adapters: { [capabilityId]: fixtureAdapter({ readStatus: async () => source }) },
  }));
  assert.equal(result.ok, true);
  source.state = 'degraded';
  assert.deepEqual(result.data, status(), 'the returned result must not alias owner-controlled data');
});
