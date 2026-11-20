import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight, boundedBody, acquireSlot, MAX_BODY_BYTES } from '../src/admission.mjs';

const endpoint = 'https://mesh.example.invalid/mcp';
const create = (body = '{}', extraHeaders = {}) =>
  new Request(endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders }, body });

test('perimeter rejects other paths, query, Origin and unsupported methods', () => {
  for (const [request,status] of [
    [new Request(endpoint + '?token=secret'), 404],
    [new Request('https://mesh.example.invalid/private'), 404],
    [new Request(endpoint, { method: 'DELETE' }), 405],
    [new Request(endpoint, { headers: { Origin: 'https://evil.example' } }), 403],
    [create('{}', { 'Content-Encoding': 'gzip' }), 415],
    [create('{}', { 'Content-Type': 'text/plain' }), 415],
    [create('{}', { 'Content-Length': String(MAX_BODY_BYTES + 1) }), 413],
    [create('{}', { 'Content-Length': '-1' }), 413],
  ]) assert.equal(preflight(request)?.status, status);
  assert.equal(preflight(new Request(endpoint)), null);
  assert.equal(preflight(create('{}')), null);
});

test('bounded JSON-RPC body replays intact and refuses malformed, oversized or empty bodies', async () => {
  const json = JSON.stringify({ jsonrpc:'2.0', id:7, method:'tools/list' });
  const replay = await boundedBody(create(json));
  assert.ok(replay instanceof Request);
  assert.deepEqual(await replay.json(), JSON.parse(json));
  assert.equal((await boundedBody(create('oops'))).status, 400);
  assert.equal((await boundedBody(create('[]'))).status, 400);
  assert.equal((await boundedBody(create(''))).status, 400);
  // No Content-Length header is necessary for this size rejection.
  assert.equal((await boundedBody(create('x'.repeat(MAX_BODY_BYTES + 1)))).status, 413);
});

test('per-isolate admission is bounded and releases are idempotent', () => {
  const releases = Array.from({ length: 4 }, () => acquireSlot());
  assert.ok(releases.every(x => typeof x === 'function'));
  assert.equal(acquireSlot(), null);
  releases[0]();
  releases[0]();
  const next = acquireSlot();
  assert.equal(typeof next, 'function');
  next();
  for (const release of releases) release();
  assert.equal(typeof acquireSlot(), 'function');
});
