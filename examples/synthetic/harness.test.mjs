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
