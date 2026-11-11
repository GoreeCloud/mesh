import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureHarness } from './fixtures.mjs';
import { createSyntheticMcpToolBridge } from './mcp-tool-bridge.mjs';
import { createSyntheticStatelessMcpDispatcher, SYNTHETIC_MCP_VERSION } from './mcp-stateless-fixture.mjs';

const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': SYNTHETIC_MCP_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'isolated-fixture-client', version: '0.0.1' },
});
const request = (method, rest = {}, id = 1) => ({
  jsonrpc: '2.0', id, method, params: { _meta: meta(), ...rest },
});
const authorized = { authenticated: true, actor: 'fixture.reader' };
const anonymous = { authenticated: false, actor: 'fixture.reader' };
function fixture() {
  const bridge = createSyntheticMcpToolBridge(createFixtureHarness(), {
    resolveActor: context => context?.actor,
  });
  return createSyntheticStatelessMcpDispatcher(bridge, {
    isAuthenticated: context => context?.authenticated === true,
  });
}

test('two trusted host contexts discover and read the same local-only synthetic tool', async () => {
  const server = fixture();
  const hosts = [{ ...authorized, agent: 'mock.alpha' }, { ...authorized, agent: 'mock.beta' }];
  for (const host of hosts) {
    const discovery = await server.dispatch(request('server/discover'), host);
    assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28']);
    assert.equal(discovery.result.resultType, 'complete');
    const listed = await server.dispatch(request('tools/list'), host);
    assert.equal(listed.result.tools.length, 2);
    assert(listed.result.tools.every(tool => tool.annotations.readOnlyHint));
    const name = listed.result.tools[0].name;
    const call = await server.dispatch(request('tools/call', { name, arguments: {} }, 2), host);
    assert.equal(call.id, 2);
    assert.equal(call.result.resultType, 'complete');
    assert.equal(call.result.isError, false);
    assert.equal(JSON.parse(call.result.content[0].text).environment, 'synthetic-local-only');
  }
});

test('unauthenticated hosts cannot discover, enumerate or execute any tool', async () => {
  const server = fixture();
  for (const method of ['server/discover', 'tools/list', 'tools/call']) {
    const extra = method === 'tools/call' ? { name: 'mesh__fixture_alpha_status__status_read', arguments: {} } : {};
    const response = await server.dispatch(request(method, extra), anonymous);
    assert.equal(response.error.code, -32000);
    assert.equal(response.error.message, 'Capability unavailable');
  }
});

test('model-supplied identity and mutation payloads fail before a tool call', async () => {
  const server = fixture();
  const name = 'mesh__fixture_alpha_status__status_read';
  for (const extra of [
    { name, arguments: { actor: 'fixture.reader' } },
    { name, arguments: { operation: 'status.write' } },
    { name, arguments: { payload: {} } },
    { name, arguments: null },
    { name, arguments: [] },
    { name, actor: 'fixture.reader' },
  ]) {
    const x = await server.dispatch(request('tools/call', extra), authorized);
    assert.equal(x.error.code, -32602);
  }
  const unknown = await server.dispatch(request('tools/call', {name:'mesh__missing__status_read',arguments:{} }),authorized);
  assert.equal(unknown.result.isError, true);
  assert.equal(unknown.result.content[0].text, 'Capability unavailable.');
});

test('unsupported version, unexpected fields and unsupported methods fail closed', async () => {
  const server = fixture();
  const wrong = request('tools/list');
  wrong.params._meta['io.modelcontextprotocol/protocolVersion'] = '2025-06-18';
  assert.equal((await server.dispatch(wrong, authorized)).error.code, -32602);
  assert.equal((await server.dispatch(request('initialize'), authorized)).error.code, -32601);
  assert.equal((await server.dispatch(request('tools/list', { cursor:'next' }), authorized)).error.code, -32602);
  assert.equal((await server.dispatch({ ...request('tools/list'), unrecognized:true },authorized)).error.code, -32600);
  assert.equal((await server.dispatch(request('tools/list', {_meta:{}}),authorized)).error.code, -32602);
});

