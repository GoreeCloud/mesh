// Reviewed source-owned OpenRoom health route; synthetic-only, no live connection.
// Never call owner setup, account, messages, files, tasks or any private endpoint.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const OPENROOM_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/openroom',
  source_blob: 'b0d033962c6bcde0489ba93367603a4698dd0c59',
  method: 'GET',
  path: '/api/health',
  mode: 'transport-injected-nonproduction',
});

export function createOpenRoomHealthFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: OPENROOM_HEALTH_CONTRACT.path,
    body: '{"status":"ok"}',
  });
}
