/**
 * Dependency-free stateless MCP 2026-07-28 *fixture* over the synthetic-only
 * read-only Mesh tool bridge. No transport, production auth, SDK or deployment.
 * All identity/permissions MUST come from the trusted host, not request _meta.
 */
export const SYNTHETIC_MCP_VERSION = '2026-07-28';

const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const CLIENT_KEY = 'io.modelcontextprotocol/clientInfo';
const SERVER_KEY = 'io.modelcontextprotocol/serverInfo';

function record(value, keys, required = []) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const names = Reflect.ownKeys(value);
    if (names.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
    if (required.some(key => !names.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const copy = Object.create(null);
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(descriptors[name], 'value')) return null;
      copy[name] = descriptors[name].value;
    }
    return copy;
  } catch {
    return null;
  }
}
function validId(id) {
  return (typeof id === 'string' && id.length > 0 && id.length <= 64) ||
    (typeof id === 'number' && Number.isSafeInteger(id));
}
const rpcError = (id, code, message) => ({
  jsonrpc: '2.0', id: validId(id) ? id : null, error: { code, message },
});
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });

function validMeta(raw) {
  const meta = record(raw, [VERSION_KEY, CAPABILITIES_KEY, CLIENT_KEY], [VERSION_KEY, CAPABILITIES_KEY]);
  if (!meta || meta[VERSION_KEY] !== SYNTHETIC_MCP_VERSION) return false;
  if (!record(meta[CAPABILITIES_KEY], [])) return false; // fixture supports no advertised client features
  if (Object.prototype.hasOwnProperty.call(meta, CLIENT_KEY)) {
    const client = record(meta[CLIENT_KEY], ['name', 'version'], ['name', 'version']);
    if (!client || typeof client.name !== 'string' || client.name.length < 1 || client.name.length > 100 ||
        typeof client.version !== 'string' || client.version.length < 1 || client.version.length > 40) return false;
  }
  return true;
}

/** Host must supply a previously authenticated context and independent permit. */
export function createSyntheticStatelessMcpDispatcher(bridge, { isAuthenticated } = {}) {
  if (!bridge || typeof bridge.listTools !== 'function' || typeof bridge.callTool !== 'function' ||
      typeof isAuthenticated !== 'function') {
    throw new TypeError('Synthetic bridge and trusted authentication check required');
  }
  return Object.freeze({
    async dispatch(envelope, trustedContext) {
      const rpc = record(envelope, ['jsonrpc', 'id', 'method', 'params'],
        ['jsonrpc', 'id', 'method', 'params']);
      if (!rpc || rpc.jsonrpc !== '2.0' || !validId(rpc.id) ||
          typeof rpc.method !== 'string') return rpcError(null, -32600, 'Invalid request');
      const params = record(rpc.params, ['_meta', 'name', 'arguments'], ['_meta']);
      if (!params || !validMeta(params._meta)) return rpcError(rpc.id, -32602, 'Invalid params');
      // The protocol envelope's client identity is explicitly NOT authentication.
      let authenticated = false;
      try { authenticated = isAuthenticated(trustedContext) === true; } catch { /* default deny */ }
      if (!authenticated) return rpcError(rpc.id, -32000, 'Capability unavailable');
      try {
        if (rpc.method === 'server/discover') {
          if (Reflect.ownKeys(params).length !== 1) return rpcError(rpc.id, -32602, 'Invalid params');
          return reply(rpc.id, {
            resultType: 'complete',
            supportedVersions: [SYNTHETIC_MCP_VERSION],
            capabilities: { tools: {} },
            _meta: { [SERVER_KEY]: { name: 'goreecloud-mesh-synthetic', version: '0.0.1' } },
            instructions: 'Synthetic-only status fixtures. No live service, health or deployment assertion.',
          });
        }
        if (rpc.method === 'tools/list') {
          if (Reflect.ownKeys(params).length !== 1) return rpcError(rpc.id, -32602, 'Invalid params');
          return reply(rpc.id, { resultType: 'complete', tools: bridge.listTools() });
        }
        if (rpc.method === 'tools/call') {
          if (!Object.prototype.hasOwnProperty.call(params, 'name') ||
              typeof params.name !== 'string' || params.name.length > 120 ||
              Reflect.ownKeys(params).some(key => !['_meta', 'name', 'arguments'].includes(key))) {
            return rpcError(rpc.id, -32602, 'Invalid params');
          }
          // Model arguments are never copied into trustedContext.
          if (Object.prototype.hasOwnProperty.call(params, 'arguments') &&
              !record(params.arguments, [])) return rpcError(rpc.id, -32602, 'Invalid params');
          const result = await bridge.callTool(params.name, params.arguments ?? {}, trustedContext);
          if (!result || !Array.isArray(result.content) || result.content.length !== 1 ||
              result.content[0]?.type !== 'text' ||
              typeof result.content[0].text !== 'string' ||
              result.content[0].text.length > 4096) {
            return rpcError(rpc.id, -32000, 'Capability unavailable');
          }
          return reply(rpc.id, {
            resultType: 'complete', content: [{ type: 'text', text: result.content[0].text }],
            isError: result.isError === true,
          });
        }
        return rpcError(rpc.id, -32601, 'Method not found');
      } catch {
        return rpcError(rpc.id, -32000, 'Capability unavailable');
      }
    },
  });
}
