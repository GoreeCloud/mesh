import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createTasksHealthFixtureAdapter, TASKS_HEALTH_CONTRACT } from './tasks-healthz.mjs';
import { createDavHealthFixtureAdapter, DAV_HEALTH_CONTRACT } from './dav-healthz.mjs';
import { createMemosHealthFixtureAdapter, MEMOS_HEALTH_CONTRACT } from './memos-health.mjs';
import { createWorkspaceTeamsHealthFixtureAdapter, WORKSPACE_TEAMS_HEALTH_CONTRACT } from './workspace-teams-health.mjs';

const seenAt = '2026-11-09T00:00:00.000Z';
const products = [
  { name: 'DAV / Contacts', id: 'dav.health', owner: 'dav', create: createDavHealthFixtureAdapter,
    contract: DAV_HEALTH_CONTRACT, body: '{"service":"goreecloud-dav","status":"up"}',
    contentType: 'application/json' },
  { name: 'Tasks', id: 'tasks.health', owner: 'tasks', create: createTasksHealthFixtureAdapter,
    contract: TASKS_HEALTH_CONTRACT, body: '{"status":"ok","mode":"loopback-development"}' },
  { name: 'Memos', id: 'memos.health', owner: 'memos', create: createMemosHealthFixtureAdapter,
    contract: MEMOS_HEALTH_CONTRACT, body: '{"status": "ok", "service": "goreecloud-memos"}' },
  { name: 'Workspace Teams', id: 'workspace-teams.health', owner: 'workspace-teams',
    create: createWorkspaceTeamsHealthFixtureAdapter, contract: WORKSPACE_TEAMS_HEALTH_CONTRACT,
    body: '{"status":"ok"}' },
];
const reply = (body, contentType = 'application/json; charset=utf-8') => ({ status: 200, contentType, body });
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
    assert.equal(item.contract.source, 'GoreeCloud/' + (item.owner === 'dav' ? 'DAV' : item.owner));
    assert.match(item.contract.source_blob, /^[a-f0-9]{40}$/);
    const inspected = {
      dav: '6a270d95c406def94482a9a4c6e9006c016a1e51',
      tasks: '12dc998bdc303e6efab7e896f384041563115977',
      memos: '4a607701787a7ef6791d5a5dbf600938ecb3a4ed',
      'workspace-teams': 'e6d80f401454ee9bd78b4ab9ae9066cc66d3ae27',
    };
    assert.equal(item.contract.source_blob, inspected[item.owner],
                 'Update source pin only after reviewing its actual owner health route');
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
        return reply(item.body, item.contentType);
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
        transport: () => { calls++; return reply(item.body, item.contentType); },
      }), item);
      assert.equal(result.error.code, 'denied');
    }
    assert.equal(calls, 0);
  });

  test(item.name + ' rejects unexpected status, duplicate fields, and malformed owner responses', async () => {
    const badResponses = [
      reply(item.body + '\n', item.contentType),
      reply(item.body.replace(/"status"\s*:\s*"(?:ok|up)"/, '"status":"degraded"'), item.contentType),
      reply(item.body.replace('}', ',"secret":"private"}'), item.contentType),
      reply('{"status":"bad","status":"ok"}'), reply('x'.repeat(300)),
      { ...reply(item.body, item.contentType), status: 503 },
      { ...reply(item.body, item.contentType), contentType: 'text/plain' },
      { ...reply(item.body, item.contentType), injected: true }, null, [],
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
    const getter = Object.defineProperty(reply(item.body, item.contentType), 'body', {
      get() { invoked++; throw Error('secret'); },
    });
    const proxy = new Proxy({}, { ownKeys() { throw Error('secret'); } });
    for (const bad of [getter, proxy]) {
      const result = await read(makeHarness(item, {
        permit: () => true, clock: () => seenAt, transport: async () => bad,
      }), item);
      assert.equal(result.error.code, 'unavailable');
    }
    const options = Object.defineProperty({ transport: async () => reply(item.body, item.contentType) }, 'permit', {
      get() { invoked++; return () => true; },
    });
    assert.throws(() => item.create(options), TypeError);
    assert.equal(invoked, 0);
    const invalid = await read(makeHarness(item, {
      permit: () => true, transport: async () => reply(item.body, item.contentType), clock: () => 'invalid',
    }), item);
    assert.equal(invalid.error.code, 'unavailable');
    const abort = new AbortController();
    abort.abort();
    const adapter = item.create({ transport: async () => reply(item.body, item.contentType), permit: () => true });
    assert.equal(await adapter.authorize('actor', {}, { signal: abort.signal }), false);
    await assert.rejects(adapter.readStatus({ signal: abort.signal }), /source health unavailable/);
  });
}



test('Tasks fixture rejects even a well-formed private task list on the fixed health route', async () => {
  const item = products.find(p => p.owner === 'tasks');
  const privateBody = '{"tasks":[{"title":"private-task-fixture"}],"limit":1,"hasMore":false}';
  let attempts = 0;
  const harness = makeHarness(item, {
    permit: () => true, clock: () => seenAt,
    transport: async params => {
      attempts++;
      assert.equal(params.method, 'GET');
      assert.equal(params.path, '/healthz');
      return reply(privateBody);
    },
  });
  const result = await read(harness, item);
  assert.equal(attempts, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unavailable');
  assert.equal(JSON.stringify(result).includes('private-task-fixture'), false);
});

test('Workspace Teams health cannot be confused with Tasks, Memos or DAV health or private API data', async () => {
  const item = products.find(p => p.owner === 'workspace-teams');
  let transportCalls = 0;
  for (const body of [
    products.find(p => p.owner === 'tasks').body,
    products.find(p => p.owner === 'memos').body,
    products.find(p => p.owner === 'dav').body,
    '{"status":"ok","user":"private"}',
    '{"initialized":false,"user":null}',
    '{"status":"ok","status":"ok"}',
  ]) {
    const h = makeHarness(item, { permit: () => true, clock: () => seenAt,
      transport: async params => {
        transportCalls++;
        assert.equal(params.path, '/api/health');
        return reply(body);
      },
    });
    const result = await read(h, item);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unavailable');
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.equal(transportCalls, 6);
  const denied = makeHarness(item, {
    transport: () => { throw Error('Unauthorized transport call'); },
  });
  assert.equal((await read(denied, item)).error.code, 'denied');
});
