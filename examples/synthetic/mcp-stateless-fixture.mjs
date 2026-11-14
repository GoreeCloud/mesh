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
const SYNTHETIC_TOOL_NAME = /^mesh__[a-z][a-z0-9_-]{1,63}__status_read$/;

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
          !SYNTHETIC_TOOL_NAME.test(data.name) ||
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
      // Tool names are validated above, but presentation metadata is never
      // promoted from an injected bridge into an AI client's instruction
      // surface. Pin the minimal synthetic-only meaning locally.
      tools.push({
        name: data.name,
        title: 'Synthetic status fixture',
        description: 'Local-only synthetic status contract. No live service, health, or deployment assertion.',
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
    // Owner error strings may contain private details or attempted prompt
    // injection. A successful owner text is also untrusted: accept only the
    // exact canonical JSON shape that the synthetic status bridge generates.
    if (outer.isError === true) {
      return { content: [{ type: 'text', text: 'Capability unavailable.' }], isError: true };
    }
    let rawStatus;
    try { rawStatus = JSON.parse(element.text); } catch { return null; }
    const status = record(rawStatus, [
      'evidence_status', 'environment', 'state', 'observed_at',
    ], ['evidence_status', 'environment', 'state', 'observed_at']);
    if (!status || status.evidence_status !== 'prototype' ||
        status.environment !== 'synthetic-local-only' ||
        !['ok', 'degraded'].includes(status.state) ||
        typeof status.observed_at !== 'string') return null;
    const instant = Date.parse(status.observed_at);
    if (!Number.isFinite(instant) ||
        new Date(instant).toISOString() !== status.observed_at) return null;
    const projected = JSON.stringify({
      evidence_status: 'prototype', environment: 'synthetic-local-only',
      state: status.state, observed_at: status.observed_at,
    });
    // Reject duplicate JSON keys, alternate encodings, and extraneous content.
    // Real synthetic bridge outputs already use this exact serializer/order.
    if (element.text !== projected) return null;
    return { content: [{ type: 'text', text: projected }], isError: false };
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
  const settings = record(options, [
    'isAuthenticated', 'isToolAuthorized', 'maxConcurrentCalls', 'maxConcurrentPerActor',
    'maxConcurrentPerTool', 'maxCallsPerActorWindow', 'actorWindowMs', 'callTimeoutMs',
  ], ['isAuthenticated']);
  if (!methods || !settings || typeof methods.listTools !== 'function' ||
      typeof methods.callTool !== 'function' ||
      typeof settings.isAuthenticated !== 'function' ||
      (settings.isToolAuthorized !== undefined &&
       typeof settings.isToolAuthorized !== 'function')) {
    throw new TypeError('Synthetic bridge and trusted authentication check required');
  }
  const { isAuthenticated, isToolAuthorized } = settings;
  const authenticatedHost = context => {
    try {
      const decision = Reflect.apply(isAuthenticated, undefined, [context]);
      if (decision && typeof decision.then === 'function') {
        // A mistaken async callback never grants access or leaves an
        // unhandled rejection in the local fixture.
        Promise.resolve(decision).catch(() => {});
      }
      return decision === true;
    } catch {
      return false;
    }
  };
  // This optional synthetic gate is supplied by the trusted host, never
  // through client metadata. Production Identity and consent remain separate.
  const permittedTool = (context, name) => {
    if (isToolAuthorized === undefined) return true;
    try {
      const decision = Reflect.apply(isToolAuthorized, undefined, [context, name]);
      if (decision && typeof decision.then === 'function') {
        // Mistaken async grants never authorize this request. Consume their
        // rejections without allowing the owner operation to start.
        Promise.resolve(decision).catch(() => {});
      }
      return decision === true;
    } catch {
      return false;
    }
  };
  const maxConcurrentCalls = settings.maxConcurrentCalls === undefined ? 4 : settings.maxConcurrentCalls;
  // Optional local fairness constraint. A trusted host MUST bind actor to a
  // verified principal; model-provided clientInfo never chooses a quota key.
  const maxConcurrentPerActor = settings.maxConcurrentPerActor;
  // Optional per-tool admission prevents one hung synthetic owner from
  // consuming every slot available to independent owner reads.
  const maxConcurrentPerTool = settings.maxConcurrentPerTool;
  // Optional fixed-window quota for admitted synthetic reads. Unlike a
  // concurrency cap, this limits fast sequential calls from the same actor.
  const maxCallsPerActorWindow = settings.maxCallsPerActorWindow;
  const actorWindowMs = settings.actorWindowMs === undefined ? 1000 : settings.actorWindowMs;
  const callTimeoutMs = settings.callTimeoutMs === undefined ? 2000 : settings.callTimeoutMs;
  const listTools = methods.listTools;
  const callTool = methods.callTool;
  if (!Number.isInteger(maxConcurrentCalls) || maxConcurrentCalls < 1 || maxConcurrentCalls > 16 ||
      (maxConcurrentPerActor !== undefined &&
        (!Number.isInteger(maxConcurrentPerActor) || maxConcurrentPerActor < 1 ||
         maxConcurrentPerActor > maxConcurrentCalls)) ||
      (maxConcurrentPerTool !== undefined &&
        (!Number.isInteger(maxConcurrentPerTool) || maxConcurrentPerTool < 1 ||
         maxConcurrentPerTool > maxConcurrentCalls)) ||
      (maxCallsPerActorWindow !== undefined &&
        (!Number.isInteger(maxCallsPerActorWindow) || maxCallsPerActorWindow < 1 ||
         maxCallsPerActorWindow > 64)) ||
      (settings.actorWindowMs !== undefined && maxCallsPerActorWindow === undefined) ||
      !Number.isInteger(actorWindowMs) || actorWindowMs < 100 || actorWindowMs > 60000 ||
      !Number.isInteger(callTimeoutMs) || callTimeoutMs < 1 || callTimeoutMs > 30000) {
    throw new RangeError('Invalid synthetic MCP admission limits');
  }
  // A timed-out caller never frees a worker slot. Only the actual owner
  // promise settling can do so, preventing runaway work after a timeout.
  let inFlight = 0;
  const byActor = new Map(); // bounded by global admitted workers, not remote claims
  const byTool = new Map(); // at most maxConcurrentCalls <=16 active entries
  const actorWindows = new Map();
  const maxTrackedActors = 128; // bounded memory, even for rapidly rotating actors
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
      if (!authenticatedHost(host)) return rpcError(rpc.id, -32000, 'Capability unavailable');
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
          return reply(rpc.id, {
            resultType: 'complete',
            tools: tools.filter(tool => permittedTool(host, tool.name)),
          });
        }
        if (rpc.method === 'tools/call') {
          if (!Object.prototype.hasOwnProperty.call(params, 'name') ||
              typeof params.name !== 'string' || !SYNTHETIC_TOOL_NAME.test(params.name) ||
              Reflect.ownKeys(params).some(key => !['_meta', 'name', 'arguments'].includes(key))) {
            return rpcError(rpc.id, -32602, 'Invalid params');
          }
          // Model arguments are never copied into trustedContext.
          if (Object.prototype.hasOwnProperty.call(params, 'arguments') &&
              !record(params.arguments, [])) return rpcError(rpc.id, -32602, 'Invalid params');
          // Deny before reserving global/per-actor capacity or contacting
          // the tool owner. A model cannot grant itself visibility by name.
          if (!permittedTool(host, params.name)) {
            return rpcError(rpc.id, -32000, 'Capability unavailable');
          }
          // When per-actor fairness is enabled, reject principals without a
          // bounded host-authenticated key instead of pooling them as "guest".
          const actorQuotaEnabled = maxConcurrentPerActor !== undefined ||
            maxCallsPerActorWindow !== undefined;
          const actor = actorQuotaEnabled ? host.actor : null;
          if (actorQuotaEnabled &&
              (typeof actor !== 'string' ||
               !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(actor))) {
            return rpcError(rpc.id, -32000, 'Capability unavailable');
          }
          if (inFlight >= maxConcurrentCalls ||
              (maxConcurrentPerActor !== undefined &&
               (byActor.get(actor) ?? 0) >= maxConcurrentPerActor) ||
              (maxConcurrentPerTool !== undefined &&
               (byTool.get(params.name) ?? 0) >= maxConcurrentPerTool)) {
            return rpcError(rpc.id, -32000, 'Capability unavailable');
          }
          if (maxCallsPerActorWindow !== undefined) {
            const now = Date.now();
            // Expired quotas are forgotten; new keys are refused if the
            // bounded local ledger is full, never allowed to grow forever.
            for (const [key, window] of actorWindows) {
              if (now - window.startedAt >= actorWindowMs) actorWindows.delete(key);
            }
            const current = actorWindows.get(actor);
            if ((!current && actorWindows.size >= maxTrackedActors) ||
                (current && current.count >= maxCallsPerActorWindow)) {
              return rpcError(rpc.id, -32000, 'Capability unavailable');
            }
            actorWindows.set(actor, current
              ? { startedAt: current.startedAt, count: current.count + 1 }
              : { startedAt: now, count: 1 });
          }
          inFlight += 1;
          if (maxConcurrentPerActor !== undefined) {
            byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
          }
          if (maxConcurrentPerTool !== undefined) {
            byTool.set(params.name, (byTool.get(params.name) ?? 0) + 1);
          }
          // Timeout never frees global OR per-actor capacity until the owner
          // promise settles. Delete idle actor entries to bound retained keys.
          const operation = Promise.resolve()
            .then(() => {
              // Recheck immediately before the deferred owner invocation:
              // permissions can be revoked between initial admission and
              // this microtask. No stale admission confers ongoing authority.
              if (!authenticatedHost(host) || !permittedTool(host, params.name)) return null;
              return Reflect.apply(callTool, bridge, [params.name, params.arguments ?? {}, host]);
            })
            .catch(() => null)
            .finally(() => {
              inFlight -= 1;
              if (maxConcurrentPerActor !== undefined) {
                const remaining = (byActor.get(actor) ?? 1) - 1;
                if (remaining === 0) byActor.delete(actor);
                else byActor.set(actor, remaining);
              }
              if (maxConcurrentPerTool !== undefined) {
                const remaining = (byTool.get(params.name) ?? 1) - 1;
                if (remaining === 0) byTool.delete(params.name);
                else byTool.set(params.name, remaining);
              }
            });
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
          // A read may outlive its permission. Do not disclose its completed
          // response when trusted authentication or tool consent is withdrawn
          // while the owner was running. This is a response gate, not a claim
          // that source-owned processing was cancelled.
          if (!authenticatedHost(host) || !permittedTool(host, params.name)) {
            return rpcError(rpc.id, -32000, 'Capability unavailable');
          }
          return reply(rpc.id, { resultType: 'complete', ...output });
        }
        return rpcError(rpc.id, -32601, 'Method not found');
      } catch {
        return rpcError(rpc.id, -32000, 'Capability unavailable');
      }
    },
  });
}
