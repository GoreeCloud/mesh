import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLoopbackWardveilStatusTransport } from './wardveil-status-loopback.mjs';
import { createWardveilScopedStatusAdapter } from './wardveil-status-v1.mjs';
import { createSyntheticHarness } from '../synthetic/harness.mjs';
import { manifest } from '../synthetic/fixtures.mjs';

const FAKE_TOKEN = 'a'.repeat(64); // disposable test fixture; never an operational credential
const capabilityId = 'fixture.alpha.status';
const stamp = () => new Date().toISOString();
const body = (state, observed_at = stamp()) =>
  JSON.stringify({ schema_version: 'wardveil.status.v1', state, observed_at }) + '\n';

async function withServer(handle, check, { sourceHeaders = true } = {}) {
  const server = createServer((req, res) => {
    // Match the Go handler by default. For deliberately raw duplicate-wire
    // headers, keep this off so Node does not normalize the test response.
    if (sourceHeaders) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    handle(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await check(server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const transportFor = port => createLoopbackWardveilStatusTransport({ port, token: FAKE_TOKEN });
const harnessFor = port => createSyntheticHarness({
  manifest, meshPermit: () => true, timeoutMs: 400,
  adapters: { [capabilityId]: createWardveilScopedStatusAdapter({
    transport: transportFor(port), permit: () => true,
  }) },
});
const read = h => h.read({ actor: 'synthetic.reader', capabilityId });

test('fixed GET v1 status sends a test-only scoped bearer to isolated loopback', async () => {
  let calls = 0;
  await withServer((req, res) => {
    calls++;
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1/status');
    assert.equal(req.socket.localAddress, '127.0.0.1');
    assert.equal(req.headers.authorization, 'Bearer ' + FAKE_TOKEN);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body('ok'));
  }, async port => {
    const result = await read(harnessFor(port));
    assert.equal(result.ok, true);
    assert.equal(result.data.state, 'ok');
    assert.match(result.data.observed_at, /Z$/);
  });
  assert.equal(calls, 1);
});

test('503 source degradation is a valid bounded health observation', async () => {
  await withServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body('degraded'));
  }, async port => {
    const result = await read(harnessFor(port));
    assert.equal(result.ok, true);
    assert.equal(result.data.state, 'degraded');
    assert.doesNotMatch(JSON.stringify(result), /Bearer|token/);
  });
});

test('401/403 and wrong source body never become a successful health result', async () => {
  for (const status of [401, 403, 404, 500]) {
    await withServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body('ok'));
    }, async port => {
      const result = await read(harnessFor(port));
      assert.equal(result.error.code, 'unavailable');
      assert.doesNotMatch(JSON.stringify(result), /Bearer|token/);
    });
  }
});

test('redirect never followed and no external target visited', async () => {
  let calls = 0;
  await withServer((_req, res) => {
    calls++;
    res.writeHead(302, { Location: 'https://example.invalid/export', 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body('ok'));
  }, async port => {
    assert.equal((await read(harnessFor(port))).error.code, 'unavailable');
  });
  assert.equal(calls, 1);
});

test('duplicate Content-Type and large response metadata are refused', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, [
      ['Content-Type', 'application/json; charset=utf-8'],
      ['Content-Type', 'text/plain'],
      ['Cache-Control', 'no-store'],
      ['X-Content-Type-Options', 'nosniff'],
    ]);
    res.end(body('ok'));
  }, async port => {
    assert.equal((await read(harnessFor(port))).error.code, 'unavailable');
  }, { sourceHeaders: false });
  await withServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Large': 'x'.repeat(4096),
    });
    res.end(body('ok'));
  }, async port => {
    assert.equal((await read(harnessFor(port))).error.code, 'unavailable');
  });
});