test('getter/proxy envelopes and arguments never evaluate their supplied getter', async () => {
  const server = fixture();
  let evaluated = 0;
  const badParams = Object.defineProperty({ _meta: meta() }, 'name', {
    get() { evaluated += 1; return 'mesh__fixture_alpha_status__status_read'; },
  });
  const x = await server.dispatch({ jsonrpc:'2.0',id:1,method:'tools/call',params:badParams },authorized);
  assert.equal(x.error.code,-32602);
  assert.equal(evaluated,0);
  const badArgs = Object.defineProperty({}, 'actor', {
    get(){ evaluated += 1; return 'fixture.reader'; },
  });
  const y = await server.dispatch(request('tools/call',{ name:'mesh__fixture_alpha_status__status_read',arguments:badArgs }),authorized);
  assert.equal(y.error.code,-32602);
  assert.equal(evaluated,0);
  const hostile = new Proxy({}, {ownKeys(){ throw Error('proxy'); }});
  assert.equal((await server.dispatch(hostile,authorized)).error.code,-32600);
});

test('owner denial and errors stay generic and never expose synthetic status', async () => {
  const server = fixture();
  const method = request('tools/call', { name:'mesh__fixture_alpha_status__status_read', arguments:{} });
  const denied = await server.dispatch(method, {authenticated:true,actor:'fixture.stranger'});
  assert.equal(denied.result.isError,true);
  assert.equal(denied.result.content[0].text,'Capability unavailable.');
  const broken = createSyntheticStatelessMcpDispatcher({
    listTools(){ return []; },
    async callTool(){ throw new Error('private owner secret'); },
  },{isAuthenticated:()=>true});
  const failed = await broken.dispatch(method, authorized);
  assert.equal(failed.error.code,-32000);
  assert.doesNotMatch(JSON.stringify(failed),/private owner secret/);
});

test('reject incomplete fixtures rather than silently creating an unauthenticated server', () => {
  assert.throws(()=>createSyntheticStatelessMcpDispatcher(null),TypeError);
  assert.throws(()=>createSyntheticStatelessMcpDispatcher({listTools(){},callTool(){} }),TypeError);
});


test('synthetic MCP admission refuses calls beyond configured in-flight capacity', async () => {
  let release;
  let calls = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const server = createSyntheticStatelessMcpDispatcher({
    listTools() { return []; },
    async callTool() {
      calls += 1;
      await waiting;
      return {content:[{type:'text',text:'{"ok":true}'}]};
    },
  }, {isAuthenticated:()=>true,maxConcurrentCalls:1,callTimeoutMs:1000});
  const name = 'mesh__fixture_alpha_status__status_read';
  const first = server.dispatch(request('tools/call',{name,arguments:{}}), authorized);
  await Promise.resolve();
  await Promise.resolve();
  const excess = await server.dispatch(request('tools/call',{name,arguments:{}}), authorized);
  assert.equal(excess.error.code, -32000);
  assert.equal(calls,1, 'Second synthetic owner read must not be admitted');
  release();
  const result = await first;
  assert.equal(result.result.isError,false);
  assert.equal(result.result.content[0].text,'{"ok":true}');
  const next = await server.dispatch(request('tools/call',{name,arguments:{}}),authorized);
  assert.equal(next.result.isError,false);
  assert.equal(calls,2);
});

test('timed-out synthetic MCP callers retain admission slots until owner really settles', async () => {
  let release;
  let calls = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const server = createSyntheticStatelessMcpDispatcher({
    listTools() { return []; },
    async callTool() {
      calls += 1;
      await waiting;
      return {content:[{type:'text',text:'finished'}]};
    },
  },{isAuthenticated:()=>true,maxConcurrentCalls:1,callTimeoutMs:15});
  const name = 'mesh__fixture_alpha_status__status_read';
  const expired = await server.dispatch(request('tools/call',{name,arguments:{}}),authorized);
  assert.equal(expired.error.code,-32000);
  const rejected = await server.dispatch(request('tools/call',{name,arguments:{}}),authorized);
  assert.equal(rejected.error.code,-32000);
  assert.equal(calls,1,'Timed-out caller must not free still-running owner slot');
  release();
  await new Promise(resolve => setImmediate(resolve));
  const recovered = await server.dispatch(request('tools/call',{name,arguments:{}}),authorized);
  assert.equal(recovered.result.isError,false);
  assert.equal(calls,2);
});

