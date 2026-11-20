/**
 * Host-side policy for the opt-in Cloudflare Code Mode MCP prototype.
 * No generated code, token, live connector, URL, or actor claim is trusted here.
 */
import manifest from '../../examples/synthetic/manifest.v1.json' with { type: 'json' };

const IDENTIFIER = /^[a-z][a-z0-9.-]{1,63}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_CALLS = 8;
const DENIED = 'Operation unavailable.';

if (manifest.schema_version !== 'mesh.capabilities.v1' ||
    manifest.environment !== 'synthetic-local-only' ||
    !Array.isArray(manifest.capabilities) ||
    manifest.capabilities.length < 1 || manifest.capabilities.length > 32) {
  throw new Error('Synthetic manifest contract not satisfied');
}
const ids = new Set();
export const SYNTHETIC_CATALOG = Object.freeze(manifest.capabilities.map(entry => {
  if (!entry || !IDENTIFIER.test(entry.id) || !IDENTIFIER.test(entry.owner) ||
      entry.operation !== 'status.read' || entry.sensitivity !== 'synthetic' ||
      entry.evidence_status !== 'prototype' || entry.version !== '0.0.1-fixture' ||
      ids.has(entry.id)) throw new Error('Invalid or duplicate synthetic capability');
  ids.add(entry.id);
  return Object.freeze({
    id: entry.id, owner: entry.owner, version: entry.version,
    operation: 'status.read', sensitivity: 'synthetic',
    evidence_status: 'prototype',
  });
}));
const BY_PATH = new Map(SYNTHETIC_CATALOG.map(entry =>
  ['/v1/capabilities/' + entry.id, entry]));

/**
 * This is an isolated static token check for a fixture, NOT GoreeCloud Identity,
 * OAuth, user-level RBAC, revocation, or production authentication.
 */
export async function bearerAuthorized(request, secret) {
  if (!(request instanceof Request) || typeof secret !== 'string' ||
      !CREDENTIAL.test(secret)) return false;
  const header = request.headers.get('Authorization');
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const candidate = header.slice(7);
  if (!CREDENTIAL.test(candidate)) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function snapshotOptions(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
         Object.getPrototypeOf(value) !== null)) return null;
    const allowed = new Set(['method', 'path', 'query', 'body', 'rawBody', 'contentType']);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (!Object.hasOwn(fields, 'method') || !Object.hasOwn(fields, 'path')) return null;
    const out = Object.create(null);
    for (const key of keys) {
      if (!Object.hasOwn(fields[key], 'value')) return null;
      out[key] = fields[key].value;
    }
    return out;
  } catch {
    return null;
  }
}

function emptyQuery(value) {
  try {
    if (value === undefined || value === null) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
         Object.getPrototypeOf(value) !== null)) return false;
    return Reflect.ownKeys(value).length === 0;
  } catch {
    return false;
  }
}

/**
 * Called only from the trusted Worker host callback; all method/path checks
 * repeat here, independent of OpenAPI catalog discovery and the sandbox.
 * No network access, writes, or provider data are exposed by this implementation.
 */
export function createReadOnlyRequest() {
  let calls = 0;
  return async function request(options) {
    if (++calls > MAX_CALLS) throw new Error(DENIED);
    const input = snapshotOptions(options);
    if (!input || input.method !== 'GET' || typeof input.path !== 'string' ||
        input.path.length > 100 || !emptyQuery(input.query) ||
        input.body !== undefined || input.rawBody !== undefined ||
        input.contentType !== undefined) {
      throw new Error(DENIED);
    }
    if (input.path === '/v1/capabilities') {
      return {
        schema_version: 'mesh.capabilities.v1',
        environment: 'synthetic-local-only',
        evidence_status: 'prototype',
        capabilities: SYNTHETIC_CATALOG.map(x => ({ ...x })),
      };
    }
    const entry = BY_PATH.get(input.path);
    if (!entry) throw new Error(DENIED);
    // No fictitious health success or timestamp: no owner service was contacted.
    return {
      capability_id: entry.id,
      environment: 'synthetic-local-only',
      evidence_status: 'prototype',
      state: 'not_measured',
    };
  };
}
