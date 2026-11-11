// Source-owned Calendar loopback exercise for a Mesh *response parser only*.
// All imported input is invented; no real identities, credentials or data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {CALENDAR_VTODO_PREFLIGHT_CONTRACT as CONTRACT,
  parseCalendarTaskImportability as parse} from './calendar-vtodo-preflight.mjs';

if (process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE !== '1' || process.argv.length !== 3) {
  throw Error('Explicit isolated Calendar fixture and source directory required');
}
const child = spawn('python3', [
  new URL('./calendar-redacted-preview-loopback.py', import.meta.url).pathname,
  path.resolve(process.argv[2]),
], {
  stdio:['ignore','pipe','pipe'],
  env:{PATH:process.env.PATH,GC_MESH_CALENDAR_PREVIEW_FIXTURE:'1',
    PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},
});
let output='';
const ready=new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{
    output+=chunk.toString('utf8');
    if(output.length>512){reject(Error('Oversized fixture readiness'));return;}
    const first=output.split('\n')[0];
    if(first.endsWith('}')){
      try{resolve(JSON.parse(first));}
      catch{reject(Error('Invalid fixture startup response'));}
    }
  });
  child.once('error',()=>reject(Error('Calendar fixture could not start')));
  child.once('exit',()=>reject(Error('Calendar fixture exited prematurely')));
});
const watchdog=setTimeout(()=>child.kill('SIGTERM'),15000);
try {
  const started=await ready;
  assert.ok(Number.isInteger(started.port)&&started.port>0&&started.port<=65535);
  const origin='http://127.0.0.1:'+started.port;
  async function call(endpoint,method='GET',body=undefined,token=undefined){
    const headers={};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(token!==undefined)headers.Authorization='Bearer '+token;
    const response=await fetch(origin+endpoint,{method,headers,redirect:'manual',
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(1300)});
    return {status:response.status,contentType:response.headers.get('content-type'),
      body:await response.text()};
  }
  async function login(email,password){
    const r=await call('/api/v1/login','POST',{email,password});
    assert.equal(r.status,200);
    const data=JSON.parse(r.body);
    assert.ok(typeof data.token==='string'&&data.token.length>12);
    return data.token;
  }
  const owner=await login('fixture-owner@example.test','synthetic-owner-password-12345678');
  const other=await login('fixture-other@example.test','synthetic-other-password-12345678');
  const listed=await call('/api/v1/calendars','GET',undefined,owner);
  assert.equal(listed.status,200);
  const calendarId=JSON.parse(listed.body).calendars[0].id;
  assert.ok(typeof calendarId==='string'&&calendarId.length>0);
  const taskIcs=[
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//GoreeCloud Tasks//VTODO Preview//EN',
    'BEGIN:VTODO','UID:urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'DTSTAMP:20261111T120000Z','SEQUENCE:3','CLASS:PRIVATE',
    'STATUS:NEEDS-ACTION','SUMMARY:SYNTHETIC_PRIVATE_TITLE_DO_NOT_ECHO',
    'DUE;VALUE=DATE:20261112','END:VTODO','END:VCALENDAR',''
  ].join('\r\n');
  const payload={calendar_id:calendarId,ics:taskIcs};
  assert.equal((await call(CONTRACT.path,'POST',payload)).status,401);
  assert.equal((await call(CONTRACT.path,'POST',payload,other)).status,404);
  const denied=await call(CONTRACT.path,'POST',payload,owner);
  assert.equal(denied.status,200);
  assert.deepEqual(parse(denied),{importable:false,reason_codes:[
    'classification_not_supported','date_only_due_not_supported','sequence_not_supported']});
  assert.ok(!denied.body.includes('SYNTHETIC_PRIVATE_TITLE_DO_NOT_ECHO'));
  assert.ok(!JSON.stringify(parse(denied)).includes('aaaaaaaa'));
  assert.equal((await call('/api/v1/import-tasks.ics','POST',payload,owner)).status,400);
  const supported={calendar_id:calendarId,ics:[
    'BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VTODO',
    'UID:valid@example.invalid','SUMMARY:ANOTHER_PRIVATE_SYNTHETIC_TITLE',
    'END:VTODO','END:VCALENDAR',''
  ].join('\r\n')};
  const accepted=await call(CONTRACT.path,'POST',supported,owner);
  assert.equal(accepted.status,200);
  assert.deepEqual(parse(accepted),{importable:true,reason_codes:[],
    total:1,would_import:1,would_skip:0});
  assert.ok(!accepted.body.includes('ANOTHER_PRIVATE_SYNTHETIC_TITLE'));
  const list=await call('/api/v1/tasks','GET',undefined,owner);
  assert.equal(list.status,200);
  assert.deepEqual(JSON.parse(list.body).tasks,[]);
  console.log('CALENDAR_VTODO_PREFLIGHT_MESH_SOURCE_CONTRACT_PASS');
} finally {
  clearTimeout(watchdog);
  child.kill('SIGTERM');
  await Promise.race([once(child,'exit').catch(()=>{}),
    new Promise(resolve=>setTimeout(resolve,3000))]);
  if(child.exitCode===null)child.kill('SIGKILL');
}
