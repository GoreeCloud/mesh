import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticMcpToolBridge } from './mcp-tool-bridge.mjs';
import { createFixtureHarness } from './fixtures.mjs';

const catalog = [{ id: 'fixture.alpha.status', operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype' }];
function source() {
  const events = [];
  const harness = {
    discover: () => catalog.map(x => ({ ...x })),
    async read(request) {
      events.push(request);
      return request.actor === 'fixture.reader'
        ? { ok: true, kind: 'synthetic_result', evidence_status: 'prototype', data: { state: 'ok', observed_at: '2026-11-11T00:00:00.000Z' } }
        : { ok: false, error: { code: 'denied' } };
    },
  };
  return { harness, events };
}
const getActor = ctx => ctx?.authenticatedActor;

test('two local host contexts use one read-only synthetic registry', async () => {
  const bridge = createSyntheticMcpToolBridge(createFixtureHarness(), { resolveActor: getActor });
  const list = bridge.listTools();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'mesh__fixture_alpha_status__status_read');
  assert.deepEqual(list[0].inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  list[0].name = 'forged'; list[0].annotations.readOnlyHint = false;
  assert.equal(bridge.listTools()[0].annotations.readOnlyHint, true);
  const t = bridge.listTools()[0].name;
  for (const host of ['local.mock.client-a', 'local.mock.client-b']) {
    const out = await bridge.callTool(t, {}, { authenticatedActor: 'fixture.reader', host });
    assert.equal(out.isError, undefined);
    assert.equal(JSON.parse(out.content[0].text).environment, 'synthetic-local-only');
  }
});

test('unknown tools and model-supplied actor/payload are refused before owner read', async () => {
  const { harness, events } = source();
  const bridge = createSyntheticMcpToolBridge(harness, { resolveActor: getActor });
  const t = bridge.listTools()[0].name;
  for (const [name,args] of [['mesh__missing__status_read', {}], [t, { actor: 'fixture.reader' }],
    [t, { operation:'status.write' }], [t, null], [t, []]]) {
    assert.equal((await bridge.callTool(name,args,{authenticatedActor:'fixture.reader'})).isError, true);
  }
  assert.equal(events.length, 0);
});

test('untrusted or absent identity and owner failures never become success', async () => {
  const { harness, events } = source();
  const bridge = createSyntheticMcpToolBridge(harness, { resolveActor: getActor });
  const t = bridge.listTools()[0].name;
  assert.equal((await bridge.callTool(t, {}, {})).isError, true);
  assert.equal((await bridge.callTool(t, {}, {authenticatedActor:'fixture.stranger'})).isError, true);
  assert.equal(events.length, 1);
  const failed = createSyntheticMcpToolBridge({ discover:harness.discover, read:async()=>{ throw Error('owner down'); } }, {resolveActor:getActor});
  assert.equal((await failed.callTool(t, {}, {authenticatedActor:'fixture.reader'})).isError, true);
});

test('hostile accessor args do not execute, invalid fixtures reject', async () => {
  let calls=0;
  const { harness, events } = source();
  const bridge = createSyntheticMcpToolBridge(harness, { resolveActor:getActor });
  const t = bridge.listTools()[0].name;
  const hostile = Object.defineProperty({},'actor',{get(){calls++;return 'fixture.reader';}});
  assert.equal((await bridge.callTool(t,hostile,{})).isError,true);
  assert.equal(calls,0);
  assert.equal(events.length,0);
  assert.throws(() => createSyntheticMcpToolBridge(harness), TypeError);
  assert.throws(() => createSyntheticMcpToolBridge({ discover:()=>[{...catalog[0],operation:'status.write'}],read(){} },{resolveActor:getActor}),TypeError);
});
