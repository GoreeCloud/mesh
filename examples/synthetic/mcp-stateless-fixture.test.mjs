import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureHarness } from './fixtures.mjs';
import { createSyntheticMcpToolBridge } from './mcp-tool-bridge.mjs';
import { createSyntheticStatelessMcpDispatcher, SYNTHETIC_MCP_VERSION } from './mcp-stateless-fixture.mjs';

const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': SYNTHETIC_MCP_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'isolated-fixture-client', version: '0.0.1' },
});
const request = (method, rest = {}, id = 1) => ({
  jsonrpc: '2.0', id, method, params: { _meta: meta(), ...rest },
});
const authorized = { authenticated: true, actor: 'fixture.reader' };
const anonymous = { authenticated: false, actor: 'fixture.reader' };
function fixture() {
  const bridge = createSyntheticMcpToolBridge(createFixtureHarness(), {
    resolveActor: context => context?.actor,
  });
  return createSyntheticStatelessMcpDispatcher(bridge, {
    isAuthenticated: context => context?.authenticated === true,
  });
}

test('two trusted host contexts discover and read the same local-only synthetic tool', async () => {
  const server = fixture();
  const hosts = [{ ...authorized, agent: 'mock.alpha' }, { ...authorized, agent: 'mock.beta' }];
  for (const host of hosts) {
    const discovery = await server.dispatch(request('server/discover'), host);
    assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28']);
    assert.equal(discovery.result.resultType, 'complete');
    const listed = await server.dispatch(request('tools/list'), host);
    assert.equal(listed.result.tools.length, 2);
    assert(listed.result.tools.every(tool => tool.annotations.readOnlyHint));
    const name = listed.result.tools[0].name;
    const call = await server.dispatch(request('tools/call', { name, arguments: {} }, 2), host);
    assert.equal(call.id, 2);
    assert.equal(call.result.resultType, 'complete');
    assert.equal(call.result.isError, false);
    assert.equal(JSON.parse(call.result.content[0].text).environment, 'synthetic-local-only');
  }
});

test('unauthenticated hosts cannot discover, enumerate or execute any tool', async () => {
  const server = fixture();
  for (const method of ['server/discover', 'tools/list', 'tools/call']) {
    const extra = method === 'tools/call' ? { name: 'mesh__fixture_alpha_status__status_read', arguments: {} } : {};
    const response = await server.dispatch(request(method, extra), anonymous);
    assert.equal(response.error.code, -32000);
    assert.equal(response.error.message, 'Capability unavailable');
  }
});

test('model-supplied identity and mutation payloads fail before a tool call', async () => {
  const server = fixture();
  const name = 'mesh__fixture_alpha_status__status_read';
  for (const extra of [
    { name, arguments: { actor: 'fixture.reader' } },
    { name, arguments: { operation: 'status.write' } },
    { name, arguments: { payload: {} } },
    { name, arguments: null },
    { name, arguments: [] },
    { name, actor: 'fixture.reader' },
  ]) {
    const x = await server.dispatch(request('tools/call', extra), authorized);
    assert.equal(x.error.code, -32602);
  }
  const unknown = await server.dispatch(request('tools/call', {name:'mesh__missing__status_read',arguments:{} }),authorized);
  assert.equal(unknown.result.isError, true);
  assert.equal(unknown.result.content[0].text, 'Capability unavailable.');
});

test('unsupported version, unexpected fields and unsupported methods fail closed', async () => {
  const server = fixture();
  const wrong = request('tools/list');
  wrong.params._meta['io.modelcontextprotocol/protocolVersion'] = '2025-06-18';
  assert.equal((await server.dispatch(wrong, authorized)).error.code, -32602);
  assert.equal((await server.dispatch(request('initialize'), authorized)).error.code, -32601);
  assert.equal((await server.dispatch(request('tools/list', { cursor:'next' }), authorized)).error.code, -32602);
  assert.equal((await server.dispatch({ ...request('tools/list'), unrecognized:true },authorized)).error.code, -32600);
  assert.equal((await server.dispatch(request('tools/list', {_meta:{}}),authorized)).error.code, -32602);
});

test('getter/proxy envelopes and arguments never evaluate their supplied getter', async () => {
  const server = fixture();
  let evaluated = 0;
  const badParams = Object.defineProperty({ _meta: meta() }, 'name', {
    get() { evaluated += 1; return 'mesh__fixture_alpha_status__status_read'; },
  });
  const x = await server.dispatch({ jsonrpc:'2.0',id:1,method:'tools/call',params:badParams },authorized);
  assert.equal(x.error.code,-32602);
  assert.equal(evaluated,0);
  const badArgs = Object.defineProperty({}, 'actor', {
    get(){ evaluated += 1; return 'fixture.reader'; },
  });
  const y = await server.dispatch(request('tools/call',{ name:'mesh__fixture_alpha_status__status_read',arguments:badArgs }),authorized);
  assert.equal(y.error.code,-32602);
  assert.equal(evaluated,0);
  const hostile = new Proxy({}, {ownKeys(){ throw Error('proxy'); }});
  assert.equal((await server.dispatch(hostile,authorized)).error.code,-32600);
});

test('owner denial and errors stay generic and never expose synthetic status', async () => {
  const server = fixture();
  const method = request('tools/call', { name:'mesh__fixture_alpha_status__status_read', arguments:{} });
  const denied = await server.dispatch(method, {authenticated:true,actor:'fixture.stranger'});
  assert.equal(denied.result.isError,true);
  assert.equal(denied.result.content[0].text,'Capability unavailable.');
  const broken = createSyntheticStatelessMcpDispatcher({
    listTools(){ return []; },
    async callTool(){ throw new Error('private owner secret'); },
  },{isAuthenticated:()=>true});
  const failed = await broken.dispatch(method, authorized);
  assert.equal(failed.error.code,-32000);
  assert.doesNotMatch(JSON.stringify(failed),/private owner secret/);
});

test('reject incomplete fixtures rather than silently creating an unauthenticated server', () => {
  assert.throws(()=>createSyntheticStatelessMcpDispatcher(null),TypeError);
  assert.throws(()=>createSyntheticStatelessMcpDispatcher({listTools(){},callTool(){} }),TypeError);
});
