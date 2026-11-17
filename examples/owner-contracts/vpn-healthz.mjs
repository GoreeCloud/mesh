// Source-observed GoreeCloud VPN management LIVENESS, not tunnel readiness.
// Pinned to Git blob d43c64e12c750205adc567e1cb4ba8ab4923685c.
// No socket, URL, secret, credential, fetch call or actual VPN connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const VPN_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/VPN',
  source_blob: 'd43c64e12c750205adc567e1cb4ba8ab4923685c',
  method: 'GET',
  path: '/healthz',
  mode: 'transport-injected-nonproduction',
});

export function createVPNHealthFixtureAdapter(options) {
  // Python's compact JSON encoder returns a fixed management-alpha liveness
  // body. This NEVER asserts WireGuard, DNS, firewall or peer enforcement.
  return createExactHealthFixtureAdapter(options, {
    path: VPN_HEALTH_CONTRACT.path,
    body: '{"status":"ok","maturity":"alpha","component":"management"}',
  });
}
