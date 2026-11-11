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

// Tool metadata crosses into the client-visible JSON-RPC result. Treat an
// injected bridge's output as untrusted even when the bridge itself was wired
// by a host. Snapshot only a fixed, read-only synthetic schema.
function safeToolCatalog(raw) {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) return null;
    const members = Object.getOwnPropertyDescriptors(raw);
    const size = members.length?.value;
    if (!Number.isInteger(size) || size > 32) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== size + 1) return null;
    if (keys.some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) ||
         Number(key) >= size))) return null;
    const tools = [];
    const names = new Set();
    for (let i = 0; i < size; i++) {
      const slot = members[String(i)];
      if (!slot || !Object.prototype.hasOwnProperty.call(slot, 'value')) return null;
      const data = record(slot.value,
        ['name', 'title', 'description', 'inputSchema', 'annotations'],
        ['name', 'title', 'description', 'inputSchema', 'annotations']);
      if (!data || typeof data.name !== 'string' ||
          !/^mesh__[a-z][a-z0-9_-]{1,63}__status_read$/.test(data.name) ||
          names.has(data.name) ||
          typeof data.title !== 'string' || data.title.length < 1 ||
          data.title.length > 80 ||
          typeof data.description !== 'string' || data.description.length < 1 ||
          data.description.length > 250) return null;
      const schema = record(data.inputSchema,
        ['type', 'properties', 'additionalProperties'],
        ['type', 'properties', 'additionalProperties']);
      const hints = record(data.annotations,
        ['readOnlyHint', 'destructiveHint', 'openWorldHint'],
        ['readOnlyHint', 'destructiveHint', 'openWorldHint']);
      if (!schema || schema.type !== 'object' ||
          !record(schema.properties, []) ||
          schema.additionalProperties !== false ||
          !hints || hints.readOnlyHint !== true ||
          hints.destructiveHint !== false || hints.openWorldHint !== false) return null;
      names.add(data.name);
      tools.push({
        name: data.name, title: data.title, description: data.description,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      });
    }
    return tools;
  } catch {
    return null;
  }
}

// Read only inert own-data tool results. Accessor-backed or exotic owner
// outputs must never run a getter as an accidental side effect of projection.
function safeToolResult(raw) {
  try {
    const outer = record(raw, ['content', 'isError'], ['content']);
    if (!outer || (Object.prototype.hasOwnProperty.call(outer, 'isError') &&
        typeof outer.isError !== 'boolean')) return null;
    const content = outer.content;
    if (!Array.isArray(content) || Object.getPrototypeOf(content) !== Array.prototype) return null;
    const entries = Object.getOwnPropertyDescriptors(content);
    if (entries.length?.value !== 1 || Reflect.ownKeys(content).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(entries['0'] ?? {}, 'value')) return null;
    const element = record(entries['0'].value, ['type', 'text'], ['type', 'text']);
    // An ASCII-only JS character count is not a transport byte budget:
    // non-ASCII text can be substantially larger on the UTF-8 wire.
    if (!element || element.type !== 'text' || typeof element.text !== 'string' ||
        Buffer.byteLength(element.text, 'utf8') > 4096) return null;
    return { content: [{ type: 'text', text: element.text }], isError: outer.isError === true };
  } catch { return null; }
}

// The host context is an identity/authorization input. Capture its inert,
// bounded values BEFORE synchronous authentication and the deferred owner call,
// so caller-side mutation or accessor properties cannot swap the actor between
// admission and execution. This fixture deliberately accepts scalar context
// attributes only; production Identity claims require a separate verified type.
function snapshotHostContext(raw) {
  try {
    if (raw === undefined) return Object.freeze(Object.create(null));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const names = Reflect.ownKeys(raw);
    if (names.length > 16 || names.some(name =>
        typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ||
        ['constructor', 'prototype', '__proto__'].includes(name))) return null;
    const data = record(raw, names);
    if (!data) return null;
    for (const name of names) {
      const value = data[name];
      if (value === null || typeof value === 'boolean') continue;
      if (typeof value === 'string' && value.length <= 256) continue;
      if (typeof value === 'number' && Number.isSafeInteger(value)) continue;
      return null; // no nested objects, functions, symbols or async principals
    }
    return Object.freeze(data);
  } catch { return null; }
}

