// Real, isolated Calendar Python health/readiness source -> Mesh fixture test.
// No user data, internet listener, credentials, production connector or sync.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import {
  CALENDAR_LIVENESS_CONTRACT, CALENDAR_READINESS_CONTRACT,
  createCalendarHealthFixtureAdapter, createCalendarReadinessFixtureAdapter,
} from './calendar-healthz.mjs';

if (process.env.GC_MESH_CALENDAR_ISOLATED_TEST !== '1') {
  throw new Error('Explicit isolated Calendar source-contract test opt-in required');
}
if (process.argv.length !== 3) throw new Error('Provide reviewed Calendar source directory');

const root = path.resolve(process.argv[2]);
const child = spawn('python3', [new URL('./calendar-owned-loopback.py', import.meta.url).pathname, root], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
});
let started = null;
const chunks = [];
child.stdout.on('data', data => { if (Buffer.concat(chunks).length < 1024) chunks.push(data); });
const ready = new Promise((resolve, reject) => {
  child.stdout.on('data', () => {
    const first = Buffer.concat(chunks).toString('utf8').split('\n')[0];
    if (first.endsWith('}')) {
      try { resolve(JSON.parse(first)); }
      catch { reject(new Error('Invalid source fixture setup')); }
    }
  });
  child.once('error', () => reject(new Error('Cannot start pinned Calendar source')));
  child.once('exit', () => reject(new Error('Pinned Calendar source exited before setup')));
});
const guard = setTimeout(() => child.kill('SIGTERM'), 10000);
try {
  started = await ready;
  assert.ok(Number.isInteger(started.port) && started.port > 0 && started.port < 65536);
  assert.ok(typeof started.database === 'string');
  assert.ok(started.database.startsWith('/tmp/mesh-calendar-source-contract-'));
  assert.ok(started.database.endsWith('/synthetic.sqlite3'));

  const items = [
    { id: 'calendar.health', contract: CALENDAR_LIVENESS_CONTRACT,
      create: createCalendarHealthFixtureAdapter },
    { id: 'calendar.ready', contract: CALENDAR_READINESS_CONTRACT,
      create: createCalendarReadinessFixtureAdapter },
  ];
  let realCalls = 0;
  async function transport({ method, path: pathname, signal }) {
    assert.equal(method, 'GET');
    assert.ok(['/healthz', '/readyz'].includes(pathname));
    realCalls++;
    const response = await fetch('http://127.0.0.1:' + started.port + pathname,
      { method, signal, redirect: 'manual' });
    return {
      status: response.status, contentType: response.headers.get('content-type'),
      body: await response.text(),
    };
  }
  function harness(item, meshPermit = () => true, ownerPermit = () => true) {
    return createSyntheticHarness({
      manifest: {
        schema_version: CONTRACT_VERSION, environment: 'synthetic-local-only',
        capabilities: items.map(x => ({
          id: x.id, owner: 'calendar', version: '0.0.1-fixture',
          operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
        })),
      },
      adapters: { [item.id]: item.create({
        transport, permit: ownerPermit, clock: () => '2026-11-11T13:00:00.000Z',
      }) },
      meshPermit, timeoutMs: 1000,
    });
  }
  const read = (item, meshPermit, ownerPermit) =>
    harness(item, meshPermit, ownerPermit).read({
      actor: 'fixture.reader', capabilityId: item.id, operation: 'status.read',
    });
  for (const item of items) {
    assert.equal(item.contract.source, 'GoreeCloud/calendar');
    const result = await read(item);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { state: 'ok', observed_at: '2026-11-11T13:00:00.000Z' });
    assert.equal(result.evidence_status, 'prototype');
  }
  const before = realCalls;
  for (const item of items) {
    assert.equal((await read(item, () => false)).error.code, 'denied');
    assert.equal((await read(item, () => true, () => false)).error.code, 'denied');
  }
  assert.equal(realCalls, before, 'Unauthorized requests must not touch Calendar');

  const moved = started.database + '.unavailable';
  await rename(started.database, moved);
  try {
    assert.equal((await read(items[0])).ok, true, 'HTTP liveness survives SQLite outage');
    const result = await read(items[1]);
    assert.equal(result.ok, false, 'Database readiness fails during SQLite outage');
    assert.equal(result.error.code, 'unavailable');
  } finally {
    await rename(moved, started.database);
  }
  assert.equal((await read(items[1])).ok, true, 'Readiness recovers after restoring SQLite');
  console.log('CALENDAR_PINNED_SOURCE_MESH_CONTRACT_PASS');
} finally {
  clearTimeout(guard);
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
