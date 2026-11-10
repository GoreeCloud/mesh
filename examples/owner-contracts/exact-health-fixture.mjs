// Transport-injected, nonproduction health projection. No sockets or secrets.
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

function snapshot(value, allowed, required = allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => !allowed.includes(key)) ||
        required.some(key => !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of keys) {
      if (!descriptors[key] || !own(descriptors[key], 'value')) return null;
      result[key] = descriptors[key].value;
    }
    return result;
  } catch {
    return null;
  }
}

function unavailable() { return new Error('source health unavailable'); }

/**
 * Shared synthetic-only adapter for separately inspected owner health APIs.
 * The supplied transport is an injected function, not a network client.
 */
export function createExactHealthFixtureAdapter(options, contract) {
  const fields = snapshot(options, ['transport', 'permit', 'clock'], ['transport']);
  const source = snapshot(contract, ['path', 'body', 'contentType'], ['path', 'body']);
  // Defaults preserve existing owner contracts. DAV's PHP handler explicitly
  // sends application/json without a charset parameter; do not normalize it.
  const expectedContentType = source?.contentType ?? 'application/json; charset=utf-8';
  if (!fields || !source || typeof fields.transport !== 'function' ||
      (own(fields, 'permit') && typeof fields.permit !== 'function') ||
      (own(fields, 'clock') && typeof fields.clock !== 'function') ||
      !['/healthz', '/api/v1/health', '/api/health'].includes(source.path) ||
      !['application/json', 'application/json; charset=utf-8'].includes(expectedContentType) ||
      typeof source.body !== 'string' || source.body.length > 128 ||
      Buffer.byteLength(source.body, 'utf8') > 128) {
    throw new TypeError('invalid owner health fixture options');
  }
  const { transport } = fields;
  const permit = fields.permit ?? (() => false);
  const clock = fields.clock ?? (() => new Date().toISOString());
  const { path, body } = source;
  return Object.freeze({
    async authorize(actor, capability, { signal } = {}) {
      try {
        if (signal?.aborted) return false;
        return (await permit(actor, capability, { signal })) === true && !signal?.aborted;
      } catch {
        return false;
      }
    },
    async readStatus({ signal } = {}) {
      if (signal?.aborted) throw unavailable();
      let response;
      try {
        response = await transport({ method: 'GET', path, signal });
      } catch {
        throw unavailable();
      }
      if (signal?.aborted) throw unavailable();
      const result = snapshot(response, ['status', 'contentType', 'body']);
      if (!result || result.status !== 200 ||
          result.contentType !== expectedContentType ||
          typeof result.body !== 'string' || result.body.length > 128 ||
          Buffer.byteLength(result.body, 'utf8') > 128 || result.body !== body) {
        throw unavailable();
      }
      let observed_at;
      try {
        observed_at = clock();
        if (typeof observed_at !== 'string' || !Number.isFinite(Date.parse(observed_at)) ||
            new Date(observed_at).toISOString() !== observed_at) throw unavailable();
      } catch {
        throw unavailable();
      }
      return { state: 'ok', observed_at };
    },
  });
}
