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


test('owner tool results reject getters, unknown fields and exotic content without leaking output',async()=>{
  let getters=0;
  const name='mesh__fixture_alpha_status__status_read';
  const item=()=>({type:'text',text:'safe'});
  const textAccessor=Object.defineProperty({type:'text'},'text',{
    get(){getters++;throw Error('private text')},
  });
  const topAccessor=Object.defineProperty({},'content',{
    get(){getters++;throw Error('private content')},
  });
  const indexAccessor=[];
  Object.defineProperty(indexAccessor,'0',{
    get(){getters++;throw Error('private index')},enumerable:true,
  });
  indexAccessor.length=1;
  const errorAccessor=Object.defineProperty({content:[item()]},'isError',{
    get(){getters++;throw Error('private status')},
  });
  for(const bad of [
    null,42,{},topAccessor,errorAccessor,
    {content:[textAccessor]}, {content:indexAccessor},
    {content:[item(),item()]},
    {content:[{...item(),secret:'owner-record'}]},
    {content:[item()],private_field:'owner-record'},
    {content:[item()],isError:'false'},
    {content:[{type:'html',text:'secret'}]},
    {content:[{type:'text',text:'x'.repeat(4097)}]},
    {content:new (class ExtendedList extends Array {}) (item())},
  ]){
    const server=createSyntheticStatelessMcpDispatcher({
      listTools(){return[]}, async callTool(){return bad},
    },{isAuthenticated:()=>true});
    const got=await server.dispatch(request('tools/call',{name,arguments:{}}),authorized);
    assert.equal(got.error.code,-32000,'Malformed owner result unexpectedly accepted');
    assert.doesNotMatch(JSON.stringify(got),/private|secret|owner-record/);
  }
  assert.equal(getters,0,'Projection must not invoke untrusted result getters');
});

test('valid optional owner error flag is copied without reference to original result',async()=>{
  const result={content:[{type:'text',text:'Local fixture unavailable.'}],isError:true};
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){return[]},async callTool(){return result},
  },{isAuthenticated:()=>true});
  const got=await server.dispatch(request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  }),authorized);
  assert.equal(got.result.isError,true);
  assert.equal(got.result.content[0].text,'Local fixture unavailable.');
  result.content[0].text='modified after reply';
  assert.equal(got.result.content[0].text,'Local fixture unavailable.');
});


test('authenticated host identity is immutable from admission until deferred owner work',async()=>{
  let ownerActor;
  let authActor;
  const bridge={
    listTools(){return[]},
    async callTool(_name,_args,context){
      ownerActor=context.actor;
      assert.equal(Object.getPrototypeOf(context),null);
      assert.equal(Object.isFrozen(context),true);
      return {content:[{type:'text',text:'synthetic'}]};
    },
  };
  const server=createSyntheticStatelessMcpDispatcher(bridge,{
    isAuthenticated:context=>{
      authActor=context.actor;
      assert.equal(Object.isFrozen(context),true);
      return context.authenticated===true;
    },
  });
  const context={authenticated:true,actor:'fixture.reader',agent:'mock.alpha'};
  const pending=server.dispatch(request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  }),context);
  context.actor='fixture.stranger';
  context.authenticated=false;
  context.agent='mutated';
  const result=await pending;
  assert.equal(result.result.content[0].text,'synthetic');
  assert.equal(authActor,'fixture.reader');
  assert.equal(ownerActor,'fixture.reader',
    'Owner must see the same identity snapshot that authentication approved');
});

