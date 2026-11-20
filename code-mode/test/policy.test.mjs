import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../../examples/synthetic/manifest.v1.json' with { type: 'json' };
import { bearerAuthorized, createReadOnlyRequest, SYNTHETIC_CATALOG } from '../src/policy.mjs';
import { OPENAPI } from '../src/spec.mjs';

const token = 'GoreeCloudSyntheticFixtureToken_20261120_0001';
const req = token => new Request('https://fixture.invalid/mcp', {
  headers: token ? { Authorization: 'Bearer ' + token } : {},
});

test('token binding denies absent, malformed, unequal, and unconfigured secrets', async () => {
  assert.equal(await bearerAuthorized(req(token), token), true);
  for (const pair of [
    [req(), token],
    [req(token), 'short'],
    [req(token.slice(0, -1) + 'X'), token],
    [req('short'), token],
    [req(token), undefined],
  ]) assert.equal(await bearerAuthorized(...pair), false);
});

test('static catalog matches canonical synthetic fixture only', async () => {
  assert.deepEqual(SYNTHETIC_CATALOG.map(x => x.id),
    manifest.capabilities.map(x => x.id));
  assert.deepEqual(Object.keys(OPENAPI.paths).sort(),
    ['/v1/capabilities', ...manifest.capabilities.map(x => '/v1/capabilities/' + x.id)].sort());
  assert.equal(OPENAPI.openapi, '3.0.3');
  assert.ok(Object.values(OPENAPI.paths).every(p => Object.keys(p).join() === 'get'));
});

test('read-only API never claims live health', async () => {
  const call = createReadOnlyRequest();
  const inventory = await call({ method: 'GET', path: '/v1/capabilities' });
  assert.equal(inventory.environment, 'synthetic-local-only');
  assert.equal(inventory.capabilities.length, manifest.capabilities.length);
  inventory.capabilities[0].id = 'forged';
  assert.equal((await call({ method: 'GET', path: '/v1/capabilities' })).capabilities[0].id,
    manifest.capabilities[0].id);
  const status = await call({ method: 'GET', path: '/v1/capabilities/' + manifest.capabilities[0].id });
  assert.deepEqual(status, {
    capability_id: manifest.capabilities[0].id,
    environment: 'synthetic-local-only',
    evidence_status: 'prototype',
    state: 'not_measured',
  });
});

test('host refuses write, traversal, query, actor escalation, and unknown route', async () => {
  const call = createReadOnlyRequest();
  const invalid = [
    { method: 'POST', path: '/v1/capabilities' },
    { method: 'DELETE', path: '/v1/capabilities' },
    { method: 'get', path: '/v1/capabilities' },
    { method: 'GET', path: '/../v1/capabilities' },
    { method: 'GET', path: 'https://example.com/v1/capabilities' },
    { method: 'GET', path: '/v1/capabilities', query: { actor: 'admin' } },
    { method: 'GET', path: '/v1/capabilities', body: {} },
    { method: 'GET', path: '/v1/capabilities', contentType: 'application/json' },
    { method: 'GET', path: '/v1/capabilities', rawBody: '' },
    { method: 'GET', path: '/v1/capabilities', actor: 'fixture.reader' },
    { method: 'GET', path: '/v1/capabilities', headers: { Authorization: token } },
    { method: 'GET', path: '/v1/capabilities?actor=admin' },
    { method: 'GET', path: '/v1/capabilities/fixture.unknown.status' },
    { method: 'GET', path: '/v1/capabilities', query: new URLSearchParams() },
    {},
    null,
  ];
  for (const options of invalid) await assert.rejects(call(options), /Operation unavailable/);
});

test('host denies accessor-backed arguments without evaluating getters', async () => {
  let evaluated = 0;
  const options = { method: 'GET' };
  Object.defineProperty(options, 'path', {
    enumerable: true, get() { evaluated++; return '/v1/capabilities'; },
  });
  await assert.rejects(createReadOnlyRequest()(options), /Operation unavailable/);
  assert.equal(evaluated, 0);
});

test('each invocation has a fixed owner-call budget, no unbounded fan-out', async () => {
  const call = createReadOnlyRequest();
  for (let i = 0; i < 8; i++) {
    assert.equal((await call({ method: 'GET', path: '/v1/capabilities' }))
      .evidence_status, 'prototype');
  }
  await assert.rejects(call({ method: 'GET', path: '/v1/capabilities' }), /Operation unavailable/);
});
