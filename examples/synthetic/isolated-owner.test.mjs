import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createIsolatedSyntheticOwner } from './isolated-owner.mjs';
import { createSyntheticHarness } from './harness.mjs';
import { manifest } from './fixtures.mjs';

const ID = 'fixture.alpha.status';
const owner = (mode, opts = {}) => createIsolatedSyntheticOwner({
  mode, deadlineMs: 700, maxConcurrent: 1, permit: () => true, ...opts,
});
const harness = adapter => createSyntheticHarness({
  manifest,
  adapters: { [ID]: adapter },
  meshPermit: () => true,
  timeoutMs: 950,
});
const read = h => h.read({ actor: 'fixture.reader', capabilityId: ID });

test('fixed-code subprocess returns an exact synthetic status to Mesh', async () => {
  for (const mode of ['ok', 'degraded']) {
    const adapter = owner(mode);
    assert.equal(adapter.activeCount(), 0);
    const value = await read(harness(adapter));
    assert.equal(value.ok, true);
    assert.equal(value.evidence_status, 'prototype');
    assert.equal(value.data.state, mode);
    assert.equal(new Date(value.data.observed_at).toISOString(), value.data.observed_at);
    assert.equal(adapter.activeCount(), 0);
  }
});

test('owner authorization remains default deny unless explicit true is supplied', async () => {
  for (const permit of [
    () => false, () => 'true', () => { throw Error('private policy'); },
  ]) {
    const adapter = owner('ok', { permit });
    const result = await read(harness(adapter));
    assert.equal(result.error.code, 'denied');
    assert.equal(adapter.activeCount(), 0);
  }
});

test('worker crash and oversized output cannot become synthetic success', async () => {
  for (const mode of ['crash', 'oversize']) {
    const adapter = owner(mode);
    const value = await read(harness(adapter));
    assert.equal(value.error.code, 'unavailable');
    // An oversized child's caller fails before OS process close; the lease
    // deliberately persists until the actual child exit is observed.
    for (let i = 0; i < 30 && adapter.activeCount(); i++) await delay(10);
    assert.equal(adapter.activeCount(), 0);
    assert.doesNotMatch(JSON.stringify(value), /secret|private|stack|token/);
  }
});

test('kill a stalled subprocess at the real deadline and free its slot', async () => {
  const adapter = owner('hang', { deadlineMs: 120 });
  const first = adapter.readStatus({ signal: new AbortController().signal });
  assert.equal(adapter.activeCount(), 1);
  await assert.rejects(
    adapter.readStatus({ signal: new AbortController().signal }),
    /isolated fixture unavailable/,
  );
  await assert.rejects(first, /isolated fixture unavailable/);
  for (let i = 0; i < 25 && adapter.activeCount(); i++) await delay(10);
  assert.equal(adapter.activeCount(), 0, 'a killed subprocess must actually close');
  // A further request is admitted (but fails again on its own deadline).
  await assert.rejects(
    adapter.readStatus({ signal: new AbortController().signal }),
    /isolated fixture unavailable/,
  );
});

test('cooperative caller abort kills subprocess and cannot reuse active slot early', async () => {
  const controller = new AbortController();
  const adapter = owner('hang', { deadlineMs: 700 });
  const running = adapter.readStatus({ signal: controller.signal });
  assert.equal(adapter.activeCount(), 1);
  controller.abort();
  await assert.rejects(running, /isolated fixture unavailable/);
  for (let i = 0; i < 30 && adapter.activeCount(); i++) await delay(10);
  assert.equal(adapter.activeCount(), 0);
  await assert.rejects(
    adapter.readStatus({ signal: controller.signal }),
    /isolated fixture unavailable/,
  );
  assert.equal(adapter.activeCount(), 0);
});

test('noncooperative delayed child is killed before late synthetic status can arrive', async () => {
  const adapter = owner('late', { deadlineMs: 80 });
  const result = await read(harness(adapter));
  assert.ok(['unavailable', 'timed_out'].includes(result.error.code));
  for (let i = 0; i < 30 && adapter.activeCount(); i++) await delay(10);
  assert.equal(adapter.activeCount(), 0);
});

test('configuration and abort traps are rejected without executing getters', async () => {
  let touched = 0;
  const normal = { mode: 'ok', permit: () => true, deadlineMs: 100, maxConcurrent: 1 };
  const bad = Object.defineProperty({ ...normal }, 'mode', {
    get() { touched++; return 'ok'; },
  });
  for (const config of [
    bad, null, [], {}, { ...normal, mode: '/bin/sh' },
    { ...normal, maxConcurrent: 5 }, { ...normal, deadlineMs: 0 },
    { ...normal, shell: true },
    { ...normal, env: { TOKEN: 'private' } },
    new Proxy({}, { ownKeys() { throw Error('private'); } }),
  ]) assert.throws(() => createIsolatedSyntheticOwner(config), TypeError);
  assert.equal(touched, 0);
  const adapter = owner('ok');
  await assert.rejects(adapter.readStatus({ signal: null }), /isolated fixture unavailable/);
  assert.equal(adapter.activeCount(), 0);
});

test('hostile AbortSignal hooks cannot release a live child lease before CLOSE', async () => {
  const signal = new AbortController().signal;
  let cleanupCalls = 0;
  Object.defineProperty(signal, 'addEventListener', {
    value() { throw new Error('private listener failure'); },
  });
  Object.defineProperty(signal, 'removeEventListener', {
    value() { cleanupCalls++; throw new Error('private cleanup failure'); },
  });
  const adapter = owner('hang', { deadlineMs: 700 });
  const failed = adapter.readStatus({ signal });
  // The child has already been spawned and the faulty listener rejected.
  // Capacity must remain charged synchronously until the OS closes it.
  assert.equal(adapter.activeCount(), 1);
  await assert.rejects(
    adapter.readStatus({ signal: new AbortController().signal }),
    /isolated fixture unavailable/,
  );
  await assert.rejects(failed, /isolated fixture unavailable/);
  for (let i = 0; i < 40 && adapter.activeCount(); i++) await delay(10);
  assert.equal(adapter.activeCount(), 0, 'CLOSE eventually releases the lease');
  assert.equal(cleanupCalls, 1, 'faulty cleanup is contained, not propagated');
});
