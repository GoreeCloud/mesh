import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_REDACTED_PREVIEW_CONTRACT as CONTRACT,
  createCalendarRedactedPreviewFixture as create,
  parseCalendarRedactedPreview as parse,
} from './calendar-redacted-preview.mjs';

const valid = (total = 2, imported = 1) => ({
  status: 200, contentType: 'application/json; charset=utf-8',
  body: '{"total":' + total + ',"would_import":' + imported +
    ',"would_skip":' + (total - imported) + '}',
});
const actor = 'fixture.reader';
const make = (transport = async () => valid(), meshPermit = () => true,
  ownerPermit = () => true, consent = () => true) =>
  create({ transport, meshPermit, ownerPermit, consent });

test('source pin, operation, and URLs are immutable fixture metadata', () => {
  assert.equal(CONTRACT.source, 'GoreeCloud/calendar');
  assert.equal(CONTRACT.source_ref, 'cae388d173853d7aefaba41b4460564a28673662');
  assert.equal(CONTRACT.source_blob, '9fc93fd255c7c45bf11d82a86480523509a846fb');
  assert.deepEqual(Object.keys(CONTRACT.paths), ['events', 'tasks']);
  assert.equal(CONTRACT.method, 'POST');
  assert.ok(Object.isFrozen(CONTRACT) && Object.isFrozen(CONTRACT.paths));
});

test('the exact pinned Python success body projects only integer counts', () => {
  assert.deepEqual(parse(valid()), { total: 2, would_import: 1, would_skip: 1 });
  assert.deepEqual(parse(valid(0, 0)), { total: 0, would_import: 0, would_skip: 0 });
  assert.deepEqual(parse(valid(100, 100)), { total: 100, would_import: 100, would_skip: 0 });
  assert.ok(Object.isFrozen(parse(valid())));
});

test('extra content, duplicate keys, title leakage, malformed counters fail closed', () => {
  const malformed = [
    '{"total":1,"would_import":1,"would_skip":0,"sample_titles":["SECRET"]}',
    '{"total":1,"would_import":1,"would_skip":0,"title":"SECRET"}',
    '{"total":1,"would_import":1,"would_skip":0,"total":1}',
    '{"total":1,"would_import":1,"would_skip":0,"uid":"SECRET"}',
    '{"would_import":1,"total":1,"would_skip":0}',
    '{"total":1, "would_import":1,"would_skip":0}',
    '{"total":1,"would_import":1,"would_skip":0}\n',
    '{"total":1,"would_import":1,"would_skip":0}garbage',
    '{"total":-1,"would_import":0,"would_skip":0}',
    '{"total":1.1,"would_import":1,"would_skip":0}',
    '{"total":01,"would_import":1,"would_skip":0}',
    '{"total":101,"would_import":101,"would_skip":0}',
    '{"total":2,"would_import":2,"would_skip":1}',
    '{"total":2,"would_import":1,"would_skip":2}',
    '{"total":2,"would_import":"1","would_skip":1}',
    '{' + '"sample_titles":["SECRET"],'.repeat(250) + '"total":0}',
  ];
  for (const body of malformed) assert.equal(parse({ ...valid(), body }), null, body.slice(0, 120));
});

test('response metadata and getters/proxies cannot cause accidental field reflection', () => {
  assert.equal(parse({ ...valid(), status: 201 }), null);
  assert.equal(parse({ ...valid(), contentType: 'text/html' }), null);
  assert.equal(parse({ ...valid(), contentType: 'application/json' }), null);
  assert.equal(parse({ ...valid(), extra: 'SECRET' }), null);
  assert.equal(parse(Object.defineProperty({ ...valid() }, 'body', {
    enumerable: true, get: () => { throw new Error('SECRET getter'); },
  })), null);
  assert.equal(parse(new Proxy(valid(), { ownKeys() { throw new Error('SECRET proxy'); } })), null);
  assert.equal(parse(Object.assign(Object.create({ status: 200 }), valid())), null);
});

test('default creation denies unless synthetic-only opt-in is present', () => {
  const original = process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE;
  try {
    delete process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE;
    assert.throws(() => make(), /explicit test opt-in/);
  } finally {
    if (original === undefined) delete process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE;
    else process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE = original;
  }
});

