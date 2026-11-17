// Synthetic Mesh/Identity verifier admission, not a production tenant gateway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createIdentityVerifiedFixtureReader } from './identity-verified-reader.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const ID = 'fixture.alpha.status';
const BEARER = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)].join('.');
const harness = () => createSyntheticHarness({
  manifest,
  meshPermit: () => true,
  adapters: {
    [ID]: {
      authorize: () => true,
      readStatus: () => ({ state: 'ok', observed_at: '2026-11-10T16:00:00.000Z' }),
    },
  },
  timeoutMs: 600,
});
const reader = (verifyBearer, timeoutMs = 700) => createIdentityVerifiedFixtureReader({
  harness: harness(), verifyBearer, timeoutMs, maxConcurrent: 1,
});
const denied = { ok: false, error: { code: 'denied' } };

test('nine separately constructed Identity readers share only eight live verifier slots', async () => {
  const settle = [];
  let verificationStarts = 0;
  const verifyBearer = () => {
    verificationStarts++;
    return new Promise(resolve => settle.push(resolve));
  };
  const readers = Array.from({ length: 9 }, () => reader(verifyBearer));
  const pending = readers.slice(0, 8).map(r => r.read({ bearer: BEARER }));
  await delay(10);
  assert.equal(verificationStarts, 8);
  const saturated = await readers[8].read({ bearer: BEARER });
  assert.deepEqual(saturated, denied);
  assert.equal(verificationStarts, 8, 'ninth reader must not call Identity verifier');
  for (const resolve of settle) resolve(false);
  assert.deepEqual(await Promise.all(pending), Array(8).fill(denied));
  // Let the verifier microtasks release each global lease.
  await delay(0);
  const recovered = await reader(() => {
    verificationStarts++;
    return false;
  }).read({ bearer: BEARER });
  assert.deepEqual(recovered, denied);
  assert.equal(verificationStarts, 9, 'independent reader can resume after settlement');
});

test('timed-out uncooperative verifiers retain all shared leases until settlement', async () => {
  const settle = [];
  let verificationStarts = 0;
  const verifyBearer = () => {
    verificationStarts++;
    return new Promise(resolve => settle.push(resolve));
  };
  const readers = Array.from({ length: 8 }, () => reader(verifyBearer, 35));
  const results = await Promise.all(readers.map(r => r.read({ bearer: BEARER })));
  assert.deepEqual(results, Array(8).fill(denied));
  assert.equal(verificationStarts, 8);
  const blocked = await reader(() => {
    verificationStarts++;
    return true;
  }).read({ bearer: BEARER });
  assert.deepEqual(blocked, denied);
  assert.equal(verificationStarts, 8, 'timeout must not free an unresponsive verifier slot');
  settle.forEach(resolve => resolve(false));
  await delay(0);
  const ready = await reader(() => {
    verificationStarts++;
    return false;
  }).read({ bearer: BEARER });
  assert.deepEqual(ready, denied);
  assert.equal(verificationStarts, 9);
});
