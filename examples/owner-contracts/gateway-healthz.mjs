// Current source-owned GoreeCloud Gateway local control-plane health only (not Caddy ingress health).
// Pinned to Git blob 5ff8ff63f321499d87d49df0664d0715e79b206d.
// No socket, URL, secret, credential, fetch call or actual Gateway connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const GATEWAY_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/gateway',
  source_blob: '5ff8ff63f321499d87d49df0664d0715e79b206d',
  method: 'GET',
  path: '/api/health',
  mode: 'transport-injected-nonproduction',
});

export function createGatewayHealthFixtureAdapter(options) {
  // Go json.Encoder.Encode appends a newline. HTTP 200 only confirms that
  // the console handler is responding, NOT that Caddy routes/TLS/ACME work.
  return createExactHealthFixtureAdapter(options, {
    path: GATEWAY_HEALTH_CONTRACT.path,
    body: '{"ok":true}\n',
  });
}