test('synthetic host context refuses accessors, nested objects, oversized claims and hostile proxies',async()=>{
  let getters=0,authCalls=0,ownerCalls=0;
  const bridge={
    listTools(){return[]},
    async callTool(){ownerCalls++;return {content:[{type:'text',text:'never'}]};},
  };
  const server=createSyntheticStatelessMcpDispatcher(bridge,{
    isAuthenticated(){authCalls++;return true;},
  });
  const accessor=Object.defineProperty({authenticated:true},'actor',{
    get(){getters++;throw Error('private principal getter')},
  });
  const proxy=new Proxy({authenticated:true},{
    ownKeys(){throw Error('private principal proxy')}
  });
  const tooMany=Object.fromEntries(Array.from({length:17},(_,i)=>['field'+i,true]));
  for(const context of [
    accessor,proxy,null,42,'authenticated',
    {authenticated:true,actor:{id:'fixture.reader'}},
    {authenticated:true,actor:'x'.repeat(257)},
    {authenticated:true,score:Infinity},
    {authenticated:true,admin:()=>true},
    {authenticated:true,[Symbol('owner')]:'fixture.reader'},
    tooMany,
  ]) {
    const result=await server.dispatch(request('tools/call',{
      name:'mesh__fixture_alpha_status__status_read',arguments:{},
    }),context);
    assert.equal(result.error.code,-32000,'Host context should be denied');
    assert.equal(result.error.message,'Capability unavailable');
    assert.doesNotMatch(JSON.stringify(result),/private|principal getter/);
  }
  assert.equal(getters,0,'Host context inspection must not evaluate getter');
  assert.equal(authCalls,0,'Malformed host identity must be denied before auth');
  assert.equal(ownerCalls,0,'Malformed host identity must never reach owner');
});

test('flat read-only host claims are accepted without trusting model-supplied actor fields',async()=>{
  const server=fixture();
  const context={authenticated:true,actor:'fixture.reader',agent:'test-client',tenantId:7,
    displayName:null,strict:true};
  const result=await server.dispatch(request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  }),context);
  assert.equal(result.result.isError,false);
  assert.equal(JSON.parse(result.result.content[0].text).environment,'synthetic-local-only');
});

test('synthetic MCP output enforces UTF-8 bytes, not JavaScript code units',async()=>{
  let text='é'.repeat(2048); // exactly 4096 UTF-8 bytes, 2048 JS units
  const bridge={
    listTools(){return[];},
    async callTool(){return {content:[{type:'text',text}]};},
  };
  const server=createSyntheticStatelessMcpDispatcher(bridge,{isAuthenticated:()=>true});
  const call=()=>server.dispatch(request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  }),authorized);
  const atLimit=await call();
  assert.equal(atLimit.result.content[0].text,text);
  assert.equal(atLimit.result.isError,false);
  text+='é'; // 4098 bytes but still well below 4096 JS characters
  const tooLarge=await call();
  assert.equal(tooLarge.error.code,-32000);
  assert.equal(tooLarge.error.message,'Capability unavailable');
  assert.equal(JSON.stringify(tooLarge).includes('é'),false);
  text='🙂'.repeat(1200); // 4800 bytes, 2400 JS units
  const astral=await call();
  assert.equal(astral.error.code,-32000);
  assert.equal(JSON.stringify(astral).includes('🙂'),false);
});

test('synthetic per-actor admission prevents noisy principal from monopolizing global pool',async()=>{
  const releases=new Map(),calls=[];
  let block=true;
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){return[];},
    callTool(_name,_arguments,host){
      calls.push(host.actor);
      if (!block) return {content:[{type:'text',text:'completed'}]};
      return new Promise(resolve=>releases.set(host.actor,resolve));
    },
  },{isAuthenticated:host=>host.authenticated===true,
     maxConcurrentCalls:2,maxConcurrentPerActor:1,callTimeoutMs:1000});
  const method=()=>request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  });
  const actor=name=>({authenticated:true,actor:name});
  const alpha=server.dispatch(method(),actor('fixture.alpha'));
  await Promise.resolve();await Promise.resolve();
  const duplicate=await server.dispatch(method(),actor('fixture.alpha'));
  assert.equal(duplicate.error.code,-32000);
  const beta=server.dispatch(method(),actor('fixture.beta'));
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,['fixture.alpha','fixture.beta']);
  const saturated=await server.dispatch(method(),actor('fixture.gamma'));
  assert.equal(saturated.error.code,-32000,'Global cap still applies across actors');
  block=false;
  releases.get('fixture.alpha')({content:[{type:'text',text:'alpha'}]});
  releases.get('fixture.beta')({content:[{type:'text',text:'beta'}]});
  assert.equal((await alpha).result.content[0].text,'alpha');
  assert.equal((await beta).result.content[0].text,'beta');
  const recovered=await server.dispatch(method(),actor('fixture.alpha'));
  assert.equal(recovered.result.content[0].text,'completed');
  assert.deepEqual(calls,['fixture.alpha','fixture.beta','fixture.alpha']);
});