/** Host must supply a previously authenticated context and independent permit. */
export function createSyntheticStatelessMcpDispatcher(bridge, options = {}) {
  // The host registration is a security boundary: do not evaluate getters,
  // accept unexpected configuration, or permit callback replacement midflight.
  const methods = record(bridge, ['listTools', 'callTool'], ['listTools', 'callTool']);
  const settings = record(options, ['isAuthenticated', 'maxConcurrentCalls', 'callTimeoutMs'],
    ['isAuthenticated']);
  if (!methods || !settings || typeof methods.listTools !== 'function' ||
      typeof methods.callTool !== 'function' ||
      typeof settings.isAuthenticated !== 'function') {
    throw new TypeError('Synthetic bridge and trusted authentication check required');
  }
  const { isAuthenticated } = settings;
  const maxConcurrentCalls = settings.maxConcurrentCalls === undefined ? 4 : settings.maxConcurrentCalls;
  const callTimeoutMs = settings.callTimeoutMs === undefined ? 2000 : settings.callTimeoutMs;
  const listTools = methods.listTools;
  const callTool = methods.callTool;
  if (!Number.isInteger(maxConcurrentCalls) || maxConcurrentCalls < 1 || maxConcurrentCalls > 16 ||
      !Number.isInteger(callTimeoutMs) || callTimeoutMs < 1 || callTimeoutMs > 30000) {
    throw new RangeError('Invalid synthetic MCP admission limits');
  }
  // A timed-out caller never frees a worker slot. Only the actual owner
  // promise settling can do so, preventing runaway work after a timeout.
  let inFlight = 0;
  return Object.freeze({
    async dispatch(envelope, trustedContext) {
      const rpc = record(envelope, ['jsonrpc', 'id', 'method', 'params'],
        ['jsonrpc', 'id', 'method', 'params']);
      if (!rpc || rpc.jsonrpc !== '2.0' || !validId(rpc.id) ||
          typeof rpc.method !== 'string') return rpcError(null, -32600, 'Invalid request');
      const params = record(rpc.params, ['_meta', 'name', 'arguments'], ['_meta']);
      if (!params || !validMeta(params._meta)) return rpcError(rpc.id, -32602, 'Invalid params');
      // Snapshot before authorization; do not give the owner mutable caller
      // context after a synchronous host decision has already granted entry.
      const host = snapshotHostContext(trustedContext);
      if (!host) return rpcError(rpc.id, -32000, 'Capability unavailable');
      // The protocol envelope's client identity is explicitly NOT authentication.
      let authenticated = false;
      try {
        const decision = isAuthenticated(host);
        if (decision && typeof decision.then === 'function') {
          // Asynchronous decisions do not confer permissions. Consume eventual
          // rejection so a mistaken host callback cannot crash the process.
          Promise.resolve(decision).catch(() => {});
        }
        authenticated = decision === true;
      } catch { /* default deny */ }
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
          const tools = safeToolCatalog(Reflect.apply(listTools, bridge, []));
          if (!tools) return rpcError(rpc.id, -32000, 'Capability unavailable');
          return reply(rpc.id, { resultType: 'complete', tools });
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
          if (inFlight >= maxConcurrentCalls) {
            return rpcError(rpc.id, -32000, 'Capability unavailable');
          }
          inFlight += 1;
          // Catch owner failures, and hold admission until work REALLY settles.
          // Promise.race limits the waiting caller, not the untrusted execution.
          const operation = Promise.resolve()
            .then(() => Reflect.apply(callTool, bridge, [params.name, params.arguments ?? {}, host]))
            .catch(() => null)
            .finally(() => { inFlight -= 1; });
          let timer;
          let result;
          try {
            result = await Promise.race([
              operation,
              new Promise(resolve => { timer = setTimeout(() => resolve(null), callTimeoutMs); }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          const output = safeToolResult(result);
          if (!output) return rpcError(rpc.id, -32000, 'Capability unavailable');
          return reply(rpc.id, { resultType: 'complete', ...output });
        }
        return rpcError(rpc.id, -32601, 'Method not found');
      } catch {
        return rpcError(rpc.id, -32000, 'Capability unavailable');
      }
    },
  });
}
