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
        ? { ok: true, kind: 'synthetic_result', capabilityId: request.capabilityId, evidence_status: 'prototype', data: { state: 'ok', observed_at: '2026-11-11T00:00:00.000Z' } }
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

test('bridge registration rejects accessor-backed callbacks and catalog metadata without evaluating getters',()=>{
  const { harness }=source();
  let getters=0;
  const readGetter=Object.defineProperty({discover:harness.discover},'read',{
    enumerable:true,get(){getters++;return harness.read;},
  });
  const resolverGetter=Object.defineProperty({},'resolveActor',{
    enumerable:true,get(){getters++;return getActor;},
  });
  const catalogGetter=Object.defineProperty({...catalog[0]},'id',{
    enumerable:true,get(){getters++;return 'fixture.alpha.status';},
  });
  for(const create of [
    ()=>createSyntheticMcpToolBridge(readGetter,{resolveActor:getActor}),
    ()=>createSyntheticMcpToolBridge(harness,resolverGetter),
    ()=>createSyntheticMcpToolBridge({discover(){return [catalogGetter]},read:harness.read},{resolveActor:getActor}),
  ])assert.throws(create,TypeError);
  assert.equal(getters,0,'Registration cannot evaluate untrusted getter callbacks or fields');
});

test('bridge registration binds owner read and actor resolver against post-registration replacement',async()=>{
  const {harness,events}=source();
  let originalResolverCalls=0, replacementCalls=0;
  const options={resolveActor:context=>{
    originalResolverCalls++;
    return context?.authenticatedActor;
  }};
  const bridge=createSyntheticMcpToolBridge(harness,options);
  const tool=bridge.listTools()[0].name;
  harness.read=async()=>{replacementCalls++;throw Error('untrusted replacement');};
  harness.discover=()=>{throw Error('late catalog replacement');};
  options.resolveActor=()=>{replacementCalls++;return 'fixture.stranger';};
  const result=await bridge.callTool(tool,{}, {authenticatedActor:'fixture.reader'});
  assert.equal(result.isError,undefined);
  assert.equal(JSON.parse(result.content[0].text).environment,'synthetic-local-only');
  assert.equal(originalResolverCalls,1);
  assert.equal(replacementCalls,0);
  assert.equal(events.length,1);
});

test('synthetic bridge refuses undeclared registration metadata and sparse discovery arrays',()=>{
  const {harness}=source();
  const options={resolveActor:getActor};
  assert.throws(()=>createSyntheticMcpToolBridge({...harness,extra:()=>{}},options),TypeError);
  assert.throws(()=>createSyntheticMcpToolBridge(harness,{...options,admin:true}),TypeError);
  const sparse=new Array(2);sparse[0]={...catalog[0]};
  assert.throws(()=>createSyntheticMcpToolBridge({discover:()=>sparse,read:harness.read},options),TypeError);
});

test('mistaken asynchronous host actor resolver is denied and rejection consumed',async()=>{
  const { harness, events }=source();
  const resolverError='private principal rejection must remain invisible';
  const rejected=createSyntheticMcpToolBridge(harness,{
    resolveActor:()=>Promise.reject(new Error(resolverError)),
  });
  const name=rejected.listTools()[0].name;
  const result=await rejected.callTool(name,{}, {authenticatedActor:'fixture.reader'});
  assert.equal(result.isError,true);
  assert.equal(result.content[0].text,'Capability unavailable.');
  assert.doesNotMatch(JSON.stringify(result),/private principal/);
  assert.equal(events.length,0,'Owner must not run for asynchronous identity');
  // Allow the rejection microtask and next event-loop turn to surface a leak.
  await new Promise(resolve=>setImmediate(resolve));
  const resolved=createSyntheticMcpToolBridge(harness,{
    resolveActor:()=>Promise.resolve('fixture.reader'),
  });
  const denied=await resolved.callTool(name,{}, {authenticatedActor:'fixture.reader'});
  assert.equal(denied.isError,true,'Even resolved async identities are never authoritative');
  assert.equal(events.length,0);
});

test('owner status projection rejects accessor-backed and mismatched capability output',async()=>{
  const valid={
    ok:true,kind:'synthetic_result',capabilityId:'fixture.alpha.status',
    evidence_status:'prototype',
    data:{state:'ok',observed_at:'2026-11-11T00:00:00.000Z'},
  };
  let evaluated=0;
  const badOuter=Object.defineProperty({...valid},'data',{
    enumerable:true,get(){evaluated++;throw Error('private owner property');},
  });
  const badInner=Object.defineProperty({...valid.data},'observed_at',{
    enumerable:true,get(){evaluated++;return '2026-11-11T00:00:00.000Z';},
  });
  const hostileStatus=new Proxy({state:'ok',observed_at:'2026-11-11T00:00:00.000Z'},{
    ownKeys(){throw Error('private proxy trap');},
  });
  const cases=[
    badOuter,{...valid,data:badInner},{...valid,data:hostileStatus},
    {...valid,capabilityId:'fixture.beta.status'},
    {...valid,private_owner_token:'secret'},
    {...valid,data:{...valid.data,secret:'owner-private'}},
    {...valid,data:{state:'ok',observed_at:'2026-02-30T00:00:00.000Z'}},
    {...valid,data:{state:'ok',observed_at:'x'.repeat(5000)}},
  ];
  for (const candidate of cases) {
    const {harness}=source();
    harness.read=async()=>candidate;
    const bridge=createSyntheticMcpToolBridge(harness,{resolveActor:getActor});
    const response=await bridge.callTool(bridge.listTools()[0].name,{},
      {authenticatedActor:'fixture.reader'});
    assert.equal(response.isError,true,'Malformed owner output must be denied');
    assert.equal(response.content[0].text,'Capability unavailable.');
    assert.doesNotMatch(JSON.stringify(response),/private|secret|owner-private/);
  }
  assert.equal(evaluated,0,'No untrusted owner getters should execute');
});

test('owner result requires verified capability identity and canonical UTC timestamp',async()=>{
  const {harness}=source();
  let reading;
  harness.read=async()=>reading;
  const bridge=createSyntheticMcpToolBridge(harness,{resolveActor:getActor});
  const tool=bridge.listTools()[0].name;
  reading={ok:true,kind:'synthetic_result',
    capabilityId:'fixture.alpha.status',evidence_status:'prototype',
    data:{state:'degraded',observed_at:'2026-11-11T00:00:00.000Z'}};
  const accepted=await bridge.callTool(tool,{}, {authenticatedActor:'fixture.reader'});
  assert.equal(accepted.isError,undefined);
  assert.deepEqual(JSON.parse(accepted.content[0].text),{
    evidence_status:'prototype',environment:'synthetic-local-only',
    state:'degraded',observed_at:'2026-11-11T00:00:00.000Z',
  });
  reading={...reading,capabilityId:undefined};
  assert.equal((await bridge.callTool(tool,{}, {authenticatedActor:'fixture.reader'})).isError,true);
});
