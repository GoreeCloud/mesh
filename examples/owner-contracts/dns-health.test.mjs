import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createDNSHealthFixtureAdapter, DNS_HEALTH_CONTRACT } from './dns-health.mjs';
import { createSyntheticMcpToolBridge } from '../synthetic/mcp-tool-bridge.mjs';
import { createSyntheticStatelessMcpDispatcher, SYNTHETIC_MCP_VERSION } from '../synthetic/mcp-stateless-fixture.mjs';

const PATH = '/api/dnsClient/healthCheck';
const observed = '2026-11-10T17:00:00.000Z';
const body = '{"server":"dns-lab.internal","status":"ok"}';
const response = b => ({ status: 200, contentType: 'application/json; charset=utf-8', body: b });
const request = { actor: 'fixture.reader', capabilityId: 'dns.health', operation: 'status.read' };
const denied = { ok: false, error: { code: 'denied' } };

function harness(options, meshPermit = () => true) {
  return createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION,
      environment: 'synthetic-local-only',
      capabilities: [{
        id: 'dns.health', owner: 'dns', version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic',
        evidence_status: 'prototype',
      }],
    },
    adapters: { 'dns.health': createDNSHealthFixtureAdapter(options) },
    meshPermit, timeoutMs: 150,
  });
}

