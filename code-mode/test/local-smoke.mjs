/**
 * Disposable loopback-only MCP smoke for GitHub CI. No Cloudflare login,
 * real service data, credentials or public route. Only fixed test code is run.
 * Do not run untrusted generated code in local Miniflare; it is not hardened.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
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

  console.log('Local Worker MCP initialization, tool listing, synthetic execution and deny-write smoke passed.');
} catch (error) {
  // Avoid dumping live token, request bodies or arbitrary module internals.
  console.error('Local MCP smoke failed:', error.message);
  console.error('Local workerd diagnostic (redacted):',
    logs.replaceAll(token, '[redacted]').slice(-1500));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await unlink(varsFile).catch(() => {});
}