test('synthetic dispatcher rejects invalid concurrency, timeout and async authentication',async()=>{
  const bridge={listTools(){return[]},async callTool(){return {content:[{type:'text',text:'ok'}]}}};
  for(const config of [
    {maxConcurrentCalls:0},{maxConcurrentCalls:17},{maxConcurrentCalls:1.2},
    {callTimeoutMs:0},{callTimeoutMs:30001},{callTimeoutMs:NaN},
  ]) assert.throws(()=>createSyntheticStatelessMcpDispatcher(bridge,{isAuthenticated:()=>true,...config}),RangeError);
  const server=createSyntheticStatelessMcpDispatcher(bridge,{isAuthenticated:async()=>true});
  assert.equal((await server.dispatch(request('tools/list'),authorized)).error.code,-32000);
});


test('rejected asynchronous host authentication is refused without unhandled owner work', async()=>{
  let calls=0;
  const bridge={
    listTools(){return[]},
    async callTool(){calls++;return {content:[{type:'text',text:'ok'}]};},
  };
  const server=createSyntheticStatelessMcpDispatcher(bridge,{
    isAuthenticated:()=>Promise.reject(new Error('hidden callback failure')),
  });
  const rejected=await server.dispatch(request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  }),authorized);
  assert.equal(rejected.error.code,-32000);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,0);
});


test('synthetic tool-list boundary copies only fixed read-only metadata', async () => {
  const source = {
    name:'mesh__example_health__status_read',
    title:'Synthetic status fixture',
    description:'Local-only status; no live service',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  };
  const bridge = { listTools:()=>[source], async callTool(){throw Error('not used')} };
  const server = createSyntheticStatelessMcpDispatcher(bridge,{isAuthenticated:()=>true});
  const got = await server.dispatch(request('tools/list'),authorized);
  assert.equal(got.result.tools.length,1);
  assert.deepEqual(got.result.tools[0],source);
  assert.notEqual(got.result.tools[0],source);
  assert.notEqual(got.result.tools[0].annotations,source.annotations);
  assert.notEqual(got.result.tools[0].inputSchema,source.inputSchema);
  source.annotations.readOnlyHint = false;
  source.title = 'Private new title';
  assert.equal(got.result.tools[0].annotations.readOnlyHint,true);
  assert.equal(got.result.tools[0].title,'Synthetic status fixture');
});

test('synthetic tool-list boundary fails closed for hostile descriptors and unsafe catalogs', async () => {
  let getterCalls = 0;
  const valid = () => ({
    name:'mesh__example_health__status_read',
    title:'Synthetic status fixture',
    description:'Local-only status; no live service',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  });
  const accessor = Object.defineProperty(valid(),'name',{
    get(){getterCalls++;throw new Error('private-accessor')},
  });
  const arrayGetter = [];
  Object.defineProperty(arrayGetter,'0',{
    get(){getterCalls++;throw new Error('private-index')},
    enumerable:true,
  });
  arrayGetter.length = 1;
  const hostile = new Proxy([], {ownKeys(){throw new Error('private-proxy')}});
  for (const output of [
    null, 42, {}, [accessor], arrayGetter, hostile, new Array(1),
    [valid(),valid()],
    Array.from({length:33},valid),
    [{...valid(),secret:'hidden-admin-token'}],
    [{...valid(),description:'x'.repeat(300)}],
    [{...valid(),name:'mesh__secrets__write'}],
    [{...valid(),inputSchema:{type:'object',properties:{actor:{}},additionalProperties:false}}],
    [{...valid(),annotations:{...valid().annotations,readOnlyHint:false}}],
    [{...valid(),annotations:{...valid().annotations,openWorldHint:true}}],
    [{...valid(),annotations:{...valid().annotations,privateKey:'secret'}}],
  ]) {
    const server = createSyntheticStatelessMcpDispatcher({
      listTools(){return output},async callTool(){throw new Error('must-not-run')},
    },{isAuthenticated:()=>true});
    const result = await server.dispatch(request('tools/list'),authorized);
    assert.equal(result.error.code,-32000,'Unexpected tool catalog accepted');
    assert.doesNotMatch(JSON.stringify(result),/private|token|secret|accessor/);
  }
  assert.equal(getterCalls,0,'No accessor from untrusted catalog may execute');
});

