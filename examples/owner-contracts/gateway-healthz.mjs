// Source-observed GoreeCloud Gateway CONSOLE health only (not Caddy ingress health).
// Pinned to Git blob 45b7104824efcbf0019f93334546070a6ca0c561.
// No socket, URL, secret, credential, fetch call or actual Gateway connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const GATEWAY_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/gateway',
  source_blob: '45b7104824efcbf0019f93334546070a6ca0c561',
  method: 'GET',
  path: '/healthz',
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
