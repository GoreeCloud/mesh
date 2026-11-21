// Explicit Stirling HTTPS transport for server-side integration only; NEVER browser/Android.
const ORIGIN = "https://stirling-pdf.goreecloud.com";
const PATHS = new Set(["/api/v1/misc/compress-pdf", "/api/v1/general/merge-pdfs"]);
const validToken = value => typeof value === "string" && value.length >= 8 &&
  value.length <= 2048 && /^[\x21-\x7e]+$/.test(value);
export function createStirlingHttpsTransport({
  getServiceToken,
  fetchImpl = globalThis.fetch,
  maxOutputBytes = 30 * 1024 * 1024,
} = {}) {
  if (typeof getServiceToken !== "function" || typeof fetchImpl !== "function" ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 16 ||
      maxOutputBytes > 100 * 1024 * 1024) throw new TypeError("Invalid transport configuration");
  return async ({ method, path, files, fields, signal }) => {
    if (method !== "POST" || !PATHS.has(path) || !Array.isArray(files) ||
        files.length < 1 || files.length > 8 || !(signal instanceof AbortSignal)) {
      throw new TypeError("Unsupported Stirling transport request");
    }
    const token = await getServiceToken();
    if (!validToken(token)) throw new TypeError("Service credential not available");
    const form = new FormData();
    for (const [index, item] of files.entries()) {
      if (!(item instanceof Uint8Array)) throw new TypeError("Invalid file");
      form.append("fileInput", new Blob([item], { type: "application/pdf" }), "input-" + (index + 1) + ".pdf");
    }
    for (const [key, value] of Object.entries(fields)) {
      if (!["optimizeLevel", "linearize", "normalize", "grayscale"].includes(key) ||
          typeof value !== "string") throw new TypeError("Invalid option");
      form.append(key, value);
    }
    // No arbitrary host, redirects, proxy headers or caller-selected destination.
    const response = await fetchImpl(ORIGIN + path, {
      method: "POST", body: form, headers: { "X-API-KEY": token },
      redirect: "manual", credentials: "omit", cache: "no-store", signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.status !== 200) {
      // Do not return provider error bodies: they may contain document data.
      try { await response.body?.cancel(); } catch {}
      return { status: response.status, contentType, bytes: new Uint8Array() };
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxOutputBytes)) {
      try { await response.body?.cancel(); } catch {}
      throw new Error("Provider output too large");
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new Error("Missing provider body");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > maxOutputBytes - total) {
        void reader.cancel().catch(() => {});
        throw new Error("Provider output limit exceeded");
      }
      total += value.byteLength;
      chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, contentType, bytes: result };
  };
}