test('source-pinned DNS client health is not encrypted DNS readiness', () => {
  assert.equal(DNS_HEALTH_CONTRACT.source, 'GoreeCloud/DNS');
  assert.equal(DNS_HEALTH_CONTRACT.source_blob,
    '333b11d0c32b9cd57bcb561fb2d94fa4e8e4ea40');
  assert.equal(DNS_HEALTH_CONTRACT.docs_blob,
    'fb1e769a04fc00e384189cee9f417532a4c75a22');
  assert.equal(DNS_HEALTH_CONTRACT.path, PATH);
  assert.equal(DNS_HEALTH_CONTRACT.method, 'GET');
  assert.equal(DNS_HEALTH_CONTRACT.source_permission, 'DnsClient: View');
  assert.equal(DNS_HEALTH_CONTRACT.mode, 'transport-injected-nonproduction');
  const source = readFileSync(new URL('./dns-health.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('https://'), false);
});

test('two exact source-envelope orderings produce minimal synthetic status', async () => {
  for (const variant of [body, '{"status":"ok","server":"dns-lab.internal"}']) {
    let transports = 0;
    const result = await harness({
      permit: () => true, clock: () => observed,
      transport: async input => {
        transports++;
        assert.deepEqual(Object.keys(input).sort(), ['method', 'path', 'signal']);
        assert.equal(input.method, 'GET');
        assert.equal(input.path, PATH);
        assert.equal(input.signal.aborted, false);
        return response(variant);
      },
    }).read(request);
    assert.equal(transports, 1);
    assert.deepEqual(result, {
      ok: true, kind: 'synthetic_result', capabilityId: 'dns.health',
      evidence_status: 'prototype',
      data: { state: 'ok', observed_at: observed },
    });
    assert.equal(JSON.stringify(result).includes('dns-lab'), false);
    assert.equal('dns_protocols_accepted' in result.data, false);
    assert.equal('tls_verified' in result.data, false);
  }
});

test('both Mesh and owner permits must grant independently before transport', async () => {
  let transports = 0;
  const transport = () => {
    transports++;
    return response(body);
  };
  for (const [options, meshPermit] of [
    [{ transport }, () => true],
    [{ transport, permit: () => false }, () => true],
    [{ transport, permit: () => 'true' }, () => true],
    [{ transport, permit: () => { throw Error('private-secret'); } }, () => true],
    [{ transport, permit: () => true }, () => false],
  ]) {
    assert.deepEqual(await harness(options, meshPermit).read(request), denied);
  }
  assert.equal(transports, 0);
});

test('wrong status, duplicate JSON keys, escapes, server labels and added fields fail closed', async () => {
  const invalid = [
    '{"status":"error","server":"dns-lab.internal"}',
    '{"server":"dns-lab.internal","status":"ok","status":"ok"}',
    '{"server":"dns-lab.internal","status":"ok","private":"secret"}',
    '{"server":"dns-lab.internal","status":"ok","server":"another"}',
    '{"server":"dns..internal","status":"ok"}',
    '{"server":"-dns.internal","status":"ok"}',
    '{"server":"dns-.internal","status":"ok"}',
    '{"server":"dns_underscore","status":"ok"}',
    '{"server":"dns-lab.internal","st\\u0061tus":"ok"}',
    '{"server":"dns-lab.internal","status":"ok","private":"my-token"}',
    '{"server":"dns-lab.internal","status":"ok"}anything',
    'x'.repeat(600),
    '',
  ];
  for (const candidate of invalid) {
    const result = await harness({
      permit: () => true, clock: () => observed,
      transport: () => response(candidate),
    }).read(request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unavailable');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('untrusted owner response/accessors and noncanonical clock never leak', async () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty(response(body), 'body', {
    get() { getterCalls++; throw Error('private'); },
  });
  for (const transport of [
    () => accessor,
    () => ({ ...response(body), extra: 'private' }),
    () => ({ ...response(body), status: 503 }),
    () => ({ ...response(body), contentType: 'text/plain' }),
    () => null,
    () => [],
    () => { throw Error('private-token'); },
  ]) {
    const result = await harness({ transport, permit: () => true, clock: () => observed }).read(request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unavailable');
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.equal(getterCalls, 0);
  const badClock = await harness({
    transport: () => response(body), permit: () => true, clock: () => 'tomorrow',
  }).read(request);
  assert.equal(badClock.error.code, 'unavailable');
});

test('abort is fail-closed and cannot invoke an unexpected read', async () => {
  const abort = new AbortController();
  abort.abort();
  const adapter = createDNSHealthFixtureAdapter({
    permit: () => true,
    transport: () => { throw Error('must-not-run'); },
  });
  assert.equal(await adapter.authorize('fixture.reader', {}, { signal: abort.signal }), false);
  await assert.rejects(adapter.readStatus({ signal: abort.signal }), /source health unavailable/);
});


test('source-pinned DNS synthetic status is discoverable through the modern Mesh MCP read-only bridge', async () => {
  let transports = 0;
  const delegate = harness({
    permit: actor => actor === 'fixture.reader',
    clock: () => observed,
    transport: () => { transports++; return response(body); },
  }, actor => actor === 'fixture.reader');
  const tools = createSyntheticMcpToolBridge(delegate, {
    resolveActor: context => context?.actor,
  });
  const server = createSyntheticStatelessMcpDispatcher(tools, {
    isAuthenticated: context => context?.authenticated === true,
    maxConcurrentCalls: 1, callTimeoutMs: 200,
  });
  const meta = {
    'io.modelcontextprotocol/protocolVersion': SYNTHETIC_MCP_VERSION,
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  const rpc = (id, method, extra = {}) => ({
    jsonrpc: '2.0', id, method, params: { _meta: meta, ...extra },
  });
  const authorized = { authenticated: true, actor: 'fixture.reader' };
  const discovered = await server.dispatch(rpc(1, 'server/discover'), authorized);
  assert.equal(discovered.result.resultType, 'complete');
  const listed = await server.dispatch(rpc(2, 'tools/list'), authorized);
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['mesh__dns_health__status_read']);
  assert.equal(listed.result.tools[0].annotations.readOnlyHint, true);
  const invoked = await server.dispatch(rpc(3, 'tools/call', {
    name: 'mesh__dns_health__status_read', arguments: {},
  }), authorized);
  assert.equal(invoked.result.isError, false);
  const projected = JSON.parse(invoked.result.content[0].text);
  assert.equal(projected.environment, 'synthetic-local-only');
  assert.equal(projected.state, 'ok');
  assert.equal(projected.observed_at, observed);
  assert.equal(JSON.stringify(invoked).includes('dns-lab'), false);
  assert.equal(transports, 1);

  const deniedOwner = await server.dispatch(rpc(4, 'tools/call', {
    name: 'mesh__dns_health__status_read', arguments: {},
  }), {authenticated:true,actor:'fixture.stranger'});
  assert.equal(deniedOwner.result.isError, true);
  assert.equal(deniedOwner.result.content[0].text, 'Capability unavailable.');
  const deniedHost = await server.dispatch(rpc(5, 'tools/list'), {
    authenticated:false,actor:'fixture.reader',
  });
  assert.equal(deniedHost.error.code, -32000);
  assert.equal(transports, 1, 'No denied caller may trigger the synthetic DNS transport');
});
