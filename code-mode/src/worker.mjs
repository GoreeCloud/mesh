import { DynamicWorkerExecutor } from '@cloudflare/codemode';
import { openApiMcpServer } from '@cloudflare/codemode/mcp';
import { createLegacyMcpHandler } from 'agents/mcp';
import { bearerAuthorized, createReadOnlyRequest } from './policy.mjs';
import { preflight, boundedBody, acquireSlot } from './admission.mjs';
import { OPENAPI } from './spec.mjs';

const headers = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function reply(message, status) {
  return new Response(message, { status, headers: {
    ...headers, 'Content-Type': 'text/plain; charset=utf-8',
  } });
}

export default {
  async fetch(request, env, ctx) {
    const rejected = preflight(request);
    if (rejected) return rejected;
    // Explicitly fail closed when a secret or isolated loader is absent.
    if (!env?.MESH_CODEMODE_BEARER || !env?.LOADER) {
      return reply('Service unavailable.', 503);
    }
    if (!(await bearerAuthorized(request, env.MESH_CODEMODE_BEARER))) {
      return reply('Unauthorized.', 401);
    }
    const release = acquireSlot();
    if (!release) return reply('Service unavailable.', 503);
    try {
      const bounded = await boundedBody(request);
      if (bounded instanceof Response) return bounded;
      const server = openApiMcpServer({
        spec: OPENAPI,
        name: 'goreecloud-mesh-codemode-fixture',
        version: '0.1.0',
        executor: new DynamicWorkerExecutor({
          loader: env.LOADER, globalOutbound: null, timeout: 15_000,
        }),
        request: createReadOnlyRequest(),
        description: 'Synthetic read-only GoreeCloud Mesh fixture. No live service data or writes.',
      });
      const response = await createLegacyMcpHandler(server, { route: '/mcp' })(bounded, env, ctx);
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
      return new Response(response.body, {
        status: response.status, statusText: response.statusText, headers: responseHeaders,
      });
    } catch {
      // Do not expose source errors, sandbox internals, tokens, or owner details.
      return reply('Service unavailable.', 503);
    } finally {
      release();
    }
  },
};
