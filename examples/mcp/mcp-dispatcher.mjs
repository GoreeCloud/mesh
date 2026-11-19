/** Nonproduction in-process MCP JSON-RPC fixture: read-only, no network or credentials. */
import {CapabilityRegistry,snapshotMcpActor} from './capability-registry.mjs';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function record(value, allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const out = Object.create(null);
    for (const key of keys) {
      if (!descriptors[key] || !own(descriptors[key], 'value')) return null;
      out[key] = descriptors[key].value;
    }
    return out;
  } catch { return null; }
}
const error = (id, code, message) => ({jsonrpc:'2.0', id, error:{code, message}});
const success = (id, result) => ({jsonrpc:'2.0', id, result});
const toolName = item => item.id + '@' + item.version;
const inputSchema = Object.freeze({type:'object', properties:Object.freeze({}), additionalProperties:false});
const ownerFailure = () => ({content:[{type:'text', text:'Owner unavailable'}], isError:true});
/** Expects trusted injected owner function and explicit synchronous policy; not a deployable server. */
export function createMcpFixture(options) {
  const settings = record(options, ['registry','context','authorize','invoke','protocolVersion','maxConcurrent']);
  if (!settings) throw new TypeError('invalid fixture options');
  const {registry,context,authorize,invoke} = settings;
  const version = settings.protocolVersion ?? '2025-06-18';
  const limit = settings.maxConcurrent ?? 4;
  if (!(registry instanceof CapabilityRegistry) || Object.getPrototypeOf(registry) !== CapabilityRegistry.prototype ||
      typeof authorize !== 'function' || typeof invoke !== 'function' || version !== '2025-06-18' ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new TypeError('invalid fixture dependencies');
  let initialized = false;
  let ready = false;
  let active = 0;
  const list = actor => registry.discover(actor,authorize).filter(item => item.kind === 'tool' && item.access === 'read');
  return Object.freeze({async handle(request) {
    const r = record(request, ['jsonrpc','id','method','params']);
    if (!r || r.jsonrpc !== '2.0' || typeof r.method !== 'string' || r.method.length < 1 || r.method.length > 128)
      return error(null,-32600,'Invalid Request');
    const idValid = own(r,'id') && ((typeof r.id === 'string' && r.id.length <= 128) || Number.isSafeInteger(r.id));
    if (r.method === 'notifications/initialized' && !own(r,'id')) {
      if (own(r,'params') && !record(r.params, [])) return null;
      if (initialized) ready = true;
      return null;
    }
    if (!idValid || (own(r,'params') && !record(r.params, ['protocolVersion','capabilities','clientInfo','name','arguments','_meta','cursor'])))
      return error(null,-32600,'Invalid Request');
    const id = r.id;
    if (r.method === 'initialize') {
      const p = record(r.params, ['protocolVersion','capabilities','clientInfo']);
      if (!p || p.protocolVersion !== version || initialized) return error(id,-32602,'Unsupported or repeated initialization');
      initialized = true;
      return success(id,{protocolVersion:version, capabilities:{tools:{listChanged:false}},
        serverInfo:{name:'goreecloud-mesh-fixture', version:'0.0.1'}});
    }
    if (!ready) return error(id,-32000,'MCP initialization required');
    const actor = snapshotMcpActor(context);
    if (r.method === 'ping') return success(id,{});
    if (r.method === 'tools/list') {
      const p = record(r.params ?? {},['cursor']);
      if (!p || own(p,'cursor')) return error(id,-32602,'Invalid params');
      return success(id,{tools:list(actor).map(item => ({name:toolName(item),
        description:'Read-only development fixture',inputSchema}))});
    }
    if (r.method === 'tools/call') {
      const p = record(r.params,['name','arguments','_meta']);
      if (!p || typeof p.name !== 'string' || p.name.length > 300 || own(p,'_meta') ||
        (own(p,'arguments') && !record(p.arguments,[])))
        return error(id,-32602,'Invalid params');
      const found = list(actor).find(item => toolName(item) === p.name);
      if (!found) return error(id,-32602,'Unknown or unauthorized tool');
      const item = registry.resolve(found.id,found.version,actor,authorize);
      if (!item || item.kind !== 'tool' || item.access !== 'read') return error(id,-32602,'Unknown or unauthorized tool');
      if (active >= limit) return success(id,ownerFailure());
      const controller = new AbortController();
      active++;
      let timer;
      const task = Promise.resolve().then(() => invoke(item,actor,{signal:controller.signal}))
        .then(output => ({ok:true,output}), () => ({ok:false}))
        .finally(() => {active--;});
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => {controller.abort();resolve({ok:false});},item.timeoutMs);
      });
      const result = await Promise.race([task,timeout]);
      clearTimeout(timer);
      if (!result.ok || typeof result.output !== 'string' ||
        Buffer.byteLength(result.output,'utf8') > item.maxOutputBytes) return success(id,ownerFailure());
      return success(id,{content:[{type:'text',text:result.output}],isError:false});
    }
    return error(id,-32601,'Method not found');
  }});
}
