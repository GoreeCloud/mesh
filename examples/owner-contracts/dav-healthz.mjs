// Source-reviewed DAV health probe exists only on the unmerged DAV PR #1 branch.
// This is a transport-injected, local synthetic contract, not a live connector.
// The public GET /healthz proves handler liveness only, not authentication,
// CardDAV/CalDAV readiness, backup integrity, or a deployed DAV endpoint.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const DAV_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/DAV',
  source_blob: '6a270d95c406def94482a9a4c6e9006c016a1e51',
  source_ref: 'feat/goreecloud-dav-foundation-20261105',
  method: 'GET',
  path: '/healthz',
  mode: 'transport-injected-nonproduction',
});

export function createDavHealthFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: DAV_HEALTH_CONTRACT.path,
    body: '{"service":"goreecloud-dav","status":"up"}',
    contentType: 'application/json',
  });
}
