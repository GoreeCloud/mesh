import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExactHealthFixtureAdapter, readHealthContext, healthSignalAborted,
} from './exact-health-fixture.mjs';
import { createDNSHealthFixtureAdapter } from './dns-health.mjs';

const when = '2026-11-12T15:00:00.000Z';
let transportCalls = 0;
function adapters() {
  const opts = {
    permit: () => true, clock: () => when,
    transport: async () => {
      transportCalls++;
      return { status: 200, contentType: 'application/json; charset=utf-8',
        body: '{"server":"dns-private.example","status":"ok"}' };
    },
  };
  return [
    createDNSHealthFixtureAdapter(opts),
    createExactHealthFixtureAdapter({
      ...opts, transport: async () => {
        transportCalls++;
        return { status: 200, contentType: 'application/json; charset=utf-8',
          body: '{"ok":true}\n' };
      },
    }, { path: '/healthz', body: '{"ok":true}\n' }),
  ];
}

test('native signals are accepted, aborted signals refuse before transport', async () => {
  const controller = new AbortController();
  assert.equal(healthSignalAborted(controller.signal), false);
  assert.equal(readHealthContext({ signal: controller.signal }).signal, controller.signal);
  for (const adapter of adapters()) {
    assert.equal(await adapter.authorize('fixture.reader', {}, { signal: controller.signal }), true);
    assert.deepEqual(await adapter.readStatus({ signal: controller.signal }),
      { state: 'ok', observed_at: when });
  }
  controller.abort();
  const before = transportCalls;
  for (const adapter of adapters()) {
    assert.equal(await adapter.authorize('fixture.reader', {}, { signal: controller.signal }), false);
    await assert.rejects(adapter.readStatus({ signal: controller.signal }),
      /source health unavailable/);
  }
  assert.equal(transportCalls, before);
});

test('accessor-backed caller context is denied without ever invoking a getter', async () => {
  let invoked = 0;
  const hostile = Object.defineProperty({}, 'signal', {
    enumerable: true,
    get() { invoked++; throw Error('private context token'); },
  });
  for (const adapter of adapters()) {
    assert.equal(await adapter.authorize('fixture.reader', {}, hostile), false);
    await assert.rejects(adapter.readStatus(hostile), /source health unavailable/);
  }
  assert.equal(invoked, 0);
});

test('wrong, extra, inherited or shadowed abort contexts cannot call the source', async () => {
  let invoked = 0;
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'aborted', {
    configurable: true, get() { invoked++; return false; },
  });
  for (const adapter of adapters()) {
    for (const ctx of [
      null, [], { signal: null }, { signal: false }, { signal: {} },
      { signal: controller.signal }, { signal: new AbortController().signal, extra: 'private' },
      Object.create({ signal: new AbortController().signal }),
    ]) {
      assert.equal(await adapter.authorize('fixture.reader', {}, ctx), false);
      await assert.rejects(adapter.readStatus(ctx), /source health unavailable/);
    }
  }
  assert.equal(invoked, 0);
});

test('absent context preserves fixture-only direct invocation compatibility', async () => {
  for (const adapter of adapters()) {
    assert.equal(await adapter.authorize('fixture.reader', {}), true);
    assert.deepEqual(await adapter.readStatus(), { state: 'ok', observed_at: when });
  }
});
