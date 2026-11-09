// Opt-in, dependency-free, in-memory evidence for synthetic Mesh reads only.
// No telemetry exporter, network access, actor identity or payload retention.
import { randomUUID } from 'node:crypto';

export const EVIDENCE_VERSION = 'mesh.synthetic-evidence.v1';
const FAILURE_CODES = new Set(['unsupported', 'denied', 'unavailable', 'timed_out', 'invalid_response']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// Reject unknown fields, accessors, symbols and throwing proxies before reading values.
function optionsSnapshot(value) {
  try {
    if (!plain(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => !['capacity', 'maxInFlight'].includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const settings = { capacity: 32, maxInFlight: 8 };
    for (const key of keys) {
      if (!own(descriptors[key], 'value')) return null;
      if (descriptors[key].value !== undefined) settings[key] = descriptors[key].value;
    }
    if (!Number.isInteger(settings.capacity) || settings.capacity < 1 || settings.capacity > 128 ||
        !Number.isInteger(settings.maxInFlight) || settings.maxInFlight < 1 || settings.maxInFlight > 32) return null;
    return settings;
  } catch {
    return null;
  }
}

// Only allow a fixed synthetic outcome vocabulary into the evidence ring.
function outcomeOf(response) {
  try {
    if (!plain(response)) return 'invalid_response';
    const fields = Object.getOwnPropertyDescriptors(response);
    if (fields.ok?.value === true && fields.kind?.value === 'synthetic_result') return 'ok';
    if (fields.ok?.value !== false || !own(fields.error ?? {}, 'value')) return 'invalid_response';
    const error = fields.error.value;
    if (!plain(error)) return 'invalid_response';
    const code = Object.getOwnPropertyDescriptor(error, 'code');
    return code && own(code, 'value') && FAILURE_CODES.has(code.value) ? code.value : 'invalid_response';
  } catch {
    return 'invalid_response';
  }
}

/**
 * A local, opt-in wrapper around the synthetic read contract.
 * It does not grant permissions, execute retries, persist state or export logs.
 * A saturated observer declines the read with the existing `unavailable` code.
 */
export function createSyntheticReadObserver(harness, options = {}) {
  const settings = optionsSnapshot(options);
  let ownerRead;
  try {
    if (!plain(harness)) throw new TypeError('invalid synthetic harness');
    const descriptor = Object.getOwnPropertyDescriptor(harness, 'read');
    if (!descriptor || !own(descriptor, 'value') || typeof descriptor.value !== 'function') {
      throw new TypeError('invalid synthetic harness');
    }
    ownerRead = descriptor.value;
  } catch {
    throw new TypeError('invalid synthetic harness');
  }
  if (!settings) throw new TypeError('invalid synthetic observer options');

  const entries = [];
  let inFlight = 0;
  function record(correlationId, outcome) {
    entries.push(Object.freeze({
      schema_version: EVIDENCE_VERSION,
      correlation_id: correlationId,
      outcome,
      observed_at: new Date().toISOString(),
    }));
    if (entries.length > settings.capacity) entries.shift();
  }

  return Object.freeze({
    async read(request = {}) {
      const correlationId = randomUUID();
      if (inFlight >= settings.maxInFlight) {
        const response = { ok: false, error: { code: 'unavailable' } };
        record(correlationId, 'unavailable');
        return { correlation_id: correlationId, response };
      }
      inFlight++;
      try {
        const response = await Reflect.apply(ownerRead, harness, [request]);
        record(correlationId, outcomeOf(response));
        return { correlation_id: correlationId, response };
      } catch (error) {
        record(correlationId, 'unavailable');
        throw error;
      } finally {
        inFlight--;
      }
    },
    records() {
      return entries.map(entry => ({ ...entry }));
    },
    clear() {
      entries.length = 0;
    },
    inFlight() {
      return inFlight;
    },
  });
}
