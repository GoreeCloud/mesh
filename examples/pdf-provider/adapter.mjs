// Nonproduction, provider-neutral PDF contract fixture. No network or credential access.
const ROUTES = Object.freeze({
  compress: "/api/v1/misc/compress-pdf",
  merge: "/api/v1/general/merge-pdfs",
});
const deny = code => ({ ok: false, error: { code } });
const finiteLimit = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
const bytes = value => value instanceof Uint8Array ? new Uint8Array(value) : null;
function isPdf(value) {
  if (value.length < 10) return false;
  const start = new TextDecoder().decode(value.subarray(0, 5));
  const tail = new TextDecoder().decode(value.subarray(Math.max(0, value.length - 1024)));
  return start === "%PDF-" && tail.includes("%%EOF");
}
function ownRecord(value, keys) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, item] of Object.entries(descriptors)) {
    if (!keys.includes(key) || !Object.hasOwn(item, "value")) return null;
  }
  return descriptors;
}
function validateRequest(input, maxInputBytes) {
  const shape = ownRecord(input, ["operation", "files", "optimizeLevel"]);
  if (!shape || !shape.operation || !shape.files || !Object.hasOwn(ROUTES, shape.operation.value)) return null;
  const operation = shape.operation.value;
  const sources = shape.files.value;
  if (!Array.isArray(sources)) return null;
  const min = operation === "merge" ? 2 : 1;
  const max = operation === "merge" ? 8 : 1;
  if (sources.length < min || sources.length > max) return null;
  if (operation === "merge" && shape.optimizeLevel) return null;
  const optimize = shape.optimizeLevel ? shape.optimizeLevel.value : 5;
  if (operation === "compress" && !finiteLimit(optimize, 1, 9)) return null;
  const copies = [];
  let total = 0;
  for (let i = 0; i < sources.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(sources, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    const copy = bytes(descriptor.value);
    if (!copy || !isPdf(copy) || copy.length > maxInputBytes - total) return null;
    total += copy.length;
    copies.push(copy);
  }
  const fields = operation === "compress"
    ? Object.freeze({ optimizeLevel: String(optimize), linearize: "false", normalize: "false", grayscale: "false" })
    : Object.freeze({});
  return { operation, files: copies, total, fields };
}
function validateResponse(reply, maxOutputBytes) {
  const shape = ownRecord(reply, ["status", "contentType", "bytes"]);
  if (!shape || !shape.status || !shape.contentType || !shape.bytes) return null;
  if (shape.status.value !== 200) return null;
  if (typeof shape.contentType.value !== "string" || !/^application\/pdf(?:\s*;.*)?$/i.test(shape.contentType.value)) return null;
  const output = bytes(shape.bytes.value);
  if (!output || output.length > maxOutputBytes || !isPdf(output)) return null;
  return output;
}
export function createPdfProviderContract({
  permit = () => false,
  transport,
  maxInputBytes = 10 * 1024 * 1024,
  maxOutputBytes = 30 * 1024 * 1024,
  maxInFlight = 2,
  timeoutMs = 30000,
} = {}) {
  if (typeof permit !== "function" || typeof transport !== "function" ||
      !finiteLimit(maxInputBytes, 16, 50 * 1024 * 1024) ||
      !finiteLimit(maxOutputBytes, 16, 100 * 1024 * 1024) ||
      !finiteLimit(maxInFlight, 1, 8) || !finiteLimit(timeoutMs, 10, 120000)) {
    throw new TypeError("Invalid temporary PDF provider configuration");
  }
  let active = 0;
  return Object.freeze({
    async process(request) {
      if (active >= maxInFlight) return deny("unavailable");
      let parsed;
      try { parsed = validateRequest(request, maxInputBytes); }
      catch { return deny("invalid_request"); }
      if (!parsed) return deny("invalid_request");
      active++;
      const controller = new AbortController();
      let timer;
      const work = (async () => {
        try {
          // Trusted external policy must verify Identity, privacy and file access.
          const allowed = await permit(Object.freeze({
            operation: parsed.operation, fileCount: parsed.files.length, inputBytes: parsed.total,
          }), { signal: controller.signal });
          if (allowed !== true || controller.signal.aborted) return deny("denied");
        } catch { return deny("denied"); }
        try {
          const response = await transport(Object.freeze({
            method: "POST", path: ROUTES[parsed.operation],
            operation: parsed.operation, files: parsed.files,
            fields: parsed.fields, signal: controller.signal,
          }));
          if (controller.signal.aborted) return deny("timed_out");
          const output = validateResponse(response, maxOutputBytes);
          return output ? { ok: true, bytes: output } : deny("invalid_response");
        } catch { return deny("unavailable"); }
      })();
      // The slot remains occupied until *actual* owner work settles, even after timeout.
      void work.finally(() => { active--; });
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(deny("timed_out")); }, timeoutMs);
      });
      try { return await Promise.race([work, timeout]); }
      finally { clearTimeout(timer); }
    },
    inFlight() { return active; },
    routes: ROUTES,
  });
}
