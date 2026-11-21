// Source-pinned Go DNS process-only HTTP health fixture.
// GET /healthz responds with plain text "running\n" but does not make a
// DNS query, probe an upstream or verify cryptographic DNSSEC readiness.
// Injected transport only; Mesh and owner permits must independently grant.
import { readHealthContext, healthSignalAborted } from './exact-health-fixture.mjs';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const PATH = '/healthz';
const MEDIA = 'text/plain; charset=utf-8';
const unavailable = () => new Error('source health unavailable');

export const DNS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/DNS',
  source_blob: '138f46e1ac49d8ccdb3fae05a41cf234e56236b4',
  docs_blob: '8a8a313a77a1c4da4bc4d0d4eeea17a5a4ee9a7f',
  method: 'GET',
  path: PATH,
  source_permission: 'none; Mesh and owner permits still required',
  semantics: 'process-only',
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

// Reject any added content, extra newlines or credential-bearing response.
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
