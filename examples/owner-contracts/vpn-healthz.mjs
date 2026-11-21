// Source-observed GoreeCloud VPN management LIVENESS, not tunnel readiness.
// Pinned to Git blob d5c146a3bcb59d6f12a224643e2a30f3cc38c972.
// No socket, URL, secret, credential, fetch call or actual VPN connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const VPN_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/VPN',
  source_blob: 'd5c146a3bcb59d6f12a224643e2a30f3cc38c972',
  method: 'GET',
  path: '/healthz',
  mode: 'transport-injected-nonproduction',
});

export function createVPNHealthFixtureAdapter(options) {
  // Go's json.Encoder emits a newline-terminated process-only liveness
  // body. This NEVER asserts WireGuard, DNS, firewall or peer enforcement.
  return createExactHealthFixtureAdapter(options, {
    path: VPN_HEALTH_CONTRACT.path,
    body: '{"status":"ok"}\n',
  });
}