test('tool inventory is not visible to an unauthenticated caller even when its getter would throw',async()=>{
  let reads=0;
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){ reads++; throw Error('private source inventory'); },
    async callTool(){throw Error('must-not-run')},
  },{isAuthenticated:()=>false});
  const reply=await server.dispatch(request('tools/list'),anonymous);
  assert.equal(reply.error.code,-32000);
  assert.equal(reads,0);
});


test('host registration snapshots callback descriptors without invoking injected getters', async () => {
  let accessed=0;
  const badBridge=Object.defineProperty({
    callTool(){return {content:[{type:'text',text:'ok'}]}},
  },'listTools',{get(){accessed++;throw Error('secret getter')}});
  assert.throws(()=>createSyntheticStatelessMcpDispatcher(badBridge,{
    isAuthenticated:()=>true,
  }),TypeError);
  const goodBridge={listTools(){return []},async callTool(){return {content:[{type:'text',text:'ok'}]}}};
  for(const prop of ['isAuthenticated','maxConcurrentCalls','callTimeoutMs']){
    const config={isAuthenticated:()=>true};
    Object.defineProperty(config,prop,{get(){accessed++;throw Error('private options')}});
    assert.throws(()=>createSyntheticStatelessMcpDispatcher(goodBridge,config),TypeError);
  }
  const unexpected={isAuthenticated:()=>true,authorizationOverride:true};
  assert.throws(()=>createSyntheticStatelessMcpDispatcher(goodBridge,unexpected),TypeError);
  assert.throws(()=>createSyntheticStatelessMcpDispatcher(goodBridge,null),TypeError);
  assert.equal(accessed,0,'Untrusted registration getters must not execute');
});

test('post-registration callback mutation cannot swap owner methods or authentication',async()=>{
  let listed=0, called=0, authenticated=0, swapped=0;
  const bridge={
    listTools(){listed++;assert.equal(this,bridge);return[]},
    callTool(){called++;assert.equal(this,bridge);
      return {content:[{type:'text',text:'synthetic'}]};},
  };
  const options={isAuthenticated(ctx){authenticated++;return ctx?.authenticated===true}};
  const server=createSyntheticStatelessMcpDispatcher(bridge,options);
  bridge.listTools=()=>{swapped++;throw Error('private listing')};
  bridge.callTool=()=>{swapped++;throw Error('private invocation')};
  options.isAuthenticated=()=>{swapped++;return false};
  const catalog=await server.dispatch(request('tools/list'),authorized);
  assert.deepEqual(catalog.result.tools,[]);
  const result=await server.dispatch(request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  }),authorized);
  assert.equal(result.result.content[0].text,'synthetic');
  assert.equal(result.result.isError,false);
  assert.equal(listed,1);assert.equal(called,1);assert.equal(authenticated,2);
  assert.equal(swapped,0,'Never trust callbacks changed after registration');
});

test('catalog array length and subclass metadata cannot run methods or leak fields',async()=>{
  let reads=0;
  const valid=()=>({
    name:'mesh__example_health__status_read',
    title:'Synthetic status fixture',
    description:'Local-only status; no live service',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  });
  const proxied=new Proxy([valid()],{get(target,key,receiver){
    if(key==='length'){reads++;throw Error('secret array length')}
    return Reflect.get(target,key,receiver);
  }});
  const inherited=new (class CustomList extends Array {})();
  inherited.push(valid());
  for(const catalog of [proxied,inherited]){
    const server=createSyntheticStatelessMcpDispatcher({
      listTools(){return catalog},async callTool(){throw Error('unused')}
    },{isAuthenticated:()=>true});
    const result=await server.dispatch(request('tools/list'),authorized);
    if(catalog===proxied){
      // Proxy traps cannot be blocked in general, but no accessor-style
      // property *read* should be needed for a canonical list snapshot.
      assert.equal(result.result.tools.length,1);
    } else assert.equal(result.error.code,-32000);
  }
  assert.equal(reads,0,'Never read an untrusted array length via a property get');
});
