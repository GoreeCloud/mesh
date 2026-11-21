// Source-observed GoreeCloud Gateway CONSOLE health only (not Caddy ingress health).
// Pinned to Git blob c04fc3264959b447feaddc2775e9eecde26b3b46.
// No socket, URL, secret, credential, fetch call or actual Gateway connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const GATEWAY_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/gateway',
  source_blob: 'c04fc3264959b447feaddc2775e9eecde26b3b46',
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
