// Source-owned GoreeCloud Calendar probe semantics were reviewed in draft PR #1.
// Transport-injected development fixtures only; no service endpoints or credentials.
// /healthz checks the HTTP handler; /readyz additionally checks persistent SQLite tables.
// A result does not establish external reachability, CalDAV sync or production readiness.
import { createExactHealthFixtureAdapter } from './exact-health-fixture.mjs';

const SOURCE = Object.freeze({
  source: 'GoreeCloud/calendar',
  source_blob: 'ac6be2c5d9c1a61b42a90ed77af7f86cf165cd65',
  source_ref: 'bea6665b31b81fc9bf4310c3fc071b3c2ed519e6',
  method: 'GET',
  mode: 'transport-injected-nonproduction',
});

export const CALENDAR_LIVENESS_CONTRACT = Object.freeze({
  ...SOURCE,
  path: '/healthz',
});

export const CALENDAR_READINESS_CONTRACT = Object.freeze({
  ...SOURCE,
  path: '/readyz',
});

export function createCalendarHealthFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: CALENDAR_LIVENESS_CONTRACT.path,
    body: '{"status":"ok"}',
  });
}

export function createCalendarReadinessFixtureAdapter(options) {
  return createExactHealthFixtureAdapter(options, {
    path: CALENDAR_READINESS_CONTRACT.path,
    body: '{"status":"ready"}',
  });
}