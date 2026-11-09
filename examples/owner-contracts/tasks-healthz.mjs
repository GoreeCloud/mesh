// Verified against the local-only GoreeCloud/tasks server API; no live connection.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

export const TASKS_HEALTH_CONTRACT = Object.freeze({
  source: 'GoreeCloud/tasks',
  source_blob: 'c78b5c2945cce463367026942ee9d5a203c2fe47',
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
