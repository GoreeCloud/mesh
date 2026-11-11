import test from 'node:test';
import assert from 'node:assert/strict';
import {CapabilityRegistry} from './capability-registry.mjs';
import {createMcpFixture} from './mcp-dispatcher.mjs';
const item={id:'wardveil.status',version:'1.0.0',owner:'wardveil',kind:'tool',access:'read',scopes:['status.read'],classification:'internal',timeoutMs:100,maxOutputBytes:100};
const actor={actor:'a',tenant:'t',authenticated:true,scopes:['status.read']};
test('registration does not execute getters from untrusted capability metadata',()=>{
 let touched=0;
 const hostile={...item};
 Object.defineProperty(hostile,'id',{get(){touched++;return 'wardveil.status';},enumerable:true});
 const registry=new CapabilityRegistry();
 assert.throws(()=>registry.register(hostile),TypeError);
 assert.equal(touched,0);
});
test('tools cannot be discovered or called before MCP initialization',async()=>{
 const registry=new CapabilityRegistry();registry.register(item);
 let invoked=0;
 const handler=createMcpFixture({registry,context:actor,authorize:()=>true,invoke:async()=>{invoked++;return 'ok';}});
 const list=await handler.handle({jsonrpc:'2.0',id:1,method:'tools/list',params:{}});
 const call=await handler.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'wardveil.status@1.0.0'}});
 assert.ok(list.error);
 assert.ok(call.error);
 assert.equal(invoked,0);
});

test('untrusted actor getters are not executed and never reach the owner',async()=>{
 let touched=0,invoked=0;
 const registry=new CapabilityRegistry();registry.register(item);
 const hostile={...actor};
 Object.defineProperty(hostile,'tenant',{get(){touched++;return 't';},enumerable:true});
 const h=createMcpFixture({registry,context:hostile,authorize:()=>true,invoke:async()=>{invoked++;return 'ok';}});
 await h.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
 await h.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 assert.deepEqual((await h.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})).result.tools,[]);
 assert.equal((await h.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'wardveil.status@1.0.0'}})).error.code,-32602);
 assert.equal(touched,0);assert.equal(invoked,0);
});
test('scope revocation between requests hides capabilities',async()=>{
 const registry=new CapabilityRegistry();registry.register(item);
 const context={...actor,scopes:['status.read']};
 const h=createMcpFixture({registry,context,authorize:()=>true,invoke:async()=> 'ok'});
 await h.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
 await h.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 assert.equal((await h.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})).result.tools.length,1);
 context.scopes.splice(0);
 assert.equal((await h.handle({jsonrpc:'2.0',id:3,method:'tools/list',params:{}})).result.tools.length,0);
});
test('async policy callbacks cannot accidentally authorize capabilities',()=>{
 const registry=new CapabilityRegistry();registry.register(item);
 assert.equal(registry.discover(actor,async()=>true).length,0);
});
