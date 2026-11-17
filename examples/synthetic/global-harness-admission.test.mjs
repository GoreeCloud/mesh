// Development-only process-global admission regression for independent Mesh
// fixture harness objects; no network, tenant or real owner integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createSyntheticHarness, CONTRACT_VERSION } from './harness.mjs';

const id = 'fixture.alpha.status';
const request = { actor: 'fixture.reader', capabilityId: id, operation: 'status.read' };
const manifest = {
  schema_version: CONTRACT_VERSION,
  environment: 'synthetic-local-only',
  capabilities: [{
    id, owner: 'fixture.alpha', version: '0.0.1-fixture',
    operation: 'status.read', sensitivity: 'synthetic',
    evidence_status: 'prototype',
  }],
};
const health = { state: 'ok', observed_at: '2026-11-12T16:00:00.000Z' };

function harness(readStatus, meshPermit = () => true) {
  return createSyntheticHarness({
    manifest, meshPermit, timeoutMs: 80, maxConcurrentReads: 1,
    adapters: { [id]: { authorize: () => true, readStatus } },
  });
}
async function until(predicate) {
  for (let n = 0; n < 150; n++) {
    if (predicate()) return;
    await delay(2);
  }
  assert.ok(predicate(), 'synthetic operations never reached the expected gate');
}

test('creating fresh harness instances cannot bypass global 16-operation capacity', async () => {
  const completions = [];
  let started = 0;
  const pending = () => {
    started++;
    return new Promise(resolve => completions.push(resolve));
  };
  const calls = Array.from({ length: 16 }, () => harness(pending).read(request));
  await until(() => started === 16);
  const overflow = await harness(() => {
    started++;
    return health;
  }).read(request);
  assert.deepEqual(overflow, { ok: false, error: { code: 'unavailable' } });
  assert.equal(started, 16, '17th independent harness must not call owner');

  // Caller-facing timeouts do not release any of the 16 unfinished owners.
  const timedOut = await Promise.all(calls);
  assert.ok(timedOut.every(x => x.ok === false && x.error.code === 'timed_out'));
  const blocked = await harness(() => {
    started++;
    return health;
  }).read(request);
  assert.deepEqual(blocked, { ok: false, error: { code: 'unavailable' } });
  assert.equal(started, 16);

  for (const resolve of completions) resolve(health);
  await delay(0); // underlying owner promises release their global leases
  const recovered = await harness(() => health).read(request);
  assert.deepEqual(recovered, {
    ok: true, kind: 'synthetic_result', capabilityId: id,
    evidence_status: 'prototype', data: health,
  });
});

test('denied authorization does not leak shared capacity to later instances', async () => {
  for (let n = 0; n < 20; n++) {
    const result = await harness(() => {
      throw new Error('owner should not run');
    }, () => false).read(request);
    assert.deepEqual(result, { ok: false, error: { code: 'denied' } });
  }
  const successful = await harness(() => health).read(request);
  assert.equal(successful.ok, true);
});
