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
const grant = async (adapter, signal) => {
  assert.equal(await adapter.authorize('fixture.reader', manifest.capabilities[0], { signal }), true);
  return signal;
};

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
  const firstSignal = await grant(adapter, new AbortController().signal);
  const first = adapter.readStatus({ signal: firstSignal });
  assert.equal(adapter.activeCount(), 1);
  const saturatedSignal = await grant(adapter, new AbortController().signal);
  await assert.rejects(
    adapter.readStatus({ signal: saturatedSignal }),
    /isolated fixture unavailable/,
  );
  await assert.rejects(first, /isolated fixture unavailable/);
  for (let i = 0; i < 25 && adapter.activeCount(); i++) await delay(10);
  assert.equal(adapter.activeCount(), 0, 'a killed subprocess must actually close');
  // A further authorized request is admitted (but fails on its own deadline).
  const nextSignal = await grant(adapter, new AbortController().signal);
  await assert.rejects(
    adapter.readStatus({ signal: nextSignal }),
    /isolated fixture unavailable/,
  );
});

test('cooperative caller abort kills subprocess and cannot reuse active slot early', async () => {
  const controller = new AbortController();
  const adapter = owner('hang', { deadlineMs: 700 });
  await grant(adapter, controller.signal);
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

test('untrusted direct worker contexts cannot execute getters or escape generic denial', async () => {
  let getterCalls = 0;
  let permitCalls = 0;
  const adapter = owner('ok', { permit: () => { permitCalls++; return true; } });
  const accessor = Object.defineProperty({}, 'signal', {
    get() { getterCalls++; throw new Error('private data'); },
  });
  const hostile = [
    accessor, null, [], { signal: null },
    { signal: new AbortController().signal, extra: 'unexpected' },
    new Proxy({}, { ownKeys() { throw new Error('private proxy data'); } }),
  ];
  for (const context of hostile) {
    assert.equal(await adapter.authorize('fixture.reader', manifest.capabilities[0], context), false);
    await assert.rejects(adapter.readStatus(context), /^Error: isolated fixture unavailable$/);
  }
  assert.equal(getterCalls, 0);
  assert.equal(permitCalls, 0);
  assert.equal(adapter.activeCount(), 0);
  assert.equal(adapter.launchesInWindow(), 0);
  assert.equal(await adapter.authorize('fixture.reader', manifest.capabilities[0],
    { signal: new AbortController().signal }), true);
  assert.equal(permitCalls, 1);
});

test('fixed-code owner denies permits for unrelated or forged capability identities', async () => {
  let permits = 0;
  let getterCalls = 0;
  const adapter = owner('ok', { permit: () => { permits++; return true; } });
  const wrong = [
    manifest.capabilities[1],
    { ...manifest.capabilities[0], owner: 'fixture.beta' },
    { ...manifest.capabilities[0], id: 'fixture.beta.status' },
    { ...manifest.capabilities[0], operation: 'status.write' },
    { ...manifest.capabilities[0], sensitivity: 'personal' },
    { ...manifest.capabilities[0], extra: 'unexpected' },
    Object.defineProperty({ ...manifest.capabilities[0] }, 'id', {
      get() { getterCalls++; return 'fixture.alpha.status'; },
    }),
    new Proxy({}, { ownKeys() { throw Error('private descriptor'); } }),
  ];
  const signal = new AbortController().signal;
  for (const capability of wrong) {
    assert.equal(await adapter.authorize('fixture.reader', capability, { signal }), false);
    await assert.rejects(adapter.readStatus({ signal }), /^Error: isolated fixture unavailable$/);
  }
  assert.equal(await adapter.authorize('not a valid actor', manifest.capabilities[0], { signal }), false);
  assert.equal(getterCalls, 0);
  assert.equal(permits, 0, 'hostile/unrelated capability never reaches owner policy');
  assert.equal(adapter.launchesInWindow(), 0);

  await grant(adapter, signal);
  assert.equal(await adapter.authorize('fixture.reader', manifest.capabilities[1], { signal }), false);
  await assert.rejects(adapter.readStatus({ signal }), /^Error: isolated fixture unavailable$/);
  assert.equal(permits, 1, 'later mismatched capability revoked prior read ticket');
  assert.equal(adapter.launchesInWindow(), 0);
});

test('direct synthetic owner reads require a single-use successful authorization', async () => {
  let permitted = true;
  let policyCalls = 0;
  const adapter = owner('ok', { permit: () => { policyCalls++; return permitted; } });
  const signal = new AbortController().signal;
  await assert.rejects(adapter.readStatus({ signal }), /^Error: isolated fixture unavailable$/);
  assert.equal(adapter.launchesInWindow(), 0, 'bypass must not start a child');

  await grant(adapter, signal);
  const result = await adapter.readStatus({ signal });
  assert.equal(result.state, 'ok');
  assert.equal(adapter.activeCount(), 0);
  assert.equal(adapter.launchesInWindow(), 1);
  await assert.rejects(adapter.readStatus({ signal }), /^Error: isolated fixture unavailable$/);
  assert.equal(adapter.launchesInWindow(), 1, 'used grant cannot spawn twice');

  permitted = false;
  assert.equal(await adapter.authorize('fixture.reader', manifest.capabilities[0], { signal }), false);
  await assert.rejects(adapter.readStatus({ signal }), /^Error: isolated fixture unavailable$/);
  assert.equal(policyCalls, 2);
  assert.equal(adapter.launchesInWindow(), 1);
});

test('late owner policy approval cannot defeat a newer authorization denial', async () => {
  let resolveFirst;
  let requests = 0;
  const adapter = owner('ok', {
    permit: () => ++requests === 1
      ? new Promise(resolve => { resolveFirst = resolve; })
      : false,
  });
  const signal = new AbortController().signal;
  const pending = adapter.authorize('fixture.reader', manifest.capabilities[0], { signal });
  assert.equal(typeof resolveFirst, 'function');
  assert.equal(await adapter.authorize('fixture.reader', manifest.capabilities[0], { signal }), false);
  resolveFirst(true);
  assert.equal(await pending, false, 'stale policy approval must not issue a ticket');
  await assert.rejects(adapter.readStatus({ signal }), /^Error: isolated fixture unavailable$/);
  assert.equal(adapter.activeCount(), 0);
  assert.equal(adapter.launchesInWindow(), 0);
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
  await grant(adapter, signal);
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

test('fixed-code owner budget blocks rapid crash/restart churn without new children', async () => {
  const adapter = owner('crash', { deadlineMs: 700, maxConcurrent: 1 });
  const signal = new AbortController().signal;
  for (let i = 0; i < 16; i++) {
    await grant(adapter, signal);
    await assert.rejects(
      adapter.readStatus({ signal }), /isolated fixture unavailable/
    );
    assert.equal(adapter.activeCount(), 0, 'crashed child must close before slot release');
    assert.equal(adapter.launchesInWindow(), i + 1);
  }
  // More callers cannot trigger additional spawn attempts within the budget.
  for (let i = 0; i < 10; i++) {
    await grant(adapter, signal);
    await assert.rejects(
      adapter.readStatus({ signal }), /isolated fixture unavailable/
    );
    assert.equal(adapter.launchesInWindow(), 16);
    assert.equal(adapter.activeCount(), 0);
  }
});

test('over-capacity and invalid callers never consume the child launch budget', async () => {
  const adapter = owner('hang', { deadlineMs: 100, maxConcurrent: 1 });
  const ctrl = new AbortController();
  await grant(adapter, ctrl.signal);
  const first = adapter.readStatus({ signal: ctrl.signal });
  assert.equal(adapter.activeCount(), 1);
  assert.equal(adapter.launchesInWindow(), 1);
  const overCapacity = await grant(adapter, new AbortController().signal);
  await assert.rejects(
    adapter.readStatus({ signal: overCapacity }),
    /isolated fixture unavailable/
  );
  await assert.rejects(adapter.readStatus({ signal: null }),
    /isolated fixture unavailable/);
  assert.equal(adapter.launchesInWindow(), 1);
  ctrl.abort();
  await assert.rejects(first, /isolated fixture unavailable/);
  for (let i = 0; i < 40 && adapter.activeCount(); i++) await delay(10);
  assert.equal(adapter.activeCount(), 0);
});
