/**
 * Fixture-only perimeter. Not a distributed rate limiter or Identity gate.
 * Reject cross-origin requests; allow small JSON-RPC messages only.
 */
export const MAX_BODY_BYTES = 32 * 1024;
const MAX_INFLIGHT = 4;
let inflight = 0;
const error = (status, message) => new Response(message, {
  status,
  headers: {
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'text/plain; charset=utf-8',
  },
});

export function preflight(request) {
  try {
    if (!(request instanceof Request)) return error(400, 'Bad request.');
    const url = new URL(request.url);
    if (url.pathname !== '/mcp' || url.search !== '' || url.hash !== '') {
      return error(404, 'Not found.');
    }
    if (request.method !== 'POST' && request.method !== 'GET') {
      return error(405, 'Method not allowed.');
    }
    // This fixture is for non-browser MCP clients, not cross-origin web pages.
    if (request.headers.has('Origin')) return error(403, 'Forbidden.');
    if (request.headers.has('Content-Encoding') &&
        request.headers.get('Content-Encoding') !== 'identity') {
      return error(415, 'Unsupported media type.');
    }
    const declared = request.headers.get('Content-Length');
    if (declared !== null &&
        (!/^(0|[1-9][0-9]*)$/.test(declared) ||
         !Number.isSafeInteger(Number(declared)) ||
         Number(declared) > MAX_BODY_BYTES)) {
      return error(413, 'Request too large.');
    }
    if (request.method === 'POST' &&
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.headers.get('Content-Type') || '')) {
      return error(415, 'Unsupported media type.');
    }
    if (request.method === 'GET' && request.body !== null) return error(400, 'Bad request.');
    return null;
  } catch {
    return error(400, 'Bad request.');
  }
}

// Per-isolate best-effort bound. Multiple isolates may exist, so production
// needs an external admission authority and per-Identity rate limits.
export function acquireSlot() {
  if (inflight >= MAX_INFLIGHT) return null;
  inflight++;
  let released = false;
  return function release() {
    if (!released) {
      released = true;
      inflight--;
    }
  };
}

export async function boundedBody(request) {
  if (request.method === 'GET') return request;
  if (!request.body) return error(400, 'Bad request.');
  let reader;
  try {
    reader = request.body.getReader();
    let chunks = [], size = 0, count = 0, expired = false;
    // Bound slow clients as well as raw bytes/chunk fragmentation.
    const deadline = setTimeout(() => {
      expired = true;
      reader.cancel().catch(() => {});
    }, 5_000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (expired) return error(408, 'Request timed out.');
        if (done) break;
        count++;
        if (!(value instanceof Uint8Array) || ++size > MAX_BODY_BYTES) {
          reader.cancel().catch(() => {});
          return error(413, 'Request too large.');
        }
        size += value.byteLength - 1;
        if (size > MAX_BODY_BYTES || count > 64) {
          reader.cancel().catch(() => {});
          return error(413, 'Request too large.');
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(deadline);
    }
    if (size === 0) return error(400, 'Bad request.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return error(400, 'Bad request.');
    }
    const headers = new Headers(request.headers);
    headers.delete('Content-Length');
    return new Request(request.url, {
      method: 'POST',
      headers,
      body: bytes,
    });
  } catch {
    try { reader?.cancel().catch(() => {}); } catch {}
    return error(400, 'Bad request.');
  }
}
