// Nonproduction, transport-injected Mesh acceptance adapter for Wardveil's
// owner-authenticated, opt-in /v1/status source contract. No networking here.
// Not a production Identity, TLS, consent, or Wardveil security-policy adapter.
export const WARDVEIL_STATUS_VERSION = 'wardveil.status.v1';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function snapshot(value, keys, required = keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const actual = Reflect.ownKeys(value);
    if (actual.some(key => !keys.includes(key)) || required.some(key => !actual.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const fields = Object.create(null);
    for (const key of actual) {
      if (!descriptors[key] || !own(descriptors[key], 'value')) return null;
      fields[key] = descriptors[key].value;
    }
    return fields;
  } catch {
    return null;
  }
}

function unavailable() { return new Error('Wardveil scoped status unavailable'); }

// Exact official Go JSON encoder shape and order, with zero arbitrary fields.
// Avoid JSON.parse's silent duplicate-key overwrites at a trust boundary.
const BODY = /^\{"schema_version":"wardveil\.status\.v1","state":"(ok|degraded)","observed_at":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z)"\}\n$/;

export function createWardveilScopedStatusAdapter(options) {
  const fields = snapshot(options, ['transport', 'permit', 'clock'], ['transport']);
  if (!fields || typeof fields.transport !== 'function' ||
      (own(fields, 'permit') && typeof fields.permit !== 'function') ||
      (own(fields, 'clock') && typeof fields.clock !== 'function')) {
    throw new TypeError('invalid Wardveil scoped status adapter options');
  }
  const transport = fields.transport;
  const permit = fields.permit ?? (() => false);
  const clock = fields.clock ?? Date.now;
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
        response = await transport({ method: 'GET', path: '/v1/status', signal });
      } catch {
        throw unavailable();
      }
      if (signal?.aborted) throw unavailable();
      const r = snapshot(response, ['status', 'contentType', 'body']);
      if (!r || r.contentType !== 'application/json; charset=utf-8' ||
          typeof r.body !== 'string' || Buffer.byteLength(r.body, 'utf8') > 256) {
        throw unavailable();
      }
      const match = BODY.exec(r.body);
      if (!match || (r.status !== 200 || match[1] !== 'ok') &&
          (r.status !== 503 || match[1] !== 'degraded')) {
        throw unavailable();
      }
      const observed_at = match[2];
      const sourceTime = Date.parse(observed_at);
      let localTime;
      try { localTime = clock(); } catch { throw unavailable(); }
      if (!Number.isFinite(sourceTime) || new Date(sourceTime).toISOString() !== observed_at ||
          !Number.isFinite(localTime) || Math.abs(localTime - sourceTime) > 30_000) {
        // A stale or implausibly future response must not be treated as fresh.
        throw unavailable();
      }
      // Timestamp is source-provided, not a local substitute.
      return { state: match[1], observed_at };
    },
  });
}
