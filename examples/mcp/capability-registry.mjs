/** Nonproduction capability registry. Strict own-data validation, no network or writes. */
const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const KINDS = new Set(['tool', 'resource', 'prompt']);
const ACCESS = new Set(['read', 'write']);
const CLASSIFICATIONS = new Set(['public', 'internal', 'sensitive']);
const FIELDS = ['id', 'version', 'owner', 'kind', 'access', 'scopes', 'classification', 'timeoutMs', 'maxOutputBytes'];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const invalid = (field) => { throw new TypeError(field + ': invalid or unsupported value'); };
/** Never access user-provided properties by ordinary property reads before checking descriptors. */
function snapshot(value, allowed, label) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) invalid(label);
    const names = Reflect.ownKeys(value);
    if (names.some(name => typeof name !== 'string' || !allowed.includes(name))) throw new TypeError(label + ': unexpected field');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const out = Object.create(null);
    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !hasOwn(descriptor, 'value')) invalid(name);
      out[name] = descriptor.value;
    }
    return out;
  } catch (error) {
    if (error instanceof TypeError && error.message === label + ': unexpected field') throw error;
    invalid(label);
  }
}
function scopeCopy(value) {
  try {
    if (!Array.isArray(value)) invalid('scopes');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const size = descriptors.length?.value;
    if (!Number.isInteger(size) || size < 1 || size > 32) invalid('scopes');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== size + 1 || keys.some(k => k !== 'length' && !/^(0|[1-9]\d*)$/.test(String(k)))) invalid('scopes');
    const result = [];
    for (let index = 0; index < size; index++) {
      const entry = descriptors[String(index)];
      if (!entry || !hasOwn(entry, 'value') || typeof entry.value !== 'string' || !ID.test(entry.value)) invalid('scopes');
      result.push(entry.value);
    }
    if (new Set(result).size !== size) throw new TypeError('scopes: duplicate');
    return result;
  } catch (e) {
    if (e instanceof TypeError && e.message === 'scopes: duplicate') throw e;
    invalid('scopes');
  }
}
function contextCopy(input) {
  try {
    const context = snapshot(input, ['actor', 'tenant', 'authenticated', 'scopes'], 'context');
    if (context.authenticated !== true || typeof context.actor !== 'string' || context.actor.length < 1 ||
      context.actor.length > 256 || typeof context.tenant !== 'string' || context.tenant.length < 1 || context.tenant.length > 256) return null;
    const scopes = scopeCopy(context.scopes);
    return Object.freeze({actor: context.actor, tenant: context.tenant, authenticated: true, scopes: Object.freeze(scopes)});
  } catch { return null; }
}
function immutableItem(item) {
  return Object.freeze({...item, scopes: Object.freeze([...item.scopes])});
}
function publicItem(item) { return {...item, scopes: [...item.scopes]}; }
function permitted(actor, item, authorize) {
  if (!item.scopes.every(scope => actor.scopes.includes(scope))) return false;
  try { return authorize(actor, item) === true; } catch { return false; }
}
export function snapshotMcpActor(input) { return contextCopy(input); }
export class CapabilityRegistry {
  #items = new Map();
  register(input) {
    const data = snapshot(input, FIELDS, 'capability');
    for (const field of FIELDS) if (!hasOwn(data, field)) invalid(field);
    if (typeof data.id !== 'string' || data.id.length > 128 || !ID.test(data.id) || !data.id.includes('.')) throw new TypeError('id: namespaced identifier required');
    if (typeof data.version !== 'string' || !VERSION.test(data.version)) invalid('version');
    if (typeof data.owner !== 'string' || data.owner.length > 128 || !ID.test(data.owner)) invalid('owner');
    if (!KINDS.has(data.kind)) invalid('kind');
    if (!ACCESS.has(data.access)) invalid('access');
    if (!CLASSIFICATIONS.has(data.classification)) invalid('classification');
    const scopes = scopeCopy(data.scopes);
    if (!Number.isSafeInteger(data.timeoutMs) || data.timeoutMs < 1 || data.timeoutMs > 30000) invalid('timeoutMs');
    if (!Number.isSafeInteger(data.maxOutputBytes) || data.maxOutputBytes < 1 || data.maxOutputBytes > 1048576) invalid('maxOutputBytes');
    const key = data.id + '@' + data.version;
    if (this.#items.has(key)) throw new TypeError('capability: duplicate');
    this.#items.set(key, immutableItem({...data, scopes}));
  }
  discover(context, authorize) {
    const actor = contextCopy(context);
    if (!actor || typeof authorize !== 'function') return [];
    const visible = [];
    for (const item of this.#items.values()) if (permitted(actor, item, authorize)) visible.push(publicItem(item));
    return visible;
  }
  resolve(id, version, context, authorize) {
    const actor = contextCopy(context);
    if (!actor || typeof authorize !== 'function' || typeof id !== 'string' || typeof version !== 'string') return null;
    const item = this.#items.get(id + '@' + version);
    return item && permitted(actor, item, authorize) ? publicItem(item) : null;
  }
}
