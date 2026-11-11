/** Nonproduction, dependency-free, fail-closed Mesh capability registry. */
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const KINDS = new Set(['tool', 'resource', 'prompt']);
const CLASSIFICATIONS = new Set(['public', 'internal', 'sensitive']);
function fail(message) { throw new TypeError(message); }
function exactKeys(obj, allowed, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(`${label}: object required`);
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) fail(`${label}: unexpected field ${key}`);
}
function nonempty(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail(`${label}: invalid string`); return value; }
function frozenCopy(value) { return Object.freeze(structuredClone(value)); }
export class CapabilityRegistry {
  #items = new Map();
  register(input) {
    exactKeys(input, ['id','version','owner','kind','access','scopes','classification','timeoutMs','maxOutputBytes'], 'capability');
    const id = nonempty(input.id, 'id');
    if (!IDENTIFIER.test(id) || !id.includes('.')) fail('id: namespaced identifier required');
    if (typeof input.version !== 'string' || !VERSION.test(input.version)) fail('version: semantic version required');
    const owner = nonempty(input.owner, 'owner');
    if (!KINDS.has(input.kind)) fail('kind: invalid');
    if (!['read','write'].includes(input.access)) fail('access: invalid');
    if (!CLASSIFICATIONS.has(input.classification)) fail('classification: invalid');
    if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > 32 || !input.scopes.every(s => typeof s === 'string' && IDENTIFIER.test(s))) fail('scopes: invalid');
    if (new Set(input.scopes).size !== input.scopes.length) fail('scopes: duplicate');
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000) fail('timeoutMs: invalid');
    if (!Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes < 1 || input.maxOutputBytes > 1048576) fail('maxOutputBytes: invalid');
    const key = `${id}@${input.version}`;
    if (this.#items.has(key)) fail('capability: duplicate');
    this.#items.set(key, frozenCopy({...input, id, owner, scopes:[...input.scopes]}));
  }
  discover(context, authorize) {
    if (!validContext(context) || typeof authorize !== 'function') return [];
    return [...this.#items.values()].filter(item => permitted(context, item, authorize)).map(frozenCopy);
  }
  resolve(id, version, context, authorize) {
    if (!validContext(context) || typeof authorize !== 'function') return null;
    const item = this.#items.get(`${id}@${version}`);
    return item && permitted(context, item, authorize) ? frozenCopy(item) : null;
  }
}
function validContext(context) {
  return !!context && typeof context === 'object' && !Array.isArray(context) &&
    typeof context.actor === 'string' && context.actor.length > 0 &&
    typeof context.tenant === 'string' && context.tenant.length > 0 &&
    Array.isArray(context.scopes) && context.scopes.every(s => typeof s === 'string') &&
    context.authenticated === true;
}
function permitted(context, item, authorize) {
  if (!item.scopes.every(s => context.scopes.includes(s))) return false;
  try { return authorize(context, item) === true; } catch { return false; }
}
