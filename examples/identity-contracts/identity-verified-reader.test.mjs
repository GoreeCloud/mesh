import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createIdentityVerifiedFixtureReader } from './identity-verified-reader.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const SOURCE = fileURLToPath(new URL('./pinned-identity-resource.py', import.meta.url));
const id = 'fixture.alpha.status';
const syntheticActor = 'fixture.identity-verified';
const scope = { tenantId: 'synthetic-family', resource: 'wardveil.status', action: 'read' };

async function python(payload) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let output = '';
    const child = spawn('python3', [SOURCE], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const fail = () => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      reject(new Error('pinned Identity development verifier unavailable'));
    };
    const timer = setTimeout(fail, 3500);
    child.on('error', fail);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output, 'utf8') > 32768) fail();
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      if (code !== 0) return reject(new Error('pinned Identity development verifier failed'));
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch {
        reject(new Error('pinned Identity development verifier returned invalid response'));
      }
    });
    // The bearer travels over a private pipe, never through argv, URL, env or logs.
    child.stdin.on('error', fail);
    child.stdin.end(JSON.stringify(payload) + '\n');
  });
}

let issued;
before(async () => {
  issued = await python({ op: 'issue' });
  assert.ok(issued.jwks && typeof issued.tokens.valid === 'string');
});

function syntheticHarness({ meshPermit = () => true, ownerAuthorize = () => true, onRead = () => {} } = {}) {
  return createSyntheticHarness({
    manifest,
    meshPermit,
    adapters: {
      [id]: {
        authorize: ownerAuthorize,
        readStatus: async () => {
          onRead();
          return { state: 'ok', observed_at: new Date().toISOString() };
        },
      },
    },
    timeoutMs: 500,
  });
}

function identityGate(harness, overrides = {}) {
  return createIdentityVerifiedFixtureReader({
    harness,
    timeoutMs: 900,
    maxConcurrent: 2,
    verifyBearer: async (token, request, { signal }) => {
      assert.deepEqual(request, scope);
      if (signal.aborted) return false;
      const decision = await python({ op: 'verify', token, jwks: issued.jwks });
      return decision.allowed === true && !signal.aborted;
    },
    ...overrides,
  });
}

test('real pinned Identity RSA verifier permits one explicitly scoped Mesh read', async () => {
  let readCalls = 0;
  const reader = identityGate(syntheticHarness({ onRead: () => { readCalls++; } }));
  const response = await reader.read({ bearer: issued.tokens.valid });
  assert.equal(response.ok, true);
  assert.equal(response.kind, 'synthetic_result');
  assert.equal(response.evidence_status, 'prototype');
  assert.equal(response.data.state, 'ok');
  assert.equal(readCalls, 1);
  assert.doesNotMatch(JSON.stringify(response), /Bearer|disposable-ci-subject|token/);
  assert.equal(syntheticActor, 'fixture.identity-verified');
});

test('real Identity verifier denies wrong issuer, tenant, audience, client, scope, role and token class', async () => {
  let ownerCalls = 0;
  const reader = identityGate(syntheticHarness({ onRead: () => { ownerCalls++; } }));
  for (const [scenario, bearer] of Object.entries(issued.tokens)) {
    if (scenario === 'valid') continue;
    const result = await reader.read({ bearer });
    assert.deepEqual(result, { ok: false, error: { code: 'denied' } }, scenario);
    assert.doesNotMatch(JSON.stringify(result), /Bearer|private|signed|disposable/);
  }
  assert.equal(ownerCalls, 0, 'no invalid or unauthorized token invokes an owner');
});

test('real Identity allow never bypasses independent Mesh or source permit denial', async () => {
  for (const overrides of [
    { meshPermit: () => false },
    { ownerAuthorize: () => false },
  ]) {
    let ownerCalls = 0;
    const reader = identityGate(syntheticHarness({
      ...overrides, onRead: () => { ownerCalls++; },
    }));
    assert.equal((await reader.read({ bearer: issued.tokens.valid })).error.code, 'denied');
    assert.equal(ownerCalls, 0);
  }
});

test('untrusted request cannot select tenant, resource, policy, actor or pass getters', async () => {
  let executed = 0;
  const reader = identityGate(syntheticHarness({ onRead: () => { executed++; } }));
  let getters = 0;
  const accessor = Object.defineProperty({}, 'bearer', {
    get() { getters++; throw Error('private token'); },
  });
  for (const bad of [
    null, {}, [], accessor,
    { bearer: issued.tokens.valid, tenantId: 'other-tenant' },
    { bearer: issued.tokens.valid, actor: 'admin' },
    { bearer: issued.tokens.valid, resource: '/v1/events' },
    { bearer: issued.tokens.valid, payload: 'private' },
    { bearer: 'a.b.c' },
    { bearer: 'a'.repeat(16385) },
    new Proxy({}, { ownKeys() { throw Error('private proxy'); } }),
  ]) {
    assert.deepEqual(await reader.read(bad), { ok: false, error: { code: 'denied' } });
  }
  assert.equal(executed, 0);
  assert.equal(getters, 0);
});

test('a failed or throwing verifier denies without propagating sensitive exceptions', async () => {
  for (const verifyBearer of [
    () => { throw Error('private signing key'); },
    () => Promise.reject(new Error('private tenant policy')),
    () => false,
    () => 'true',
    () => ({ allowed: true }),
  ]) {
    const reader = createIdentityVerifiedFixtureReader({
      harness: syntheticHarness(), verifyBearer, timeoutMs: 100, maxConcurrent: 1,
    });
    const result = await reader.read({ bearer: issued.tokens.valid });
    assert.deepEqual(result, { ok: false, error: { code: 'denied' } });
  }
});

test('pending verifier retains capacity after timeout and cannot authorize late', async () => {
  let calls = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const reader = createIdentityVerifiedFixtureReader({
    harness: syntheticHarness(),
    verifyBearer: async () => { calls++; return held; },
    timeoutMs: 20, maxConcurrent: 1,
  });
  assert.equal((await reader.read({ bearer: issued.tokens.valid })).error.code, 'denied');
  assert.equal((await reader.read({ bearer: issued.tokens.valid })).error.code, 'denied');
  assert.equal(calls, 1, 'timed-out verifier still holds admission until settlement');
  release(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await reader.read({ bearer: issued.tokens.valid })).error.code, 'denied');
  assert.equal(calls, 2, 'slot releases only when verifier has settled');
});

test('constructor refuses hostile option surfaces without executing accessors', () => {
  let invoked = 0;
  const ordinary = {
    harness: syntheticHarness(), verifyBearer: () => true,
    timeoutMs: 100, maxConcurrent: 1,
  };
  for (const invalid of [
    {}, null, [],
    { ...ordinary, verifierUrl: 'https://example.invalid' },
    { ...ordinary, maxConcurrent: 99 },
    { ...ordinary, timeoutMs: 0 },
    new Proxy({}, { ownKeys() { throw Error('private'); } }),
    Object.defineProperty({ ...ordinary }, 'verifyBearer', {
      get() { invoked++; return () => true; },
    }),
  ]) {
    assert.throws(() => createIdentityVerifiedFixtureReader(invalid), TypeError);
  }
  assert.equal(invoked, 0);
});