test('status transport is fail-closed for arbitrary endpoints, tokens and options', async () => {
  const signal = new AbortController().signal;
  for (const options of [
    {}, { port: 8080 }, { port: 8080, token: 'short' },
    { port: 8080, token: FAKE_TOKEN, host: 'example.com' },
    { port: 8080, token: FAKE_TOKEN, timeoutMs: 1500 },
    { port: 8080, token: 'a'.repeat(64) + '\r\nInjection: yes' },
    { port: 8080, token: FAKE_TOKEN + '\n' },
    { port: 8080, token: 'a'.repeat(1024) + '=' },
    { port: 8080, token: 'a'.repeat(1023) + '==' },
    { port: 80, token: FAKE_TOKEN }, null, [],
  ]) assert.throws(() => createLoopbackWardveilStatusTransport(options), TypeError);
  const transport = createLoopbackWardveilStatusTransport({ port: 8080, token: FAKE_TOKEN });
  for (const input of [
    { method: 'POST', path: '/v1/status', signal },
    { method: 'GET', path: '/v1/events', signal },
    { method: 'GET', path: '/v1/status', signal, body: 'hidden' },
    { method: 'GET', path: '/v1/status', signal: null },
  ]) await assert.rejects(transport(input), TypeError);
});

test('accessor-backed token and request are refused without evaluating accessors', async () => {
  let touched = 0;
  const opts = Object.defineProperty({ port: 8123 }, 'token', {
    get() { touched++; throw Error('private token'); },
  });
  assert.throws(() => createLoopbackWardveilStatusTransport(opts), TypeError);
  const signal = new AbortController().signal;
  const req = Object.defineProperty({ method: 'GET', signal }, 'path', {
    get() { touched++; return '/v1/status'; },
  });
  const transport = createLoopbackWardveilStatusTransport({ port: 8123, token: FAKE_TOKEN });
  await assert.rejects(transport(req), TypeError);
  assert.equal(touched, 0);
});

test('aborted, timed-out and oversized response paths report static unavailable', async () => {
  const controller = new AbortController();
  controller.abort();
  const transport = createLoopbackWardveilStatusTransport({ port: 8123, token: FAKE_TOKEN });
  await assert.rejects(transport({ method: 'GET', path: '/v1/status', signal: controller.signal }), /scoped status transport unavailable/);
  await withServer(() => {}, async port => {
    const slow = createLoopbackWardveilStatusTransport({ port, token: FAKE_TOKEN, timeoutMs: 30 });
    await assert.rejects(slow({ method: 'GET', path: '/v1/status', signal: new AbortController().signal }), /scoped status transport unavailable/);
  });
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('x'.repeat(1024));
  }, async port => {
    assert.equal((await read(harnessFor(port))).error.code, 'unavailable');
  });
});

test('missing or cacheable Wardveil security headers never become a valid status', async () => {
  const cases = [
    res => res.removeHeader('Cache-Control'),
    res => res.setHeader('Cache-Control', 'public, max-age=3600'),
    res => res.removeHeader('X-Content-Type-Options'),
    res => res.setHeader('X-Content-Type-Options', 'off'),
  ];
  for (const tamper of cases) {
    await withServer((_req, res) => {
      tamper(res);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body('ok'));
    }, async port => {
      const result = await read(harnessFor(port));
      assert.equal(result.error.code, 'unavailable');
      assert.doesNotMatch(JSON.stringify(result), /Bearer|token|private/);
    });
  }
});

test('duplicated cache-control and nosniff headers are ambiguous and rejected', async () => {
  for (const duplicate of [
    ['Cache-Control', 'no-store'],
    ['X-Content-Type-Options', 'nosniff'],
  ]) {
    await withServer((_req, res) => {
      res.writeHead(200, [
        ['Content-Type', 'application/json; charset=utf-8'],
        ['Cache-Control', 'no-store'],
        ['X-Content-Type-Options', 'nosniff'],
        duplicate,
      ]);
      res.end(body('ok'));
    }, async port => {
      assert.equal((await read(harnessFor(port))).error.code, 'unavailable');
    }, { sourceHeaders: false });
  }
});

test('the validated maximum-length bearer is accepted without a network requirement', () => {
  const transport = createLoopbackWardveilStatusTransport({
    port: 8123,
    token: 'a'.repeat(1023) + '=',
  });
  assert.equal(typeof transport, 'function');
});
