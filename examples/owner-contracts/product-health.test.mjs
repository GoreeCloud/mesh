import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createTasksHealthFixtureAdapter, TASKS_HEALTH_CONTRACT } from './tasks-healthz.mjs';
import { createMemosHealthFixtureAdapter, MEMOS_HEALTH_CONTRACT } from './memos-health.mjs';

const seenAt = '2026-11-09T00:00:00.000Z';
const products = [
  { name: 'Tasks', id: 'tasks.health', owner: 'tasks', create: createTasksHealthFixtureAdapter,
    contract: TASKS_HEALTH_CONTRACT, body: '{"status":"ok","mode":"loopback-development"}' },
  { name: 'Memos', id: 'memos.health', owner: 'memos', create: createMemosHealthFixtureAdapter,
    contract: MEMOS_HEALTH_CONTRACT, body: '{"status": "ok", "service": "goreecloud-memos"}' },
];
const reply = body => ({ status: 200, contentType: 'application/json; charset=utf-8', body });
function makeHarness(item, options) {
  return createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION, environment: 'synthetic-local-only',
      capabilities: products.map(product => ({
        id: product.id, owner: product.owner, version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
      })),
    },
    adapters: { [item.id]: item.create(options) },
    meshPermit: () => true, timeoutMs: 150,
  });
}
const read = (h, item) => h.read({ actor: 'fixture.reader', capabilityId: item.id, operation: 'status.read' });

for (const item of products) {
  test(item.name + ' contract pins the source and its read-only route', () => {
    assert.equal(item.contract.source, 'GoreeCloud/' + item.owner);
    assert.match(item.contract.source_blob, /^[a-f0-9]{40}$/);
    assert.equal(item.contract.method, 'GET');
    assert.equal(item.contract.mode, 'transport-injected-nonproduction');
  });

  test(item.name + ' projects exact health to a minimized status', async () => {
    let calls = 0;
    const result = await read(makeHarness(item, {
      permit: () => true, clock: () => seenAt,
      transport: async params => {
        calls++;
        assert.deepEqual(Object.keys(params).sort(), ['method', 'path', 'signal']);
        assert.equal(params.method, 'GET');
        assert.equal(params.path, item.contract.path);
        assert.equal(params.signal.aborted, false);
        return reply(item.body);
      },
    }), item);
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { state: 'ok', observed_at: seenAt });
    assert.equal(JSON.stringify(result).includes(item.body), false);
  });

  test(item.name + ' fails closed on absent, invalid or throwing owner permit', async () => {
    let calls = 0;
    for (const permit of [undefined, () => false, () => 'true', () => { throw Error('private'); }]) {
      const result = await read(makeHarness(item, {
        ...(permit ? { permit } : {}),
        transport: () => { calls++; return reply(item.body); },
      }), item);
      assert.equal(result.error.code, 'denied');
    }
    assert.equal(calls, 0);
  });

  test(item.name + ' rejects unexpected status, duplicate fields, and malformed owner responses', async () => {
    const badResponses = [
      reply(item.body + '\n'), reply(item.body.replace('"ok"', '"degraded"')),
      reply(item.body.replace('}', ',"secret":"private"}')),
      reply('{"status":"bad","status":"ok"}'), reply('x'.repeat(300)),
      { ...reply(item.body), status: 503 },
      { ...reply(item.body), contentType: 'text/plain' },
      { ...reply(item.body), injected: true }, null, [],
    ];
    for (const bad of badResponses) {
      const result = await read(makeHarness(item, {
        permit: () => true, clock: () => seenAt, transport: async () => bad,
      }), item);
      assert.equal(result.error.code, 'unavailable');
    }
  });

  test(item.name + ' rejects hostile property accessors, invalid clocks, and aborted reads', async () => {
    let invoked = 0;
    const getter = Object.defineProperty(reply(item.body), 'body', {
      get() { invoked++; throw Error('secret'); },
    });
    const proxy = new Proxy({}, { ownKeys() { throw Error('secret'); } });
    for (const bad of [getter, proxy]) {
      const result = await read(makeHarness(item, {
        permit: () => true, clock: () => seenAt, transport: async () => bad,
      }), item);
      assert.equal(result.error.code, 'unavailable');
    }
    const options = Object.defineProperty({ transport: async () => reply(item.body) }, 'permit', {
      get() { invoked++; return () => true; },
    });
    assert.throws(() => item.create(options), TypeError);
    assert.equal(invoked, 0);
    const invalid = await read(makeHarness(item, {
      permit: () => true, transport: async () => reply(item.body), clock: () => 'invalid',
    }), item);
    assert.equal(invalid.error.code, 'unavailable');
    const abort = new AbortController();
    abort.abort();
    const adapter = item.create({ transport: async () => reply(item.body), permit: () => true });
    assert.equal(await adapter.authorize('actor', {}, { signal: abort.signal }), false);
    await assert.rejects(adapter.readStatus({ signal: abort.signal }), /source health unavailable/);
  });
}