test('per-actor fairness refuses missing or invalid trusted keys, not model client claims',async()=>{
  let calls=0;
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){return[];},
    callTool(){calls++;return {content:[{type:'text',text:'ok'}]};},
  },{isAuthenticated:()=>true,maxConcurrentCalls:2,maxConcurrentPerActor:1});
  const method=request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  });
  for(const host of [{authenticated:true},{authenticated:true,actor:''},
    {authenticated:true,actor:'x'.repeat(129)},{authenticated:true,actor:'bad/actor'}]){
    const response=await server.dispatch(method,host);
    assert.equal(response.error.code,-32000);
  }
  method.params._meta['io.modelcontextprotocol/clientInfo']={
    name:'pretend-to-be-other-actor',version:'0.0.1',
  };
  const admitted=await server.dispatch(method,{authenticated:true,actor:'fixture.alpha'});
  assert.equal(admitted.result.isError,false);
  assert.equal(calls,1,'Client-supplied metadata never authorizes a missing host actor');
  assert.throws(()=>createSyntheticStatelessMcpDispatcher({
    listTools(){return[];},callTool(){},
  },{isAuthenticated:()=>true,maxConcurrentCalls:2,maxConcurrentPerActor:3}),RangeError);
  for(const invalid of [0,-1,1.25,NaN,'1']){
    assert.throws(()=>createSyntheticStatelessMcpDispatcher({
      listTools(){return[];},callTool(){},
    },{isAuthenticated:()=>true,maxConcurrentCalls:2,maxConcurrentPerActor:invalid}),RangeError);
  }
});

test('timed-out per-actor work keeps its admission until real owner settlement',async()=>{
  let release, calls=0;
  const waiting=new Promise(resolve=>{release=resolve;});
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){return[];},
    callTool(_name,_arguments,host){
      calls++;
      return host.actor==='fixture.alpha'?waiting:{content:[{type:'text',text:'beta'}]};
    },
  },{isAuthenticated:()=>true,maxConcurrentCalls:2,maxConcurrentPerActor:1,callTimeoutMs:20});
  const method=request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  });
  const alpha={authenticated:true,actor:'fixture.alpha'};
  const expired=await server.dispatch(method,alpha);
  assert.equal(expired.error.code,-32000);
  const stillBlocked=await server.dispatch(method,alpha);
  assert.equal(stillBlocked.error.code,-32000);
  const beta=await server.dispatch(method,{authenticated:true,actor:'fixture.beta'});
  assert.equal(beta.result.content[0].text,'beta');
  assert.equal(calls,2,'A timed-out actor cannot start duplicate work while others continue');
  release({content:[{type:'text',text:'alpha'}]});
  await new Promise(resolve=>setImmediate(resolve));
  const after=await server.dispatch(method,alpha);
  assert.equal(after.result.content[0].text,'alpha');
  assert.equal(calls,3,'Settled owner work frees this actor’s admission slot');
});

