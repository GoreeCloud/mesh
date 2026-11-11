import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createSyntheticMcpToolBridge } from '../synthetic/mcp-tool-bridge.mjs';
import { createSyntheticStatelessMcpDispatcher, SYNTHETIC_MCP_VERSION } from '../synthetic/mcp-stateless-fixture.mjs';
import {
  CALENDAR_LIVENESS_CONTRACT,
  CALENDAR_READINESS_CONTRACT,
  createCalendarHealthFixtureAdapter,
  createCalendarReadinessFixtureAdapter,
} from './calendar-healthz.mjs';

const observedAt = '2026-11-11T13:00:00.000Z';
const cases = [
  {
    id: 'calendar.health',
    contract: CALENDAR_LIVENESS_CONTRACT,
    create: createCalendarHealthFixtureAdapter,
    body: '{"status":"ok"}',
  },
  {
    id: 'calendar.ready',
    contract: CALENDAR_READINESS_CONTRACT,
    create: createCalendarReadinessFixtureAdapter,
    body: '{"status":"ready"}',
  },
];
const contentType = 'application/json; charset=utf-8';
const reply = (body, changes = {}) => ({ status: 200, contentType, body, ...changes });

function harness(item, adapterOptions, meshPermit = () => true, timeoutMs = 150) {
  return createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION,
      environment: 'synthetic-local-only',
      capabilities: cases.map(c => ({
        id: c.id, owner: 'calendar', version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
      })),
    },
    adapters: { [item.id]: item.create(adapterOptions) },
    meshPermit,
    timeoutMs,
  });
}

const read = (h, item) => h.read({
  actor: 'fixture.reader', capabilityId: item.id, operation: 'status.read',
});

for (const item of cases) {
  test(item.id + ' pins the verified Calendar Python source and fixed GET path', () => {
    assert.equal(item.contract.source, 'GoreeCloud/calendar');
    assert.equal(item.contract.source_blob, 'ac6be2c5d9c1a61b42a90ed77af7f86cf165cd65');
    assert.equal(item.contract.source_ref, 'bea6665b31b81fc9bf4310c3fc071b3c2ed519e6');
    assert.equal(item.contract.method, 'GET');
    assert.equal(item.contract.mode, 'transport-injected-nonproduction');
    assert.ok(['/healthz', '/readyz'].includes(item.contract.path));
  });

  test(item.id + ' allows only the exact owner response and minimizes output', async () => {
    let requests = 0;
    const h = harness(item, {
      permit: () => true,
      clock: () => observedAt,
      transport: async params => {
        requests++;
        assert.deepEqual(Object.keys(params).sort(), ['method', 'path', 'signal']);
        assert.equal(params.method, 'GET');
        assert.equal(params.path, item.contract.path);
        assert.equal(params.signal.aborted, false);
        return reply(item.body);
      },
    });
    const result = await read(h, item);
    assert.equal(requests, 1);
    assert.equal(result.ok, true);
    assert.equal(result.evidence_status, 'prototype');
    assert.deepEqual(result.data, { state: 'ok', observed_at: observedAt });
    assert.equal(JSON.stringify(result).includes(item.body), false);
  });

  test(item.id + ' fails closed if Mesh or owner authorization is absent or revoked', async () => {
    let calls = 0;
    const transport = () => { calls++; return reply(item.body); };
    for (const permit of [undefined, () => false, () => 'true', () => { throw Error('secret'); }]) {
      const h = harness(item, { transport, ...(permit ? { permit } : {}) });
      assert.equal((await read(h, item)).error.code, 'denied');
    }
    const h = harness(item, { permit: () => true, transport }, () => false);
    assert.equal((await read(h, item)).error.code, 'denied');
    assert.equal(calls, 0);
  });

  test(item.id + ' rejects spoofed readiness, liveness, private fields and errors', async () => {
    const other = cases.find(c => c.id !== item.id);
    const bad = [
      reply(other.body),
      reply('{"status":"ok","title":"private-event"}'),
      reply('{"status":"ready","contacts":["private"]}'),
      reply(item.body + '\n'),
      reply(item.body.replace('}', ',"status":"ok"}')),
      reply(item.body, { status: 503 }),
      reply(item.body, { contentType: 'text/plain' }),
      reply(item.body, { credentials: 'secret' }),
      reply('x'.repeat(300)),
      { status: 200, contentType, body: item.body, get secret() { throw Error('private'); } },
      null,
    ];
    for (const response of bad) {
      const h = harness(item, { permit: () => true, clock: () => observedAt, transport: () => response });
      const result = await read(h, item);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'unavailable');
      assert.equal(JSON.stringify(result).includes('private'), false);
      assert.equal(JSON.stringify(result).includes('secret'), false);
    }
  });

  test(item.id + ' rejects hostile getters, invalid timestamps and aborted work', async () => {
    let accessed = 0;
    const response = Object.defineProperty(reply(item.body), 'body', {
      get() { accessed++; throw Error('private'); },
    });
    const h = harness(item, { permit: () => true, transport: () => response });
    assert.equal((await read(h, item)).error.code, 'unavailable');
    assert.equal(accessed, 0);
    const invalidClock = harness(item, {
      permit: () => true, transport: () => reply(item.body), clock: () => 'yesterday',
    });
    assert.equal((await read(invalidClock, item)).error.code, 'unavailable');
    const controller = new AbortController();
    controller.abort();
    const adapter = item.create({ transport: () => reply(item.body), permit: () => true });
    assert.equal(await adapter.authorize('fixture.reader', {}, { signal: controller.signal }), false);
    await assert.rejects(adapter.readStatus({ signal: controller.signal }), /source health unavailable/);
  });
}

