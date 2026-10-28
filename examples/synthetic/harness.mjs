// Dependency-free, local-only Mesh contract experiment. No network or product integration.
export const CONTRACT_VERSION = 'mesh.capabilities.v1';

const ID = /^[a-z][a-z0-9.-]{1,63}$/;
const STATES = new Set(['ok', 'degraded']);
const ERRORS = new Set(['unsupported', 'denied', 'unavailable', 'timed_out', 'invalid_response']);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));
}

export function validateManifest(manifest) {
  if (!exactKeys(manifest, ['schema_version', 'environment', 'capabilities']) ||
      manifest.schema_version !== CONTRACT_VERSION ||
      manifest.environment !== 'synthetic-local-only' ||
      !Array.isArray(manifest.capabilities) || manifest.capabilities.length < 1 ||
      manifest.capabilities.length > 32) {
    throw new TypeError('invalid synthetic capability manifest');
  }
  const ids = new Set();
  return manifest.capabilities.map(capability => {
    if (!exactKeys(capability, ['id', 'owner', 'version', 'operation', 'sensitivity', 'evidence_status']) ||
        typeof capability.id !== 'string' || !ID.test(capability.id) ||
        typeof capability.owner !== 'string' || !ID.test(capability.owner) ||
        capability.version !== '0.0.1-fixture' || capability.operation !== 'status.read' ||
        capability.sensitivity !== 'synthetic' || capability.evidence_status !== 'prototype' ||
        ids.has(capability.id)) {
      throw new TypeError('invalid or duplicate synthetic capability');
    }
    ids.add(capability.id);
    return Object.freeze({ ...capability });
  });
}

function failure(code) {
  if (!ERRORS.has(code)) throw new TypeError('unknown failure code');
  return { ok: false, error: { code } };
}

function snapshotStatus(value, maxResponseBytes) {
  try {
    if (!plain(value)) return null;
    // Never execute a source-controlled getter, or validate one value and
    // publish a different one after an accessor changes its answer.
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes('state') || !keys.includes('observed_at')) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (!own(fields.state, 'value') || !own(fields.observed_at, 'value') ||
        !STATES.has(fields.state.value) || typeof fields.observed_at.value !== 'string') return null;
    const parsed = Date.parse(fields.observed_at.value);
    if (!Number.isFinite(parsed) ||
        new Date(parsed).toISOString() !== fields.observed_at.value) return null;
    const snapshot = { state: fields.state.value, observed_at: fields.observed_at.value };
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= maxResponseBytes ? snapshot : null;
  } catch {
    return null;
  }
}

/**
 * All adapters are in-process fixtures. Discovery does not authorize execution.
 * Both meshPermit and the owner adapter must explicitly approve each read.
 */
export function createSyntheticHarness({
  manifest, adapters = Object.create(null), meshPermit = () => false,
  timeoutMs = 100, maxResponseBytes = 1024,
} = {}) {
  const inventory = validateManifest(manifest);
  if (!plain(adapters) || typeof meshPermit !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 32 || maxResponseBytes > 4096) {
    throw new TypeError('invalid synthetic harness options');
  }
  const byID = new Map(inventory.map(capability => [capability.id, capability]));
  return Object.freeze({
    discover() {
      // Return inert copies; capability presence conveys no permission or health.
      return inventory.map(capability => ({ ...capability }));
    },
    async read(request = {}) {
      // The request boundary is untrusted too. Never let nulls, accessors,
      // proxies or undeclared payload fields escape as uncaught exceptions.
      let actor, capabilityId, operation;
      try {
        if (!plain(request)) return failure('unsupported');
        // Requests may be supplied by untrusted callers. Inspect descriptors
        // without invoking getters and reject symbols or hidden payload fields.
        const keys = Reflect.ownKeys(request);
        if (keys.some(key => !['actor', 'capabilityId', 'operation'].includes(key))) {
          return failure('unsupported');
        }
        const fields = Object.getOwnPropertyDescriptors(request);
        if (!own(fields, 'actor') || !own(fields, 'capabilityId') ||
            keys.some(key => !own(fields[key], 'value'))) return failure('unsupported');
        actor = fields.actor.value;
        capabilityId = fields.capabilityId.value;
        operation = own(fields, 'operation') ? fields.operation.value : 'status.read';
      } catch {
        return failure('unsupported');
      }
      const capability = byID.get(capabilityId);
      if (!capability || operation !== 'status.read' || capability.operation !== operation) {
        return failure('unsupported');
      }
      if (typeof actor !== 'string' || !ID.test(actor)) return failure('denied');
      const controller = new AbortController();
      let timer;
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: 'timeout' });
        }, timeoutMs);
      });
      const action = (async () => {
        // Fail closed for absent, false, throwing or rejected authorization.
        try {
          if (await meshPermit(actor, capability) !== true) return { kind: 'denied' };
        } catch {
          return { kind: 'denied' };
        }
        const adapter = own(adapters, capability.id) ? adapters[capability.id] : null;
        if (!plain(adapter) || typeof adapter.authorize !== 'function' ||
            typeof adapter.readStatus !== 'function') return { kind: 'unavailable' };
        try {
          if (await adapter.authorize(actor, capability, { signal: controller.signal }) !== true) {
            return { kind: 'denied' };
          }
        } catch {
          return { kind: 'denied' };
        }
        try {
          return { kind: 'result', value: await adapter.readStatus({ signal: controller.signal }) };
        } catch {
          return { kind: 'unavailable' };
        }
      })();
      try {
        const outcome = await Promise.race([action, timeout]);
        if (outcome.kind === 'timeout') return failure('timed_out');
        if (outcome.kind === 'denied') return failure('denied');
        if (outcome.kind !== 'result') return failure('unavailable');
        const snapshot = snapshotStatus(outcome.value, maxResponseBytes);
        if (!snapshot) return failure('invalid_response');
        return {
          ok: true,
          kind: 'synthetic_result',
          capabilityId: capability.id,
          evidence_status: capability.evidence_status,
          data: snapshot,
        };
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  });
}
