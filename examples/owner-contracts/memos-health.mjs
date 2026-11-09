// Verified against the local-only GoreeCloud/memos server API; no live connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const MEMOS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/memos',
  source_blob: '86a711f87d2902ddcdeecda294e9fdb644894c36',
  method: 'GET',
  path: '/api/v1/health',
  mode: 'transport-injected-nonproduction',
});

export function createMemosHealthFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: MEMOS_HEALTH_CONTRACT.path,
    body: '{"status": "ok", "service": "goreecloud-memos"}',
  });
}
