import test from 'node:test';
import assert from 'node:assert/strict';
import {CALENDAR_VTODO_PREFLIGHT_CONTRACT as CONTRACT,
  parseCalendarTaskImportability as parse} from './calendar-vtodo-preflight.mjs';
const source = body => ({status: 200, contentType: 'application/json; charset=utf-8', body});
const good = source('{"total":1,"would_import":1,"would_skip":0,"importable":true,"reason_codes":[]}');
const no = source('{"importable":false,"reason_codes":["classification_not_supported","date_only_due_not_supported","sequence_not_supported"]}');
test('pinned source metadata is exact and immutable', () => {
  assert.equal(CONTRACT.source_ref,'49ba88b9fc81bc73ea42033bcd11a37df2bab629');
  assert.equal(CONTRACT.handler_blob,'f421b8eeae7eb731aba48a4091a81b952903a384');
  assert.equal(CONTRACT.parser_blob,'bc56faf45dea5184b25e71eab72406e4b5677b0f');
  assert.equal(CONTRACT.path,'/api/v1/import-tasks.ics?dry_run=1&redact_titles=1&preflight=1');
  assert.equal(CONTRACT.method,'POST');
  assert.ok(Object.isFrozen(CONTRACT));
});
test('only count and fixed denial code projections are possible', () => {
  assert.deepEqual(parse(good),{importable:true,reason_codes:[],total:1,would_import:1,would_skip:0});
  assert.deepEqual(parse(no),{importable:false,reason_codes:[
    'classification_not_supported','date_only_due_not_supported','sequence_not_supported']});
  assert.ok(Object.isFrozen(parse(no).reason_codes));
  assert.equal(parse(source('{"importable":false,"reason_codes":["invalid_or_unsupported_ics"]}')).importable,false);
});
test('malformed, reordered, duplicated, private and unknown data fail closed', () => {
  const bad = [
    '{"total":1,"would_import":1,"would_skip":0,"importable":true,"reason_codes":[],"title":"SECRET"}',
    '{"total":1,"would_import":1,"would_skip":0,"importable":true,"reason_codes":[],"uid":"SECRET"}',
    '{"total":1,"would_import":1,"would_skip":0,"importable":true,"reason_codes":[],"total":1}',
    '{"importable":true,"reason_codes":[],"total":1,"would_import":1,"would_skip":0}',
    '{"total":1,"would_import":0,"would_skip":0,"importable":true,"reason_codes":[]}',
    '{"total":101,"would_import":101,"would_skip":0,"importable":true,"reason_codes":[]}',
    '{"total":-1,"would_import":0,"would_skip":0,"importable":true,"reason_codes":[]}',
    '{"total":1.5,"would_import":1,"would_skip":0,"importable":true,"reason_codes":[]}',
    '{"total":1,"would_import":"1","would_skip":0,"importable":true,"reason_codes":[]}',
    '{"importable":false,"reason_codes":[]}',
    '{"importable":false,"reason_codes":["SECRET_USER_NAME"]}',
    '{"importable":false,"reason_codes":["classification_not_supported","classification_not_supported"]}',
    '{"importable":false,"reason_codes":["sequence_not_supported","classification_not_supported"]}',
    '{"importable":false,"reason_codes":["classification_not_supported"],"source":"SECRET"}',
    '{"importable":false,"reason_codes":["classification_not_supported"],"reason_codes":[]}',
    '{"importable":false, "reason_codes":["classification_not_supported"]}',
    '{"importable":false,"reason_codes":["classification_not_supported"]}\n',
    '{"importable":false,"reason_codes":["classification_not_supported"]}garbage',
    '{' + '"title":"SECRET",'.repeat(100) + '"importable":false}',
  ];
  for (const body of bad) assert.equal(parse(source(body)),null,body.slice(0,70));
});
test('exotic response objects, getters, prototypes, wrong HTTP fields deny', () => {
  const candidates = [
    {...good,status:401},{...good,status:201},{...good,contentType:'text/html'},
    {...good,extra:'SECRET'},Object.assign(Object.create({x:1}),good),
    Object.defineProperty({status:200,contentType:'application/json; charset=utf-8'},
      'body',{enumerable:true,get(){throw Error('SECRET');}}),
    new Proxy(good,{ownKeys(){throw Error('SECRET');}}),null,{}
  ];
  for(const response of candidates) assert.equal(parse(response),null);
});
