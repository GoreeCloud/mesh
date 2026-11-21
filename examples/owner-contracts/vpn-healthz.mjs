// Source-observed GoreeCloud VPN management LIVENESS, not tunnel readiness.
// Pinned to Git blob d502a8e7e859c78a038ad92874eed7e224bf83b6.
// No socket, URL, secret, credential, fetch call or actual VPN connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const VPN_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/VPN',
  source_blob: 'd502a8e7e859c78a038ad92874eed7e224bf83b6',
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
