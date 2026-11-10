// Source-observed GoreeCloud DNS CLIENT health: a local A query succeeds.
// Not evidence of DoH, DoT, DoQ, public DNS, DNSSEC or external availability.
// Pinned to DNS WebServiceApi.cs Git blob 333b11d0c32b9cd57bcb561fb2d94fa4e8e4ea40
// and APIDOCS.md Git blob fb1e769a04fc00e384189cee9f417532a4c75a22.
// A trusted caller injects a transport; this module has no URLs, sockets,
// credentials, fetch, raw server name output or live DNS connections.
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const PATH = '/api/dnsClient/healthCheck';
const MEDIA = 'application/json; charset=utf-8';
const unavailable = () => new Error('source health unavailable');

export const DNS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/DNS',
  source_blob: '333b11d0c32b9cd57bcb561fb2d94fa4e8e4ea40',
  docs_blob: 'fb1e769a04fc00e384189cee9f417532a4c75a22',
  method: 'GET',
  path: PATH,
  source_permission: 'DnsClient: View',
  mode: 'transport-injected-nonproduction',
});

function snapshot(value, allowed, required = allowed) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(k => !allowed.includes(k)) ||
        required.some(k => !keys.includes(k))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of keys) {
      if (!descriptors[key] || !own(descriptors[key], 'value')) return null;
      result[key] = descriptors[key].value;
    }
    return result;
  } catch { return null; }
}

// Narrowly accept only a two-field ASCII source response. Unlike JSON.parse,
// this rejects duplicate keys and Unicode key aliases rather than overwriting
// one spelling of a field. The server name is checked but NEVER projected.
const NAME = String.raw`[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?`;
const FIRST = new RegExp(String.raw`^\s*\{\s*"server"\s*:\s*"(${NAME})"\s*,\s*"status"\s*:\s*"ok"\s*\}\s*$`);
const SECOND = new RegExp(String.raw`^\s*\{\s*"status"\s*:\s*"ok"\s*,\s*"server"\s*:\s*"(${NAME})"\s*\}\s*$`);
function validBody(body) {
  if (typeof body !== 'string' || body.length > 512 ||
      Buffer.byteLength(body, 'utf8') > 512) return false;
  const parsed = FIRST.exec(body) ?? SECOND.exec(body);
  if (!parsed) return false;
  const labels = parsed[1].split('.');
  return labels.every(label =>
    label.length > 0 && label.length <= 63 &&
    !label.startsWith('-') && !label.endsWith('-'));
}

export function createDNSHealthFixtureAdapter(options) {
  const fields = snapshot(options, ['transport', 'permit', 'clock'], ['transport']);
  if (!fields || typeof fields.transport !== 'function' ||
      (own(fields, 'permit') && typeof fields.permit !== 'function') ||
      (own(fields, 'clock') && typeof fields.clock !== 'function')) {
    throw new TypeError('invalid synthetic DNS health fixture');
  }
  const { transport } = fields;
  const permit = fields.permit ?? (() => false);
  const clock = fields.clock ?? (() => new Date().toISOString());
  return Object.freeze({
    async authorize(actor, capability, { signal } = {}) {
      try {
        return !signal?.aborted &&
          (await permit(actor, capability, { signal })) === true && !signal?.aborted;
      } catch { return false; }
    },
    async readStatus({ signal } = {}) {
      if (signal?.aborted) throw unavailable();
      let response;
      try {
        response = await transport({ method: 'GET', path: PATH, signal });
      } catch { throw unavailable(); }
      if (signal?.aborted) throw unavailable();
      const projected = snapshot(response, ['status', 'contentType', 'body']);
      if (!projected || projected.status !== 200 ||
          projected.contentType !== MEDIA || !validBody(projected.body)) {
        throw unavailable();
      }
      let observed_at;
      try {
        observed_at = clock();
        if (typeof observed_at !== 'string' ||
            !Number.isFinite(Date.parse(observed_at)) ||
            new Date(observed_at).toISOString() !== observed_at) throw unavailable();
      } catch { throw unavailable(); }
      return { state: 'ok', observed_at };
    },
  });
}
