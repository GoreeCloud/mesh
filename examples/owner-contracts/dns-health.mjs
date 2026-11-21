// Pinned first-party Go DNS process liveness only, NOT recursive DNS reachability.
// Not evidence of DoH, DoT, DoQ, public DNS, DNSSEC or external availability.
// Pinned to Go internal/server/server.go Git blob c2c0e2e088f91e46076deaf1ae3a71d2c959e926
// and README.md Git blob a3ca2d1b111cb3119e3cb3755ca908abc6fe775b.
// A trusted caller injects a transport; this module has no URLs, sockets,
// credentials, fetch, raw server name output or live DNS connections.
import { readHealthContext, healthSignalAborted } from './exact-health-fixture.mjs';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const PATH = '/healthz';
const MEDIA = 'text/plain; charset=utf-8';
const unavailable = () => new Error('source health unavailable');

export const DNS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/DNS',
  source_blob: 'c2c0e2e088f91e46076deaf1ae3a71d2c959e926',
  docs_blob: 'a3ca2d1b111cb3119e3cb3755ca908abc6fe775b',
  method: 'GET',
  path: PATH,
  source_permission: 'Public process liveness (not resolver readiness)',
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

// The source emits exactly "running\n" with text/plain; never infer DNS
// resolution, recursive upstream health, DoH/DoT, DNSSEC or allowed clients.
function validBody(body) {
  return typeof body === 'string' && body === 'running\n';
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
    async authorize(actor, capability, context) {
      const fields = readHealthContext(context);
      if (!fields || healthSignalAborted(fields.signal)) return false;
      const { signal } = fields;
      try {
        return (await permit(actor, capability, { signal })) === true &&
          !healthSignalAborted(signal);
      } catch { return false; }
    },
    async readStatus(context) {
      const fields = readHealthContext(context);
      if (!fields || healthSignalAborted(fields.signal)) throw unavailable();
      const { signal } = fields;
      let response;
      try {
        response = await transport({ method: 'GET', path: PATH, signal });
      } catch { throw unavailable(); }
      if (healthSignalAborted(signal)) throw unavailable();
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
