// Verified against the local-only GoreeCloud/memos server API; no live connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const MEMOS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/memos',
  source_blob: '88b3e96631fac4cd78c5ab9e90981c0f696735e5',
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
