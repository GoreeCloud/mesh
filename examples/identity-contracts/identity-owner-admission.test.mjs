// Source-independent synthetic Identity-to-Mesh owner admission checks.
// This never contacts a real Identity issuer, tenant, socket, or product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createIdentityVerifiedFixtureReader } from './identity-verified-reader.mjs';

const bearer = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)].join('.');
const denied = { ok: false, error: { code: 'denied' } };
const accepted = { ok: true, kind: 'synthetic_result' };

function reader(read, timeoutMs = 90) {
  const harness = { discover: () => [], read };
  return createIdentityVerifiedFixtureReader({
    harness,
    verifyBearer: () => true,
    timeoutMs,
    maxConcurrent: 1,
  });
}

async function eventually(predicate, limit = 100) {
  for (let i = 0; i < limit; i++) {
    if (predicate()) return;
    await delay(2);
  }
  assert.ok(predicate(), 'synthetic owner operation did not start');
}

test('independent Identity readers cannot exceed eight pending Mesh reads', async () => {
  const fulfill = [];
  let invoked = 0;
  const pendingOwner = () => {
    invoked++;
    return new Promise(resolve => fulfill.push(resolve));
  };
  const calls = Array.from({ length: 8 }, () =>
    reader(pendingOwner, 100).read({ bearer })
  );
  await eventually(() => invoked === 8);
  const overflow = await reader(() => {
    invoked++;
    return accepted;
  }).read({ bearer });
  assert.deepEqual(overflow, denied,
    'the ninth owner operation must not start despite successful Identity checks');
  assert.equal(invoked, 8);
  for (const settle of fulfill) settle(accepted);
  assert.deepEqual(await Promise.all(calls), Array(8).fill(accepted));
  await delay(0);
  const recovered = await reader(() => accepted).read({ bearer });
  assert.deepEqual(recovered, accepted);
});

test('timed-out readers retain owner lease until underlying operation settles', async () => {
  const fulfill = [];
  let invoked = 0;
  const pendingOwner = () => {
    invoked++;
    return new Promise(resolve => fulfill.push(resolve));
  };
  const calls = Array.from({ length: 8 }, () =>
    reader(pendingOwner, 25).read({ bearer })
  );
  await eventually(() => invoked === 8);
  assert.deepEqual(await Promise.all(calls), Array(8).fill(denied));
  const refused = await reader(() => {
    invoked++;
    return accepted;
  }).read({ bearer });
  assert.deepEqual(refused, denied);
  assert.equal(invoked, 8, 'caller timeout cannot release unresolved owner slots');
  for (const settle of fulfill) settle(accepted);
  await delay(0);
  assert.deepEqual(
    await reader(() => accepted).read({ bearer }), accepted,
    'once the owner settles, admission capacity must recover'
  );
});
