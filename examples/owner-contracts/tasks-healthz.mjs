// Verified against the local-only GoreeCloud/tasks server API; no live connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const TASKS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/tasks',
  source_blob: '12dc998bdc303e6efab7e896f384041563115977',
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
