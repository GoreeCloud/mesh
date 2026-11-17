// Verified against the local-only GoreeCloud/memos server API; no live connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const MEMOS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/memos',
  source_blob: '4a607701787a7ef6791d5a5dbf600938ecb3a4ed',
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
