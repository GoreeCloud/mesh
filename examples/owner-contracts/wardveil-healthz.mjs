// Transport-injected, nonproduction Wardveil owner-contract fixture.
// Verified against GoreeCloud/wardveil main server.go blob e4d8d68a9a1ed5c2fb28c6fc9c6956c2027c548a.
// No fetch, sockets, credentials, hostnames, implicit authorization or external data access.
export const WARDVEIL_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/wardveil',
  source_blob: 'e4d8d68a9a1ed5c2fb28c6fc9c6956c2027c548a',
  method: 'GET',
  path: '/healthz',
  mode: 'transport-injected-nonproduction',
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function snapshot(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const actual = Reflect.ownKeys(value);
    if (actual.some(key => !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of actual) {
      const desc = descriptors[key];
      if (!desc || !own(desc, 'value')) return null;
      result[key] = desc.value;
    }
    return result;
  } catch {
    return null;
  }
}

function parseResponse(response) {
  const fields = snapshot(response, ['status', 'contentType', 'body']);
  if (!fields || !['status', 'contentType', 'body'].every(key => own(fields, key)) ||
      fields.contentType !== 'application/json; charset=utf-8' ||
      !Number.isInteger(fields.status) || typeof fields.body !== 'string' ||
      Buffer.byteLength(fields.body, 'utf8') > 256) {
    throw new Error('health probe unavailable');
  }
  // Restrictive source-contract fixtures reject unknown fields, duplicate keys,
  // escaped aliases, and ambiguous/attacker-supplied JSON before any projection.
  if (fields.status === 200 && /^\{\s*"status"\s*:\s*"ok"\s*\}\s*$/.test(fields.body)) {
    return 'ok';
  }
  if (fields.status === 503 &&
      /^\{\s*"error"\s*:\s*"event ingestion unavailable"\s*\}\s*$/.test(fields.body)) {
    return 'degraded';
  }
  throw new Error('health probe unavailable');
}

/**
 * A local contract acceptance adapter for the exact Wardveil /healthz response.
 * `transport` is a trusted, injected function; it receives only method, fixed
 * path and abort signal. It is NOT an HTTP client. A real connector still needs
 * endpoint pinning, trusted Identity policy, transport security and owner review.
 */
export function createWardveilHealthFixtureAdapter(options) {
  const settings = snapshot(options, ['transport', 'permit', 'clock']);
  if (!settings || typeof settings.transport !== 'function' ||
      (own(settings, 'permit') && typeof settings.permit !== 'function') ||
      (own(settings, 'clock') && typeof settings.clock !== 'function')) {
    throw new TypeError('invalid Wardveil fixture adapter options');
  }
  const transport = settings.transport;
  const permit = settings.permit ?? (() => false);
  const clock = settings.clock ?? (() => new Date().toISOString());

  return Object.freeze({
    async authorize(actor, capability, { signal } = {}) {
      // This local policy is not equivalent to authorization by the real owner.
      try {
        if (signal?.aborted) return false;
        return await permit(actor, capability, { signal }) === true;
      } catch {
        return false;
      }
    },
    async readStatus({ signal } = {}) {
      if (signal?.aborted) throw new Error('health probe unavailable');
      let response;
      try {
        response = await transport({ method: 'GET', path: '/healthz', signal });
      } catch {
        throw new Error('health probe unavailable');
      }
      if (signal?.aborted) throw new Error('health probe unavailable');
      const state = parseResponse(response);
      let observed_at;
      try {
        observed_at = clock();
        if (typeof observed_at !== 'string' || !Number.isFinite(Date.parse(observed_at)) ||
            new Date(observed_at).toISOString() !== observed_at) throw new Error('invalid clock');
      } catch {
        throw new Error('health probe unavailable');
      }
      return { state, observed_at };
    },
  });
}
