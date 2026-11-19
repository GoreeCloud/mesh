import test from 'node:test';
import assert from 'node:assert/strict';
import {createWardveilHealthMcpFixture} from './wardveil-health-mcp.mjs';
const actor={actor:'a',tenant:'tenant-a',authenticated:true,scopes:['status.read']};
const request=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
async function boot(fixture){
 const init=await fixture.handle(request(1,'initialize',{protocolVersion:'2025-06-18'}));
 assert.equal(init.result.protocolVersion,'2025-06-18');
 await fixture.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 return fixture;
}
const call=fixture=>fixture.handle(request(2,'tools/call',{name:'wardveil.health@1.0.0',arguments:{}}));
test('Wardveil /healthz source-shaped read passes distinct Mesh and owner policy gates',async()=>{
 let transports=0;
 const fixture=await boot(createWardveilHealthMcpFixture({
  context:actor, authorize:(who,cap)=>who.tenant==='tenant-a'&&cap.owner==='wardveil',
  permit:()=>true,clock:()=> '2026-11-11T00:00:00.000Z',
  transport:async({method,path})=>{
   transports++;assert.equal(method,'GET');assert.equal(path,'/healthz');
   return {status:200,contentType:'application/json; charset=utf-8',body:'{"status":"ok"}\n'};
  }
 }));
 const tools=(await fixture.handle(request(3,'tools/list',{}))).result.tools;
 assert.deepEqual(tools.map(x=>x.name),['wardveil.health@1.0.0']);
 const result=await call(fixture);
 assert.equal(result.result.isError,false);
 assert.deepEqual(JSON.parse(result.result.content[0].text),{state:'ok',observed_at:'2026-11-11T00:00:00.000Z'});
 assert.equal(transports,1);
});
test('Mesh denial prevents owner and transport access',async()=>{
 let owner=0,transport=0;
 const fixture=await boot(createWardveilHealthMcpFixture({
  context:actor,authorize:()=>false,permit:()=>{owner++;return true;},
  transport:async()=>{transport++;return {status:200,contentType:'application/json; charset=utf-8',body:'{"status":"ok"}'};}
 }));
 assert.deepEqual((await fixture.handle(request(3,'tools/list',{}))).result.tools,[]);
 assert.equal((await call(fixture)).error.code,-32602);
 assert.equal(owner,0);assert.equal(transport,0);
});
test('owner denial prevents transport access',async()=>{
 let transport=0;
 const fixture=await boot(createWardveilHealthMcpFixture({
  context:actor,authorize:()=>true,permit:()=>false,
  transport:async()=>{transport++;return {};}
 }));
 assert.equal((await call(fixture)).result.isError,true);
 assert.equal(transport,0);
});
test('degraded and malformed source responses fail within bounded output contract',async()=>{
 for(const [status,body,expected] of [[503,'{"error":"event ingestion unavailable"}','degraded'],[200,'{"events":[]}',null]]){
  const fixture=await boot(createWardveilHealthMcpFixture({
   context:actor,authorize:()=>true,permit:()=>true,clock:()=> '2026-11-11T00:00:00.000Z',
   transport:async()=>({status,contentType:'application/json; charset=utf-8',body})
  }));
  const response=(await call(fixture)).result;
  assert.equal(response.isError,expected===null);
  if(expected!==null)assert.equal(JSON.parse(response.content[0].text).state,expected);
 }
});
