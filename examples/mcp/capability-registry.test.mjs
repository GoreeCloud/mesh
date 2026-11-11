import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from './capability-registry.mjs';
const item = {id:'wardveil.status',version:'1.0.0',owner:'wardveil',kind:'tool',access:'read',scopes:['status.read'],classification:'internal',timeoutMs:1000,maxOutputBytes:4096};
const actor = {actor:'user-1',tenant:'tenant-a',authenticated:true,scopes:['status.read']};
const allow = (ctx, capability) => ctx.tenant === 'tenant-a' && capability.owner === 'wardveil';
test('discovery and resolution require independent policy permit', () => {
 const r=new CapabilityRegistry();r.register(item);
 assert.equal(r.discover(actor,allow).length,1);
 assert.equal(r.resolve('wardveil.status','1.0.0',actor,allow)?.id,item.id);
 assert.equal(r.discover({...actor,authenticated:false},allow).length,0);
 assert.equal(r.discover({...actor,tenant:'tenant-b'},allow).length,0);
 assert.equal(r.discover({...actor,scopes:[]},allow).length,0);
 assert.equal(r.discover(actor,()=>{throw Error('policy offline')} ).length,0);
 assert.equal(r.resolve(item.id,item.version,actor,()=>false),null);
});
test('registration rejects malformed, unknown and duplicate capability contracts', () => {
 const r=new CapabilityRegistry();r.register(item);
 assert.throws(()=>r.register(item),/duplicate/);
 assert.throws(()=>r.register({...item,unexpected:true}),/unexpected/);
 assert.throws(()=>r.register({...item,id:'status'}),/namespaced/);
 assert.throws(()=>r.register({...item,scopes:['status.read','status.read']}),/duplicate/);
 assert.throws(()=>r.register({...item,timeoutMs:Infinity}),/timeoutMs/);
});
test('returned records cannot mutate registry state', () => {
 const r=new CapabilityRegistry();r.register(item);
 const discovered=r.discover(actor,allow)[0];discovered.scopes.push('other');
 assert.deepEqual(r.resolve(item.id,item.version,actor,allow)?.scopes,['status.read']);
});
