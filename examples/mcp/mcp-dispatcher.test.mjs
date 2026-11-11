import test from 'node:test';
import assert from 'node:assert/strict';
import {CapabilityRegistry} from './capability-registry.mjs';
import {createMcpFixture} from './mcp-dispatcher.mjs';
const capability={id:'wardveil.status',version:'1.0.0',owner:'wardveil',kind:'tool',access:'read',scopes:['status.read'],classification:'internal',timeoutMs:1000,maxOutputBytes:128};
const actor={actor:'a',tenant:'t',authenticated:true,scopes:['status.read']};
const req=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
const setup=(context=actor,authorize=()=>true,invoke=async()=>'{\"state\":\"ok\"}')=>{
 const registry=new CapabilityRegistry();registry.register(capability);
 return createMcpFixture({registry,context,authorize,invoke});
};
async function boot(handler) {
 assert.equal((await handler.handle(req(100,'initialize',{protocolVersion:'2025-06-18'}))).result.protocolVersion,'2025-06-18');
 assert.equal(await handler.handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
 return handler;
}
test('initialization negotiates supported protocol only',async()=>{
 const h=setup();
 assert.equal((await h.handle(req(1,'initialize',{protocolVersion:'2025-06-18'}))).result.protocolVersion,'2025-06-18');
 assert.equal((await h.handle(req(2,'initialize',{protocolVersion:'2024-11-05'}))).error.code,-32602);
 assert.equal((await h.handle(req(3,'tools/list',{}))).error.code,-32000);
 assert.equal(await h.handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
 assert.equal((await h.handle(req(4,'ping',{}))).result instanceof Object,true);
});
test('read-only authorized discovery and call',async()=>{
 const h=await boot(setup());
 assert.deepEqual((await h.handle(req(1,'tools/list',{}))).result.tools.map(x=>x.name),['wardveil.status@1.0.0']);
 assert.equal((await h.handle(req(2,'tools/call',{name:'wardveil.status@1.0.0',arguments:{}}))).result.content[0].text,'{\"state\":\"ok\"}');
});
test('unauthorized scope cannot discover or invoke',async()=>{
 let called=0;const h=await boot(setup({...actor,scopes:[]},()=>true,async()=>{called++;return 'oops';}));
 assert.deepEqual((await h.handle(req(1,'tools/list',{}))).result.tools,[]);
 assert.equal((await h.handle(req(2,'tools/call',{name:'wardveil.status@1.0.0'}))).error.code,-32602);
 assert.equal(called,0);
});
test('invalid calls and unknown methods do not reach owner',async()=>{
 let called=0;const h=await boot(setup(actor,()=>true,async()=>{called++;return 'ok';}));
 assert.equal((await h.handle(req(1,'tools/call',{name:'wardveil.status@1.0.0',arguments:{extra:1}}))).error.code,-32602);
 assert.equal((await h.handle(req(2,'resources/list',{}))).error.code,-32601);
 assert.equal((await h.handle({jsonrpc:'2.0',id:3,method:'tools/list',evil:true})).error.code,-32600);
 assert.equal(called,0);
});
test('owner errors and oversized output are contained',async()=>{
 for(const fn of [async()=>{throw Error('secret')},async()=> 'x'.repeat(129)]){
  const result=await (await boot(setup(actor,()=>true,fn))).handle(req(1,'tools/call',{name:'wardveil.status@1.0.0'}));
  assert.equal(result.result.isError,true);assert.equal(JSON.stringify(result).includes('secret'),false);
 }
});
test('timeout and concurrency admission remain bounded for uncooperative owners',async()=>{
 const registry=new CapabilityRegistry();registry.register({...capability,timeoutMs:25});
 let release, calls=0, signal;
 const invoke=(_item,_ctx,{signal:abortSignal})=>{calls++;signal=abortSignal;return new Promise(resolve=>{release=resolve;});};
 const h=await boot(createMcpFixture({registry,context:actor,authorize:()=>true,invoke,maxConcurrent:1}));
 const call=id=>h.handle(req(id,'tools/call',{name:'wardveil.status@1.0.0'}));
 const pending=call(1);
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await call(2)).result.isError,true);assert.equal(calls,1);
 assert.equal((await pending).result.isError,true);
 assert.equal(signal.aborted,true);
 assert.equal((await call(3)).result.isError,true);assert.equal(calls,1);
 release('done');
 await new Promise(resolve=>setTimeout(resolve,5));
 const next=call(4);
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(calls,2);
 release('done');
 assert.equal((await next).result.isError,false);
});
