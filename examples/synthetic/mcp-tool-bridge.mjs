/**
 * MCP-shaped, in-process tool contract for synthetic Mesh status fixtures.
 * NOT a network/stdio MCP server or a client-compatibility certification.
 * A trusted host must authenticate its caller before passing trustedContext;
 * model-supplied arguments cannot choose an actor or elevate permissions.
 */
const CAPABILITY_ID = /^[a-z][a-z0-9.-]{1,63}$/;
const TOOL_PREFIX = 'mesh__';
const nameFor = id => TOOL_PREFIX + id.replaceAll('.', '_') + '__status_read';
const deny = () => ({ isError: true, content: [{ type: 'text', text: 'Capability unavailable.' }] });

export function createSyntheticMcpToolBridge(harness, { resolveActor } = {}) {
  if (!harness || typeof harness.discover !== 'function' || typeof harness.read !== 'function' ||
      typeof resolveActor !== 'function') {
    throw new TypeError('A synthetic harness and trusted actor resolver are required');
  }
  const map = new Map();
  for (const item of harness.discover()) {
    if (typeof item.id !== 'string' || !CAPABILITY_ID.test(item.id) ||
        item.operation !== 'status.read' || item.sensitivity !== 'synthetic' ||
        item.evidence_status !== 'prototype') {
      throw new TypeError('Only synthetic read-only status capabilities may be bridged');
    }
    const name = nameFor(item.id);
    if (map.has(name)) throw new TypeError('Tool name collision');
    map.set(name, item.id);
  }
  if (map.size === 0 || map.size > 32) throw new TypeError('Invalid synthetic inventory');
  const tools = Array.from(map.keys()).sort().map(name => ({
    name,
    title: 'Synthetic status fixture',
    description: 'Local-only synthetic status contract. Not a live service, verified health, or deployment.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }));
  return Object.freeze({
    listTools() {
      // Fresh independent snapshots so callers cannot mutate registry authority.
      return tools.map(tool => ({
        ...tool,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { ...tool.annotations },
      }));
    },
    async callTool(name, args, trustedContext) {
      if (typeof name !== 'string' || !map.has(name)) return deny();
      try {
        // A status read takes no model-supplied parameters (including actor IDs).
        if (args !== undefined &&
            (args === null || typeof args !== 'object' || Array.isArray(args) ||
             Object.getPrototypeOf(args) !== Object.prototype || Reflect.ownKeys(args).length)) {
          return deny();
        }
        // Only a trusted host supplies the context; no identity comes from args.
        const actor = resolveActor(trustedContext);
        if (typeof actor !== 'string') return deny();
        const result = await harness.read({ actor, capabilityId: map.get(name), operation: 'status.read' });
        if (result?.ok !== true || result.kind !== 'synthetic_result' ||
            result.evidence_status !== 'prototype' || !result.data) return deny();
        // Existing harness has already validated and bounded the exact source fields.
        const { state, observed_at } = result.data;
        if (!['ok', 'degraded'].includes(state) || typeof observed_at !== 'string') return deny();
        return { content: [{ type: 'text', text: JSON.stringify({
          evidence_status: 'prototype', environment: 'synthetic-local-only', state, observed_at,
        }) }] };
      } catch {
        return deny();
      }
    },
  });
}
