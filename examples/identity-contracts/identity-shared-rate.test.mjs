// Test in an independent Node process so this synthetic quota cannot
// consume another test file's in-memory fixture admission budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityVerifiedFixtureReader } from './identity-verified-reader.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const bearer = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)].join('.');
const denied = { ok: false, error: { code: 'denied' } };

function reader(verifyBearer) {
  return createIdentityVerifiedFixtureReader({
    harness: createSyntheticHarness({
      manifest,
      meshPermit: () => true,
      adapters: {
        'fixture.alpha.status': {
          authorize: () => true,
          readStatus: () => {
            throw new Error('synthetic source may not be reached');
          },
        },
      },
      timeoutMs: 500,
    }),
    verifyBearer,
    timeoutMs: 500,
    maxConcurrent: 1,
  });
}

test('new Identity readers cannot evade 64 starts per rolling minute in one process', async () => {
  let calls = 0;
  let forbiddenCalls = 0;
  // An untrusted/invalid token is rejected before charging the quota.
  assert.deepEqual(
    await reader(() => { forbiddenCalls++; return false; }).read({ bearer: '' }),
    denied,
  );
  assert.equal(forbiddenCalls, 0);

  for (let i = 0; i < 64; i++) {
    const gate = reader(() => { calls++; return false; });
    assert.deepEqual(await gate.read({ bearer }), denied,
      'a normal denied Identity decision still consumes one attempted start');
  }
  assert.equal(calls, 64);
  for (let i = 0; i < 5; i++) {
    const bypass = reader(() => {
      forbiddenCalls++;
      return true;
    });
    assert.deepEqual(await bypass.read({ bearer }), denied);
  }
  assert.equal(forbiddenCalls, 0,
    'over-budget calls must not reach Identity or its owning source');
});

test('throwing verifier also consumes attempted start budget and is redacted', async () => {
  // Previous test used the entire shared process budget. A new gate must
  // refuse *before* invoking any caller-supplied verifier callback.
  let attempts = 0;
  const gate = reader(() => { attempts++; throw Error('private verifier detail'); });
  const result = await gate.read({ bearer });
  assert.deepEqual(result, denied);
  assert.equal(attempts, 0);
  assert.doesNotMatch(JSON.stringify(result), /private verifier detail/);
});
