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

test('timed-out Mesh authorization cannot start late owner work', async () => {
  let resolvePermit;
  let ownerCalls = 0;
  const delayed = new Promise(resolve => { resolvePermit = resolve; });
  const h = harness({
    timeoutMs: 15,
    meshPermit: () => delayed,
    adapters: { [capabilityId]: fixtureAdapter({
      authorize: () => { ownerCalls++; return true; },
    }) },
  });
  assert.equal((await read(h)).error.code, 'timed_out');
  resolvePermit(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ownerCalls, 0, 'timed-out requests must not invoke owner authorization');
});

test('timed-out owner authorization cannot start late owner reads', async () => {
  let resolveOwner;
  let readCalls = 0;
  const delayed = new Promise(resolve => { resolveOwner = resolve; });
  const h = harness({
    timeoutMs: 15,
    adapters: { [capabilityId]: fixtureAdapter({
      authorize: () => delayed,
      readStatus: () => { readCalls++; return status(); },
    }) },
  });
  assert.equal((await read(h)).error.code, 'timed_out');
  resolveOwner(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readCalls, 0, 'timed-out requests must not invoke owner reads');
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

test('hostile adapter registry prototype traps yield a generic construction error', () => {
  let trapCalls = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      trapCalls++;
      throw new Error('sensitive owner registry detail');
    },
  });
  assert.throws(
    () => harness({ adapters: hostile }),
    error => error instanceof TypeError && error.message === 'invalid synthetic harness options',
  );
  assert.equal(trapCalls, 1, 'validation may inspect the registry but never authorize an owner');
});

test('untrusted adapter descriptors fail closed without calling registry getters or throwing', async () => {
  let getterCalls = 0;
  const registry = Object.defineProperty({}, capabilityId, {
    enumerable: true,
    get() { getterCalls++; throw Error('untrusted registration getter'); },
  });
  const fromGetter = await read(harness({ adapters: registry }));
  assert.deepEqual(fromGetter, { ok: false, error: { code: 'unavailable' } });
  assert.equal(getterCalls, 0, 'registration getter must never run');

  const hostileRegistry = new Proxy({}, {
    getOwnPropertyDescriptor() { throw Error('registry proxy trap'); },
  });
  assert.equal((await read(harness({ adapters: hostileRegistry }))).error.code, 'unavailable');

  const hostileAdapter = new Proxy({}, {
    ownKeys() { throw Error('adapter proxy trap'); },
  });
  assert.equal((await read(harness({ adapters: { [capabilityId]: hostileAdapter } }))).error.code, 'unavailable');
});

test('owner accessors and inherited functions cannot masquerade as approved adapter methods', async () => {
  let getterCalls = 0;
  const authorizeGetter = Object.defineProperty({ readStatus: async () => status() }, 'authorize', {
    enumerable: true,
    get() { getterCalls++; return () => true; },
  });
  const readGetter = Object.defineProperty({ authorize: () => true }, 'readStatus', {
    enumerable: true,
    get() { getterCalls++; return async () => status(); },
  });
  const inherited = Object.create({ authorize: () => true, readStatus: async () => status() });
  for (const adapter of [authorizeGetter, readGetter, inherited]) {
    const response = await read(harness({ adapters: { [capabilityId]: adapter } }));
    assert.equal(response.error.code, 'unavailable');
  }
  assert.equal(getterCalls, 0, 'owner adapter getters must never run');
});

