// Verified against the local-only GoreeCloud/tasks server API; no live connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const TASKS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/tasks',
  source_blob: 'd3b0b1a554608f53afcd50ae5641295d17b564e0',
  method: 'GET',
  path: '/healthz',
  mode: 'transport-injected-nonproduction',
});

export function createTasksHealthFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: TASKS_HEALTH_CONTRACT.path,
    body: '{"status":"ok","mode":"loopback-development"}',
  });
}
