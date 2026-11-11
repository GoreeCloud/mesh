// Strict, source-pinned, response-only Calendar task importability fixture.
// No network transport, credentials, raw ICS, account IDs, or consent grants.
export const CALENDAR_VTODO_PREFLIGHT_CONTRACT = Object.freeze({
  source: 'GoreeCloud/calendar',
  source_ref: '49ba88b9fc81bc73ea42033bcd11a37df2bab629',
  handler_blob: 'f421b8eeae7eb731aba48a4091a81b952903a384',
  parser_blob: 'bc56faf45dea5184b25e71eab72406e4b5677b0f',
  method: 'POST',
  path: '/api/v1/import-tasks.ics?dry_run=1&redact_titles=1&preflight=1',
  mode: 'source-pinned-response-parser-only',
});
const ALLOWED = Object.freeze([
  'classification_not_supported', 'date_only_due_not_supported',
  'invalid_or_unsupported_ics', 'sequence_not_supported',
]);
const accepted = /^\{"total":(0|[1-9]\d{0,2}),"would_import":(0|[1-9]\d{0,2}),"would_skip":(0|[1-9]\d{0,2}),"importable":true,"reason_codes":\[\]\}$/;
const refused = /^\{"importable":false,"reason_codes":(\["[a-z_]+"(?:,"[a-z_]+")*\])\}$/;
function exactResponse(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 3 || !['status', 'contentType', 'body'].every(k => keys.includes(k))) return null;
    const d = Object.getOwnPropertyDescriptors(value);
    if (!['status', 'contentType', 'body'].every(k =>
        d[k] && Object.hasOwn(d[k], 'value'))) return null;
    return { status: d.status.value, contentType: d.contentType.value, body: d.body.value };
  } catch { return null; }
}
export function parseCalendarTaskImportability(value) {
  const response = exactResponse(value);
  if (!response || response.status !== 200 ||
      response.contentType !== 'application/json; charset=utf-8' ||
      typeof response.body !== 'string' ||
      Buffer.byteLength(response.body, 'utf8') > 320) return null;
  const yes = accepted.exec(response.body);
  if (yes) {
    const total = Number(yes[1]), would_import = Number(yes[2]), would_skip = Number(yes[3]);
    if (total > 100 || would_import > total || would_skip > total ||
        would_import + would_skip !== total) return null;
    return Object.freeze({ importable: true, reason_codes: Object.freeze([]),
      total, would_import, would_skip });
  }
  const no = refused.exec(response.body);
  if (!no) return null;
  let codes;
  try { codes = JSON.parse(no[1]); } catch { return null; }
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > ALLOWED.length ||
      !codes.every((code, i) => ALLOWED.includes(code) &&
        (i === 0 || codes[i - 1] < code))) return null;
  return Object.freeze({ importable: false, reason_codes: Object.freeze([...codes]) });
}
