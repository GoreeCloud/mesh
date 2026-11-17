// No pinned Identity checkout required: source-only cancellation boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityVerifiedFixtureReader } from '../identity-contracts/identity-verified-reader.mjs';
import { createSyntheticHarness } from './harness.mjs';
import { manifest } from './fixtures.mjs';

const bearer = 'a'.repeat(24) + '.' + 'b'.repeat(24) + '.' + 'c'.repeat(24);
const denied = { ok: false, error: { code: 'denied' } };
const capability = 'fixture.alpha.status';
function fixture({ verifyBearer = () => true, onRead = () => ({
  state: 'ok', observed_at: new Date().toISOString(),
}), timeoutMs = 350, maxConcurrent = 1 } = {}) {
  const harness = createSyntheticHarness({
    manifest, timeoutMs: 350,
    meshPermit: () => true,
    adapters: { [capability]: {
      authorize: () => true,
      readStatus: onRead,
    } },
  });
  return createIdentityVerifiedFixtureReader({
    harness, verifyBearer, timeoutMs, maxConcurrent,
  });
}

test('legacy source-verified path stays allowed without caller signal', async () => {
  let called = 0;
  const reader = fixture({ onRead: () => {
    called++;
    return { state: 'ok', observed_at: new Date().toISOString() };
  } });
  const result = await reader.read({ bearer });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'synthetic_result');
  assert.equal(called, 1);
});

test('already canceled caller cannot start Identity or owner work', async () => {
  const controller = new AbortController();
  controller.abort();
  let verifyCalls = 0, reads = 0;
  const reader = fixture({
    verifyBearer: () => { verifyCalls++; return true; },
    onRead: () => { reads++; return { state: 'ok', observed_at: new Date().toISOString() }; },
  });
  assert.deepEqual(await reader.read({ bearer }, { signal: controller.signal }), denied);
  assert.equal(verifyCalls, 0);
  assert.equal(reads, 0);
});

test('caller cancellation during verifier blocks late owner read and retains verifier slot', async () => {
  const controller = new AbortController();
  let started, release, verifyCalls = 0, ownerCalls = 0, verifierSignal;
  const began = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const reader = fixture({
    verifyBearer: async (_token, _scope, { signal }) => {
      verifyCalls++;
      verifierSignal = signal;
      if (verifyCalls === 1) {
        started();
        await held;
        return true;
      }
      return false;
    },
    onRead: () => {
      ownerCalls++;
      return { state: 'ok', observed_at: new Date().toISOString() };
    },
  });
  const pending = reader.read({ bearer }, { signal: controller.signal });
  await began;
  controller.abort();
  assert.equal(verifierSignal.aborted, true);
  assert.deepEqual(await pending, denied);
  assert.deepEqual(await reader.read({ bearer }), denied);
  assert.equal(verifyCalls, 1, 'abandoned work holds verification capacity');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await reader.read({ bearer }), denied);
  assert.equal(verifyCalls, 2);
  assert.equal(ownerCalls, 0, 'a late accepted proof cannot read owner status');
});

test('cancelling during an owner read suppresses even late success', async () => {
  const controller = new AbortController();
  let started, release, reads = 0;
  const began = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const reader = fixture({
    onRead: async () => {
      reads++;
      started();
      await held;
      return { state: 'ok', observed_at: new Date().toISOString() };
    },
  });
  const pending = reader.read({ bearer }, { signal: controller.signal });
  await began;
  controller.abort();
  assert.deepEqual(await pending, denied);
  assert.equal(reads, 1);
  release();
  await new Promise(resolve => setImmediate(resolve));
});

test('hostile caller cancellation context is rejected without getter execution', async () => {
  const controller = new AbortController();
  let getters = 0, verifications = 0;
  const reader = fixture({ verifyBearer: () => { verifications++; return true; } });
  const accessor = Object.defineProperty({}, 'signal', {
    get() { getters++; throw new Error('secret'); },
  });
  for (const controls of [
    accessor, {}, { signal: null }, { signal: {} },
    { signal: controller.signal, tenantId: 'other-family' },
    new Proxy({}, { ownKeys() { throw new Error('secret'); } }),
  ]) {
    assert.deepEqual(await reader.read({ bearer }, controls), denied);
  }
  assert.equal(getters, 0);
  assert.equal(verifications, 0);
});
