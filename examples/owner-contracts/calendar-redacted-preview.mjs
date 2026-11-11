// GoreeCloud Calendar *development-only* metadata preview contract.
// This file never handles or forwards raw ICS, bearer tokens or a server URL.
// Its injected transport remains owned by the source and is exercised only
// with synthetic data. This is not a production Mesh connector.
export const CALENDAR_REDACTED_PREVIEW_CONTRACT = Object.freeze({
  source: 'GoreeCloud/calendar',
  source_ref: 'cae388d173853d7aefaba41b4460564a28673662',
  source_blob: '9fc93fd255c7c45bf11d82a86480523509a846fb',
  mode: 'transport-injected-synthetic-only',
  method: 'POST',
  paths: Object.freeze({
    events: '/api/v1/import.ics?dry_run=1&redact_titles=1',
    tasks: '/api/v1/import-tasks.ics?dry_run=1&redact_titles=1',
  }),
});

const ACTOR = /^[a-z][a-z0-9.-]{1,63}$/;
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const wire = /^\{"total":(0|[1-9]\d{0,2}),"would_import":(0|[1-9]\d{0,2}),"would_skip":(0|[1-9]\d{0,2})\}$/;

function exactRecord(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const found = Reflect.ownKeys(value);
    if (found.length !== keys.length || !keys.every(key => found.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const data = Object.create(null);
    for (const key of keys) {
      if (!descriptors[key] || !own(descriptors[key], 'value')) return null;
      data[key] = descriptors[key].value;
    }
    return data;
  } catch {
    return null;
  }
}

/** A strict wire projection: unknown fields, titles, duplicate keys, malformed
 * counters, and exotic JSON objects MUST NOT be forwarded to Mesh observers.
 * This exact serialization order comes from the pinned Calendar Python code.
 */
export function parseCalendarRedactedPreview(response) {
  const fields = exactRecord(response, ['status', 'contentType', 'body']);
  if (!fields || fields.status !== 200 ||
      fields.contentType !== 'application/json; charset=utf-8' ||
      typeof fields.body !== 'string' ||
      Buffer.byteLength(fields.body, 'utf8') > 128) return null;
  const match = wire.exec(fields.body);
  if (!match) return null;
  const total = Number(match[1]), would_import = Number(match[2]), would_skip = Number(match[3]);
  if (total > 100 || would_import > total || would_skip > total ||
      would_import + would_skip !== total) return null;
  return Object.freeze({ total, would_import, would_skip });
}

function denied() { return { ok: false, error: { code: 'denied' } }; }
function unavailable() { return { ok: false, error: { code: 'unavailable' } }; }
function invalidResponse() { return { ok: false, error: { code: 'invalid_response' } }; }

/**
 * Explicit *synthetic* three-gate authorization demonstration:
 * Mesh policy, Calendar owner policy, and a separate user-consent decision
 * must EACH be exactly true. The transport alone holds the disposable Calendar
 * credentials, calendar_id and ICS fixture. The Mesh adapter NEVER receives
 * raw imported content, token or a configurable target origin.
 */
export function createCalendarRedactedPreviewFixture(options) {
  if (process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE !== '1') {
    throw new TypeError('Calendar metadata preview fixture requires explicit test opt-in');
  }
  const fields = exactRecord(options, ['transport', 'meshPermit', 'ownerPermit', 'consent']);
  if (!fields || Object.values(fields).some(fn => typeof fn !== 'function')) {
    throw new TypeError('invalid synthetic Calendar preview options');
  }
  return Object.freeze({
    async preview(request = {}) {
      // Never destructure untrusted request objects: a getter or Proxy trap
      // must not execute before all three authorization decisions are made.
      const supplied = exactRecord(request, ['actor', 'kind', 'signal']) ??
        exactRecord(request, ['actor', 'kind']);
      if (!supplied) return denied();
      const { actor, kind, signal } = supplied;
      if (typeof actor !== 'string' || !ACTOR.test(actor) ||
          !own(CALENDAR_REDACTED_PREVIEW_CONTRACT.paths, kind) ||
          (signal !== undefined && !(signal instanceof AbortSignal)) ||
          signal?.aborted) return denied();
      try {
        if (await fields.meshPermit(actor, kind, { signal }) !== true || signal?.aborted ||
            await fields.ownerPermit(actor, kind, { signal }) !== true || signal?.aborted ||
            await fields.consent(actor, kind, { signal }) !== true || signal?.aborted) {
          return denied();
        }
      } catch {
        return denied();
      }
      let result;
      try {
        result = await fields.transport({
          method: CALENDAR_REDACTED_PREVIEW_CONTRACT.method,
          path: CALENDAR_REDACTED_PREVIEW_CONTRACT.paths[kind],
          signal,
        });
      } catch {
        return unavailable();
      }
      if (signal?.aborted) return unavailable();
      const data = parseCalendarRedactedPreview(result);
      if (!data) return invalidResponse();
      return { ok: true, kind: 'synthetic_redacted_import_preview',
        evidence_status: 'prototype', data };
    },
  });
}
