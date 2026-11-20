/**
 * Disposable loopback-only MCP smoke for GitHub CI. No Cloudflare login,
 * real service data, credentials or public route. Only fixed test code is run.
 * Do not run untrusted generated code in local Miniflare; it is not hardened.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const cwd = process.cwd();
const varsFile = join(cwd, '.dev.vars');
const token = randomBytes(32).toString('base64url');
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));

const address = 'http://127.0.0.1:' + port;
let logs = '';
let child;
let canaryServer;
let canaryHits = 0;
await writeFile(varsFile, 'MESH_CODEMODE_BEARER=' + token + '\n', { flag: 'wx', mode: 0o600 });

async function post(id, method, params, sessionId) {
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body = JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, ...(params ? { params } : {}) });
  const response = await fetch(address + '/mcp', {
    method: 'POST', headers, body, signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  const json = (() => {
    try { return JSON.parse(raw); } catch {
      const event = raw.split('\n').find(line => line.startsWith('data: '));
      return event ? JSON.parse(event.slice(6)) : null;
    }
  })();
  return { status: response.status, session: response.headers.get('Mcp-Session-Id'), json, raw };
}

try {
  child = spawn(join(cwd, 'node_modules/.bin/wrangler'),
    ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port)],
    { cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { logs = (logs + chunk.toString('utf8')).slice(-3000); });
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Local Worker exited before readiness.');
    try {
      const response = await fetch(address + '/other', { signal: AbortSignal.timeout(500) });
      if (response.status === 404) { ready = true; break; }
    } catch {}
    await delay(200);
  }
  if (!ready) throw new Error('Local Worker did not start.');

  const unauthorized = await fetch(address + '/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  });
  assert.equal(unauthorized.status, 401);
  const wrongToken = await fetch(address + '/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + randomBytes(32).toString('base64url'),
      'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(wrongToken.status, 401);
  const originBlocked = await fetch(address + '/mcp', {
    headers: { Authorization: 'Bearer ' + token, Origin: 'https://untrusted.invalid' },
  });
  assert.equal(originBlocked.status, 403);
  const tooLarge = await fetch(address + '/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: 'x'.repeat(32769),
  });
  assert.equal(tooLarge.status, 413);

  const initialized = await post(1, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'goreecloud-synthetic-ci', version: '0.1.0' },
  });
  assert.equal(initialized.status, 200, 'MCP initialize: ' + initialized.raw.slice(0, 400));
  assert.equal(initialized.json?.result?.serverInfo?.name, 'goreecloud-mesh-codemode-fixture');
  const session = initialized.session;
  const listed = await post(2, 'tools/list', {}, session);
  assert.equal(listed.status, 200, 'tools/list: ' + listed.raw.slice(0, 400));
  assert.deepEqual(listed.json?.result?.tools?.map(tool => tool.name).sort(), ['execute', 'search']);

  const discovery = await post(5, 'tools/call', {
    name: 'search',
    arguments: {
      code: 'async () => Object.keys((await codemode.spec()).paths)',
    },
  }, session);
  assert.equal(discovery.status, 200, 'search: ' + discovery.raw.slice(0, 300));
  assert.match(JSON.stringify(discovery.json?.result ?? {}), /\/v1\/capabilities/);

  const code = 'async () => await codemode.request({ method: "GET", path: "/v1/capabilities" })';
  const result = await post(3, 'tools/call', {
    name: 'execute', arguments: { code },
  }, session);
  assert.equal(result.status, 200, 'execute: ' + result.raw.slice(0, 400));
  const content = JSON.stringify(result.json?.result ?? {});
  assert.match(content, /synthetic-local-only/);
  assert.match(content, /prototype/);

  const malicious = await post(4, 'tools/call', {
    name: 'execute',
    arguments: { code: 'async () => await codemode.request({ method: "DELETE", path: "/v1/capabilities" })' },
  }, session);
  assert.equal(malicious.status, 200);
  assert.doesNotMatch(JSON.stringify(malicious.json?.result ?? {}), /"state":"ok"/);

  const quota = await post(6, 'tools/call', {
    name: 'execute',
    arguments: { code: 'async () => { let accepted=0; for (let i=0;i<9;i++) { try { await codemode.request({ method:"GET", path:"/v1/capabilities" }); accepted++; } catch { return { accepted, quotaDenied:true }; } } return { accepted, quotaDenied:false }; }' },
  }, session);
  assert.equal(quota.status, 200);
  const quotaResult = JSON.stringify(quota.json?.result ?? {});
  assert.match(quotaResult, /quotaDenied/);
  assert.match(quotaResult, /accepted/);
  assert.match(quotaResult, /true/);
  assert.match(quotaResult, /8/);

  // The only attempted sandbox network target is our disposable loopback
  // canary. It must receive zero connections; no external host is involved.
  canaryServer = createHttpServer((_request, response) => {
    canaryHits++;
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('unexpected');
  });
  await new Promise(resolve => canaryServer.listen(0, '127.0.0.1', resolve));
  const canaryPort = canaryServer.address().port;
  const egress = await post(7, 'tools/call', {
    name: 'execute',
    arguments: { code: 'async () => { await fetch("http://127.0.0.1:' + canaryPort + '/blocked"); return { networkAllowed: true }; }' },
  }, session);
  assert.equal(egress.status, 200);
  assert.equal(canaryHits, 0, 'sandbox must not access loopback');
  assert.doesNotMatch(JSON.stringify(egress.json?.result ?? {}), /networkAllowed/);

  console.log('Local MCP initialization, search/execute, auth, ingress bounds, write/quota denial and egress canary passed.');
} catch (error) {
  // Avoid dumping live token, request bodies or arbitrary module internals.
  console.error('Local MCP smoke failed:', error.message);
  console.error('Local workerd diagnostic (redacted):',
    logs.replaceAll(token, '[redacted]').slice(-1500));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  if (canaryServer?.listening) await new Promise(resolve => canaryServer.close(resolve));
  await unlink(varsFile).catch(() => {});
}