test('option accessors, missing independent permits, extra keys and bad functions reject', () => {
  assert.throws(() => create({ transport: () => valid() }), TypeError);
  assert.throws(() => create({
    transport: () => valid(), meshPermit: () => true, ownerPermit: () => true,
    consent: () => true, leakedField: true,
  }), TypeError);
  assert.throws(() => create(Object.defineProperty({
    transport: () => valid(), ownerPermit: () => true, consent: () => true,
  }, 'meshPermit', {
    enumerable: true, get() { throw new Error('SECRET option getter'); },
  })), TypeError);
});

test('three independent authorizations are required before invoking the transport', async () => {
  let calls = 0;
  const transport = async () => { calls++; return valid(); };
  for (const [mesh, owner, consent] of [
    [() => false, () => true, () => true],
    [() => true, () => false, () => true],
    [() => true, () => true, () => false],
    [() => undefined, () => true, () => true],
    [() => true, () => null, () => true],
    [() => true, () => true, async () => { throw Error('SECRET permission error'); }],
  ]) {
    const result = await make(transport, mesh, owner, consent).preview({ actor, kind: 'tasks' });
    assert.deepEqual(result, { ok: false, error: { code: 'denied' } });
  }
  assert.equal(calls, 0, 'blocked consent/policy must not contact owner');
});

test('only the exact fixed redacted routes are sent to owner transport', async () => {
  const calls = [];
  const fixture = make(async request => { calls.push(request); return valid(1, 1); });
  for (const kind of ['events', 'tasks']) {
    const result = await fixture.preview({ actor, kind });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'synthetic_redacted_import_preview');
    assert.deepEqual(result.data, { total: 1, would_import: 1, would_skip: 0 });
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  assert.deepEqual(calls.map(c => [c.method, c.path]), [
    ['POST', '/api/v1/import.ics?dry_run=1&redact_titles=1'],
    ['POST', '/api/v1/import-tasks.ics?dry_run=1&redact_titles=1'],
  ]);
  assert.deepEqual(calls.map(c => Object.keys(c)), [['method', 'path', 'signal'], ['method', 'path', 'signal']]);
});

test('invalid actor, type or aborted request denies without any transport call', async () => {
  let calls = 0;
  const fixture = make(async () => { calls++; return valid(); });
  const ac = new AbortController();
  ac.abort();
  for (const params of [
    { actor: 'bad user', kind: 'tasks' },
    { actor, kind: 'private.user.data' },
    { actor, kind: 'tasks', signal: ac.signal },
    { actor, kind: 'events', signal: { aborted: false } },
    { actor, kind: '__proto__' },
    { actor, kind: 'constructor' },
    { actor, kind: 3 },
    { actor, kind: 'tasks', privatePayload: 'SECRET' },
    Object.defineProperty({ actor }, 'kind', {
      enumerable: true, get() { throw Error('SECRET request getter'); },
    }),
    new Proxy({ actor, kind: 'tasks' }, {
      ownKeys() { throw Error('SECRET request proxy'); },
    }),
    {},
  ]) {
    assert.deepEqual(await fixture.preview(params), { ok: false, error: { code: 'denied' } });
  }
  assert.equal(calls, 0);
});

test('source and transport failures return only fixed error codes', async () => {
  assert.deepEqual(await make(async () => { throw Error('SECRET_SOURCE_ERROR'); })
    .preview({ actor, kind: 'events' }), { ok: false, error: { code: 'unavailable' } });
  const bad = await make(async () => ({ ...valid(), body:
    '{"total":1,"would_import":1,"would_skip":0,"sample_titles":["SECRET_TITLE"]}' }))
    .preview({ actor, kind: 'tasks' });
  assert.deepEqual(bad, { ok: false, error: { code: 'invalid_response' } });
  assert.equal(JSON.stringify(bad).includes('SECRET'), false);
});

test('aborting during transport never exposes a late source response', async () => {
  const ac = new AbortController();
  const fixture = make(async () => { ac.abort(); return valid(); });
  assert.deepEqual(await fixture.preview({ actor, kind: 'tasks', signal: ac.signal }),
    { ok: false, error: { code: 'unavailable' } });
});
