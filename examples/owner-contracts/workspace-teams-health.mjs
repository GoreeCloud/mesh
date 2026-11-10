// Reviewed source-owned Workspace Teams health route; synthetic-only, no live connection.
// Never call owner setup, account, messages, files, tasks or any private endpoint.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const WORKSPACE_TEAMS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/workspace-teams',
  source_blob: 'e6d80f401454ee9bd78b4ab9ae9066cc66d3ae27',
  method: 'GET',
  path: '/api/health',
  mode: 'transport-injected-nonproduction',
});

export function createWorkspaceTeamsHealthFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: WORKSPACE_TEAMS_HEALTH_CONTRACT.path,
    body: '{"status":"ok"}',
  });
}