test('readiness cannot be inferred from a healthy process if persistent storage is down', async () => {
  const liveness = cases[0];
  const readiness = cases[1];
  const live = await read(harness(liveness, {
    permit: () => true, clock: () => observedAt, transport: () => reply(liveness.body),
  }), liveness);
  const unavailable = await read(harness(readiness, {
    permit: () => true, clock: () => observedAt,
    transport: () => reply('{"status":"unavailable"}', { status: 503 }),
  }), readiness);
  assert.equal(live.ok, true);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'unavailable');
});

test('Calendar synthetic liveness/readiness interoperate through the common modern Mesh MCP fixture', async () => {
  const probes = [];
  const adapters = Object.fromEntries(cases.map(item => [
    item.id,
    item.create({
      permit: actor => actor === 'fixture.reader',
      clock: () => observedAt,
      transport({ method, path, signal }) {
        probes.push({method, path});
        assert.equal(signal.aborted, false);
        assert.equal(method, 'GET');
        return reply(item.body);
      },
    }),
  ]));
  const h = createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION,
      environment: 'synthetic-local-only',
      capabilities: cases.map(item => ({
        id:item.id, owner:'calendar', version:'0.0.1-fixture',
        operation:'status.read', sensitivity:'synthetic', evidence_status:'prototype',
      })),
    },
    adapters,
    meshPermit: actor => actor === 'fixture.reader',
    timeoutMs: 150,
  });
  const bridge = createSyntheticMcpToolBridge(h, {
    resolveActor: context => context?.actor,
  });
  const server = createSyntheticStatelessMcpDispatcher(bridge, {
    isAuthenticated: context => context?.authenticated === true,
    maxConcurrentCalls: 2,
  });
  const rpc = (id, method, extra={}) => ({
    jsonrpc:'2.0',id,method,params:{
      _meta: {
        'io.modelcontextprotocol/protocolVersion': SYNTHETIC_MCP_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
      ...extra,
    },
  });
  const caller={ authenticated:true,actor:'fixture.reader' };
  const discovery=await server.dispatch(rpc(1,'server/discover'),caller);
  assert.deepEqual(discovery.result.supportedVersions,[SYNTHETIC_MCP_VERSION]);
  const listed=await server.dispatch(rpc(2,'tools/list'),caller);
  assert.deepEqual(listed.result.tools.map(x=>x.name),
    ['mesh__calendar_health__status_read','mesh__calendar_ready__status_read']);
  for (const [i, item] of cases.entries()) {
    const result=await server.dispatch(rpc(i+3,'tools/call',{
      name:'mesh__'+item.id.replace('.','_')+'__status_read',arguments:{},
    }),caller);
    assert.equal(result.result.isError,false);
    const output=JSON.parse(result.result.content[0].text);
    assert.deepEqual(Object.keys(output).sort(),['environment','evidence_status','observed_at','state']);
    assert.equal(output.environment,'synthetic-local-only');
    assert.equal(output.state,'ok');
    assert.equal(output.observed_at,observedAt);
  }
  assert.deepEqual(probes.map(x=>x.path),['/healthz','/readyz']);

  for (const unauthorized of [
    {authenticated:false,actor:'fixture.reader'},
    {authenticated:true,actor:'fixture.stranger'},
  ]) {
    const result=await server.dispatch(rpc(6,'tools/call',{
      name:'mesh__calendar_ready__status_read',arguments:{},
    }),unauthorized);
    if(!unauthorized.authenticated)assert.equal(result.error.code,-32000);
    else {
      assert.equal(result.result.isError,true);
      assert.equal(result.result.content[0].text,'Capability unavailable.');
    }
  }
  assert.equal(probes.length,2,'Denied callers must not reach Calendar transport');
});