test('optional per-actor call window denies rapid sequential reads without blocking other actors',async()=>{
  const called=[];
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){return[];},
    callTool(_name,_args,host){called.push(host.actor);return {content:[{type:'text',text:'ok'}]};},
  },{isAuthenticated:ctx=>ctx.authenticated===true,
    maxConcurrentCalls:3,maxCallsPerActorWindow:2,actorWindowMs:100});
  const method=request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  });
  const read=actor=>server.dispatch(method,{authenticated:true,actor});
  assert.equal((await read('fixture.alpha')).result.isError,false);
  assert.equal((await read('fixture.alpha')).result.isError,false);
  const saturated=await read('fixture.alpha');
  assert.equal(saturated.error.code,-32000);
  assert.equal(saturated.error.message,'Capability unavailable');
  assert.equal((await read('fixture.beta')).result.isError,false,
    'A noisy actor must not suppress an independent trusted actor');
  assert.deepEqual(called,['fixture.alpha','fixture.alpha','fixture.beta']);
  await new Promise(resolve=>setTimeout(resolve,130));
  assert.equal((await read('fixture.alpha')).result.isError,false);
  assert.equal(called.length,4,'Expired fixed window must recover');
});

test('actor window quota is keyed to trusted identity and configuration rejects unsafe bounds',async()=>{
  let executed=0;
  const bridge={
    listTools(){return[];},
    callTool(){executed++;return {content:[{type:'text',text:'synthetic'}]};},
  };
  const accepted={isAuthenticated:()=>true,maxConcurrentCalls:2,
    maxCallsPerActorWindow:1,actorWindowMs:1000};
  const server=createSyntheticStatelessMcpDispatcher(bridge,accepted);
  const method=request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  });
  for(const context of [{authenticated:true},{authenticated:true,actor:''},
    {authenticated:true,actor:'bad/actor'},{authenticated:true,actor:'x'.repeat(129)}]) {
    assert.equal((await server.dispatch(method,context)).error.code,-32000);
  }
  method.params._meta['io.modelcontextprotocol/clientInfo']={
    name:'pretend.fixture.beta',version:'0.0.1',
  };
  assert.equal((await server.dispatch(method,{authenticated:true,actor:'fixture.alpha'})).result.isError,false);
  assert.equal((await server.dispatch(method,{authenticated:true,actor:'fixture.alpha'})).error.code,-32000);
  assert.equal((await server.dispatch(method,{authenticated:true,actor:'fixture.beta'})).result.isError,false);
  assert.equal(executed,2);
  for(const options of [
    {...accepted,maxCallsPerActorWindow:0}, {...accepted,maxCallsPerActorWindow:65},
    {...accepted,maxCallsPerActorWindow:1.2}, {...accepted,maxCallsPerActorWindow:NaN},
    {...accepted,maxCallsPerActorWindow:'1'}, {...accepted,actorWindowMs:0},
    {...accepted,actorWindowMs:99},{...accepted,actorWindowMs:60001},
    {...accepted,actorWindowMs:1.5},
    {isAuthenticated:()=>true,actorWindowMs:1000},
  ])assert.throws(()=>createSyntheticStatelessMcpDispatcher(bridge,options),RangeError);
});

test('actor window ledger bounds identity cardinality and denies additional keys fail closed',async()=>{
  const server=createSyntheticStatelessMcpDispatcher({
    listTools(){return[];},
    callTool(){return {content:[{type:'text',text:'ok'}]};},
  },{isAuthenticated:()=>true,maxConcurrentCalls:1,
     maxCallsPerActorWindow:1,actorWindowMs:60000});
  const method=request('tools/call',{
    name:'mesh__fixture_alpha_status__status_read',arguments:{},
  });
  for(let i=0;i<128;i++) {
    const r=await server.dispatch(method,{actor:'fixture.actor-'+i});
    assert.equal(r.result.isError,false,'Bounded actor '+i+' should admit once');
  }
  const denied=await server.dispatch(method,{actor:'fixture.actor-128'});
  assert.equal(denied.error.code,-32000);
  const repeated=await server.dispatch(method,{actor:'fixture.actor-0'});
  assert.equal(repeated.error.code,-32000);
});