test('method snapshot preserves adapter receiver and cannot be swapped mid-authorization', async () => {
  const adapter = {
    allowed: true,
    authorize() {
      this.readStatus = () => { throw Error('method changed after authorization'); };
      return this.allowed;
    },
    async readStatus() { return status(); },
  };
  const result = await read(harness({ adapters: { [capabilityId]: adapter } }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, status());
});

test('manifest snapshots reject getters without executing them', () => {
  let getterCalls = 0;
  const parentGetter = Object.defineProperty({ ...manifest }, 'schema_version', {
    enumerable: true,
    get() { getterCalls++; return 'mesh.capabilities.v1'; },
  });
  const arrayGetter = [...manifest.capabilities];
  Object.defineProperty(arrayGetter, '0', {
    enumerable: true,
    get() { getterCalls++; return manifest.capabilities[0]; },
  });
  const capGetter = Object.defineProperty({ ...manifest.capabilities[0] }, 'id', {
    enumerable: true,
    get() { getterCalls++; return capabilityId; },
  });
  for (const invalid of [
    parentGetter,
    { ...manifest, capabilities: arrayGetter },
    { ...manifest, capabilities: [capGetter] },
  ]) {
    assert.throws(() => validateManifest(invalid), TypeError);
  }
  assert.equal(getterCalls, 0, 'manifest getters must not execute');
});

test('proxy traps, undeclared array data and sparse manifests fail closed', () => {
  const throwing = new Proxy({}, {
    ownKeys() { throw Error('manifest proxy trap'); },
  });
  const throwingCapability = new Proxy({}, {
    ownKeys() { throw Error('capability proxy trap'); },
  });
  const sparse = new Array(2);
  sparse[0] = manifest.capabilities[0];
  const extra = [...manifest.capabilities];
  extra.hidden = 'unexpected';
  const symbol = [...manifest.capabilities];
  symbol[Symbol('hidden')] = true;
  for (const invalid of [
    throwing,
    { ...manifest, capabilities: [throwingCapability] },
    { ...manifest, capabilities: sparse },
    { ...manifest, capabilities: extra },
    { ...manifest, capabilities: symbol },
  ]) {
    assert.throws(() => validateManifest(invalid), TypeError);
  }
});

test('validated discovery cannot be changed through original manifest mutation', () => {
  const mutable = {
    ...manifest,
    capabilities: manifest.capabilities.map(capability => ({ ...capability })),
  };
  const h = createSyntheticHarness({ manifest: mutable });
  const before = h.discover();
  mutable.capabilities[0].owner = 'fixture.changed';
  mutable.capabilities[0].evidence_status = 'verified';
  mutable.capabilities.splice(0, 1);
  assert.deepEqual(h.discover(), before);
  assert.equal(h.discover()[0].evidence_status, 'prototype');
});

test('harness options reject getters, symbols and proxy traps before evaluating them', () => {
  let invoked = 0;
  const options = {
    manifest,
    adapters: { [capabilityId]: fixtureAdapter() },
    meshPermit: () => true,
  };
  for (const field of ['manifest', 'adapters', 'meshPermit', 'timeoutMs', 'maxResponseBytes']) {
    const poisoned = Object.defineProperty({ ...options }, field, {
      enumerable: true,
      get() { invoked++; throw Error('untrusted configuration getter'); },
    });
    assert.throws(() => createSyntheticHarness(poisoned), TypeError);
  }
  assert.equal(invoked, 0, 'construction must not invoke outer-option getters');
  const throwing = new Proxy({}, { ownKeys() { throw Error('options proxy trap'); } });
  const symbol = { ...options, [Symbol('hidden')]: true };
  const hidden = Object.defineProperty({ ...options }, 'secret', { value: 'unapproved' });
  const inherited = Object.create({ manifest });
  for (const invalid of [throwing, symbol, hidden, inherited, null, []]) {
    assert.throws(() => createSyntheticHarness(invalid), TypeError);
  }
});

test('explicit undefined options retain safe default behavior', async () => {
  const h = createSyntheticHarness({
    manifest,
    adapters: { [capabilityId]: fixtureAdapter() },
    meshPermit: () => true,
    timeoutMs: undefined,
    maxResponseBytes: undefined,
  });
  const result = await read(h);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, status());
  const defaultDeny = createSyntheticHarness({ manifest, meshPermit: undefined });
  assert.equal((await read(defaultDeny)).error.code, 'denied');
});

test('native admission never starts an excess Mesh permit or owner call', async () => {
  let permitStarted;
  let permitRelease;
  const entered = new Promise(resolve => { permitStarted = resolve; });
  const blocked = new Promise(resolve => { permitRelease = resolve; });
  let permitCalls = 0;
  let ownerCalls = 0;
  const h = harness({
    maxConcurrentReads: 1,
    timeoutMs: 1000,
    meshPermit: async () => {
      permitCalls++;
      if (permitCalls === 1) { permitStarted(); await blocked; }
      return true;
    },
    adapters: { [capabilityId]: fixtureAdapter({
      readStatus: async () => { ownerCalls++; return status(); },
    }) },
  });
  const first = read(h);
  await entered;
  assert.deepEqual(await read(h), { ok: false, error: { code: 'unavailable' } });
  assert.equal(permitCalls, 1, 'over-capacity reads must not even call Mesh policy');
  assert.equal(ownerCalls, 0);
  permitRelease();
  assert.equal((await first).ok, true);
  assert.equal((await read(h)).ok, true, 'completed reads release the slot');
  assert.equal(ownerCalls, 2);
});

test('native admission releases capacity after a noncooperative timed-out owner read', async () => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const h = harness({
    maxConcurrentReads: 1,
    timeoutMs: 20,
    adapters: { [capabilityId]: fixtureAdapter({
      readStatus: () => {
        calls++;
        if (calls === 1) entered();
        return new Promise(() => {});
      },
    }) },
  });
  const first = read(h);
  await started;
  assert.equal((await read(h)).error.code, 'unavailable');
  assert.equal((await first).error.code, 'timed_out');
  assert.equal((await read(h)).error.code, 'timed_out', 'slot is reusable even if adapter ignores cancellation');
  assert.equal(calls, 2);
});

test('native admission rejects out-of-bounds limits while preserving explicit defaults', async () => {
  for (const maxConcurrentReads of [0, -1, 1.5, 33, '8', Infinity]) {
    assert.throws(() => harness({ maxConcurrentReads }), TypeError);
  }
  assert.equal((await read(harness({ maxConcurrentReads: undefined }))).ok, true);
});

test('native admission limit is descriptor-validated without invoking hostile getters', () => {
  let invoked = 0;
  const options = Object.defineProperty({ manifest }, 'maxConcurrentReads', {
    get() { invoked++; throw Error('poisoned config'); },
  });
  assert.throws(() => createSyntheticHarness(options), TypeError);
  assert.equal(invoked, 0);
});
