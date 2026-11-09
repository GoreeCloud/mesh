import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLoopbackWardveilHealthTransport } from './wardveil-loopback.mjs';
import { createWardveilHealthFixtureAdapter } from './wardveil-healthz.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const id = 'fixture.alpha.status';
const observed_at = '2026-11-09T00:00:00.000Z';
const healthy = '{"status":"ok"}\n';
const unavailable = '{"error":"event ingestion unavailable"}\n';
const request = signal => ({ method: 'GET', path: '/healthz', signal });

async function withServer(handler, exercise) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await exercise(server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function fixture(transport) {
  return createSyntheticHarness({
    manifest,
    meshPermit: () => true,
    adapters: { [id]: createWardveilHealthFixtureAdapter({
      transport, permit: () => true, clock: () => observed_at,
    }) },
    timeoutMs: 250,
  });
}
const read = h => h.read({ actor: 'fixture.reader', capabilityId: id });

test('real loopback socket projects the source-shaped healthy Wardveil response', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/healthz');
    assert.equal(req.socket.localAddress, '127.0.0.1');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(healthy);
  }, async port => {
    const transport = createLoopbackWardveilHealthTransport({ port });
    const result = await read(fixture(transport));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { state: 'ok', observed_at });
  });
});

test('real loopback 503 is classified degraded without copying error body', async () => {
  await withServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    res.end(unavailable);
  }, async port => {
    const result = await read(fixture(createLoopbackWardveilHealthTransport({ port })));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { state: 'degraded', observed_at });
    assert.doesNotMatch(JSON.stringify(result), /event ingestion unavailable/);
  });
});

test('HTTP redirects are never followed or converted into a successful status', async () => {
  let requests = 0;
  await withServer((_req, res) => {
    requests++;
    res.writeHead(302, { location: 'http://example.invalid/collect' });
    res.end('');
  }, async port => {
    const result = await read(fixture(createLoopbackWardveilHealthTransport({ port })));
    assert.equal(result.error.code, 'unavailable');
  });
  assert.equal(requests, 1);
});

test('oversized body fails under the fixed 256-byte maximum', async () => {
  await withServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end('x'.repeat(600));
  }, async port => {
    const transport = createLoopbackWardveilHealthTransport({ port });
    await assert.rejects(transport(request(new AbortController().signal)), /loopback health unavailable/);
  });
});

test('timeout and pre-aborted signal reject without exposing transport details', async () => {
  await withServer(() => {}, async port => {
    const transport = createLoopbackWardveilHealthTransport({ port, timeoutMs: 30 });
    await assert.rejects(transport(request(new AbortController().signal)), /loopback health unavailable/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(transport(request(controller.signal)), /loopback health unavailable/);
  });
});

test('strict request contract rejects path, method and extra options before connecting', async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; res.end(healthy); }, async port => {
    const transport = createLoopbackWardveilHealthTransport({ port });
    const signal = new AbortController().signal;
    for (const input of [
      { method: 'POST', path: '/healthz', signal },
      { method: 'GET', path: '/v1/events', signal },
      { method: 'GET', path: '/healthz', signal, url: 'https://example.com' },
      { method: 'GET', path: '/healthz', signal: undefined },
    ]) await assert.rejects(transport(input), TypeError);
  });
  assert.equal(requests, 0);
});

test('constructor refuses remote-origin configuration and privileged ports', () => {
  for (const options of [
    {}, { port: 80 }, { port: 65536 }, { port: '8080' },
    { port: 8123, hostname: 'evil.test' }, { port: 8123, timeoutMs: 9999 },
    { port: 8123, maxBytes: 100000 }, null, [],
  ]) assert.throws(() => createLoopbackWardveilHealthTransport(options), TypeError);
});

test('hostile option getters and request proxies fail closed without reading getters', async () => {
  let invoked = 0;
  const config = Object.defineProperty({}, 'port', { get() { invoked++; return 8000; } });
  assert.throws(() => createLoopbackWardveilHealthTransport(config), TypeError);
  const transport = createLoopbackWardveilHealthTransport({ port: 8123 });
  const hostile = Object.defineProperty(request(new AbortController().signal), 'path', {
    get() { invoked++; return '/healthz'; },
  });
  await assert.rejects(transport(hostile), TypeError);
  await assert.rejects(transport(new Proxy({}, { ownKeys() { throw Error('trap'); } })), TypeError);
  assert.equal(invoked, 0);
});
