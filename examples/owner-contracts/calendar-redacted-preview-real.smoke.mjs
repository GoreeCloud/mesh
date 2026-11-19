// Source-owned Calendar Python -> synthetic Mesh metadata-preview bridge.
// All HTTP is loopback-only with two disposable accounts and synthetic ICS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import {
  CALENDAR_REDACTED_PREVIEW_CONTRACT as CONTRACT,
  createCalendarRedactedPreviewFixture,
} from './calendar-redacted-preview.mjs';

if (process.env.GC_MESH_CALENDAR_PREVIEW_FIXTURE !== '1') {
  throw Error('Explicit isolated preview fixture opt-in required');
}
if (process.argv.length !== 3) throw Error('Provide pinned Calendar source directory');

const source = path.resolve(process.argv[2]);
const child = spawn('python3', [
  new URL('./calendar-redacted-preview-loopback.py', import.meta.url).pathname,
  source,
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
});
const chunks = [];
child.stdout.on('data', data => {
  if (Buffer.concat(chunks).length < 512) chunks.push(data);
});
const ready = new Promise((resolve, reject) => {
  child.stdout.on('data', () => {
    const line = Buffer.concat(chunks).toString('utf8').split('\n')[0];
    if (line.endsWith('}')) {
      try { resolve(JSON.parse(line)); }
      catch { reject(Error('Invalid source fixture startup response')); }
    }
  });
  child.once('error', () => reject(Error('Pinned Calendar source process did not start')));
  child.once('exit', () => reject(Error('Pinned Calendar source process terminated early')));
});
const guard = setTimeout(() => child.kill('SIGTERM'), 15000);
try {
  const started = await ready;
  assert.ok(Number.isInteger(started.port) && started.port > 0 && started.port <= 65535);
  const base = 'http://127.0.0.1:' + started.port;

  async function sourceCall(pathname, method = 'GET', body = undefined, token = undefined) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token !== undefined) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(base + pathname, {
      method, headers, redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(1200),
    });
    return { status: response.status, contentType: response.headers.get('content-type'),
      body: await response.text() };
  }
  async function login(email, password) {
    const response = await sourceCall('/api/v1/login', 'POST', { email, password });
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.ok(typeof payload.token === 'string' && payload.token.length > 12);
    return payload.token;
  }
  const ownerToken = await login('fixture-owner@example.test', 'synthetic-owner-password-12345678');
  const otherToken = await login('fixture-other@example.test', 'synthetic-other-password-12345678');
  const calendars = await sourceCall('/api/v1/calendars', 'GET', undefined, ownerToken);
  assert.equal(calendars.status, 200);
  const calendarId = JSON.parse(calendars.body).calendars[0].id;
  assert.ok(typeof calendarId === 'string' && calendarId.length > 0);

  const markers = ['SECRET_SYNTHETIC_EVENT', 'SECRET_SYNTHETIC_TASK'];
  const eventICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    'UID:mesh-preview-event@example.test', 'DTSTART:20261111T130000Z',
    'DTEND:20261111T140000Z', 'SUMMARY:' + markers[0],
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const taskICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO',
    'UID:mesh-preview-task@example.test', 'SUMMARY:' + markers[1],
    'STATUS:NEEDS-ACTION', 'PRIORITY:5',
    'END:VTODO', 'END:VCALENDAR', '',
  ].join('\r\n');

  let actualTransportCalls = 0;
  function make(transport, meshPermit = () => true, ownerPermit = () => true,
      consent = () => true) {
    return createCalendarRedactedPreviewFixture({ transport, meshPermit, ownerPermit, consent });
  }
  const transport = async ({ method, path: pathname }) => {
    assert.equal(method, 'POST');
    assert.ok(Object.values(CONTRACT.paths).includes(pathname));
    actualTransportCalls++;
    const body = { calendar_id: calendarId,
      ics: pathname === CONTRACT.paths.events ? eventICS : taskICS };
    return sourceCall(pathname, method, body, ownerToken);
  };

  // Denial must happen before any user content or transport is requested.
  for (const [mesh, owner, consent] of [
    [() => false, () => true, () => true],
    [() => true, () => false, () => true],
    [() => true, () => true, () => false],
  ]) {
    const denied = await make(transport, mesh, owner, consent)
      .preview({ actor: 'fixture.reader', kind: 'events' });
    assert.deepEqual(denied, { ok: false, error: { code: 'denied' } });
  }
  assert.equal(actualTransportCalls, 0);

  const fixture = make(transport);
  for (const kind of ['events', 'tasks']) {
    const preview = await fixture.preview({ actor: 'fixture.reader', kind });
    assert.equal(preview.ok, true);
    assert.deepEqual(preview.data, { total: 1, would_import: 1, would_skip: 0 });
    assert.equal(preview.evidence_status, 'prototype');
    assert.ok(markers.every(marker => !JSON.stringify(preview).includes(marker)));
  }
  assert.equal(actualTransportCalls, 2);

  // The source, not Mesh, still enforces its authenticated owner boundary.
  const anonymous = await sourceCall(CONTRACT.paths.tasks, 'POST',
    { calendar_id: calendarId, ics: taskICS });
  assert.equal(anonymous.status, 401);
  const other = await sourceCall(CONTRACT.paths.events, 'POST',
    { calendar_id: calendarId, ics: eventICS }, otherToken);
  assert.equal(other.status, 404);

  // The existing interactive API still exposes a title by default. Mesh MUST
  // use only the fixed title-minimized path and reject unexpected extra data.
  const interactive = await sourceCall('/api/v1/import-tasks.ics?dry_run=1', 'POST',
    { calendar_id: calendarId, ics: taskICS }, ownerToken);
  assert.equal(interactive.status, 200);
  assert.ok(JSON.parse(interactive.body).sample_titles.includes(markers[1]));
  const unexpected = await make(async () => interactive)
    .preview({ actor: 'fixture.reader', kind: 'tasks' });
  assert.deepEqual(unexpected, { ok: false, error: { code: 'invalid_response' } });

  // Preview must not create any Calendar tasks/events or UID idempotency rows.
  const taskRecords = await sourceCall('/api/v1/tasks', 'GET', undefined, ownerToken);
  assert.equal(taskRecords.status, 200);
  assert.deepEqual(JSON.parse(taskRecords.body).tasks, []);
  const eventRecords = await sourceCall(
    '/api/v1/events?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z',
    'GET', undefined, ownerToken);
  assert.equal(eventRecords.status, 200);
  assert.deepEqual(JSON.parse(eventRecords.body).events, []);

  console.log('CALENDAR_REAL_SOURCE_REDACTED_PREVIEW_MESH_CONTRACT_PASS');
} finally {
  clearTimeout(guard);
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
