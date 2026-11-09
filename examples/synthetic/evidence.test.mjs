import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticReadObserver, EVIDENCE_VERSION } from './evidence.mjs';

const ok = () => ({ ok: true, kind: 'synthetic_result', data: { secret: 'not logged' } });
const goodHarness = (reply = ok()) => ({ read: async () => reply });

test('opt-in observer returns unchanged response with locally generated correlation ID', async () => {
  const observer = createSyntheticReadObserver(goodHarness());
  const response = await observer.read({ actor: 'private-personal-actor', payload: 'private' });
  assert.deepEqual(response.response, ok());
  assert.match(response.correlation_id, /^[a-f0-9-]{36}$/);
  const [event] = observer.records();
  assert.deepEqual(Object.keys(event).sort(), ['correlation_id', 'observed_at', 'outcome', 'schema_version']);
  assert.equal(event.schema_version, EVIDENCE_VERSION);
  assert.equal(event.correlation_id, response.correlation_id);
  assert.equal(event.outcome, 'ok');
  assert.match(event.observed_at, /^\d{4}-\d\d-\d\dT/);
  assert.doesNotMatch(JSON.stringify(observer.records()), /private|secret|actor|payload/);
});

test('denial is preserved and only its allowed outcome is recorded', async () => {
  const denied = { ok: false, error: { code: 'denied', message: 'never log me' } };
  const observer = createSyntheticReadObserver(goodHarness(denied));
  assert.strictEqual((await observer.read()).response, denied);
  assert.equal(observer.records()[0].outcome, 'denied');
  assert.doesNotMatch(JSON.stringify(observer.records()), /never log/);
});

test('bounded admission refuses concurrent excess before executing owner method', async () => {
  let release;
  let ownerCalls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const observer = createSyntheticReadObserver({ read: () => { ownerCalls++; return pending; } }, { maxInFlight: 1 });
  const first = observer.read({ actor: 'alpha' });
  assert.equal(observer.inFlight(), 1);
  const blocked = await observer.read({ actor: 'beta' });
  assert.deepEqual(blocked.response, { ok: false, error: { code: 'unavailable' } });
  assert.equal(ownerCalls, 1);
  release(ok());
  assert.deepEqual((await first).response, ok());
  assert.equal(observer.inFlight(), 0);
  assert.deepEqual(observer.records().map(e => e.outcome), ['unavailable', 'ok']);
});

test('capacity bounds retained evidence and records are inert copies', async () => {
  const observer = createSyntheticReadObserver(goodHarness(), { capacity: 2 });
  await observer.read(); await observer.read(); await observer.read();
  assert.equal(observer.records().length, 2);
  const copy = observer.records();
  copy[0].outcome = 'secret'; copy.push({ secret: 1 });
  assert.equal(observer.records().length, 2);
  assert.equal(observer.records()[0].outcome, 'ok');
  observer.clear();
  assert.deepEqual(observer.records(), []);
});

test('strict configuration rejects getters and hostile proxies without invoking getters', () => {
  let invoked = 0;
  const bad = Object.defineProperty({}, 'capacity', { get() { invoked++; return 12; } });
  for (const opts of [bad, { capacity: 0 }, { maxInFlight: 33 }, { other: 10 },
    { [Symbol('hidden')]: true }, [], null,
    new Proxy({}, { ownKeys() { throw Error('trap'); } })]) {
    assert.throws(() => createSyntheticReadObserver(goodHarness(), opts), TypeError);
  }
  assert.equal(invoked, 0);
});

test('accessor-backed read method is rejected without evaluating getter', () => {
  let called = 0;
  const harness = Object.defineProperty({}, 'read', { get() { called++; return () => ok(); } });
  assert.throws(() => createSyntheticReadObserver(harness), TypeError);
  assert.equal(called, 0);
});

test('classification never invokes malicious response accessors', async () => {
  let invoked = 0;
  const response = Object.defineProperty({}, 'ok', { get() { invoked++; return true; } });
  const observer = createSyntheticReadObserver(goodHarness(response));
  assert.strictEqual((await observer.read()).response, response);
  assert.equal(observer.records()[0].outcome, 'invalid_response');
  assert.equal(invoked, 0);
});

test('unknown owner errors do not expose their message in evidence', async () => {
  const observer = createSyntheticReadObserver({ read() { throw Error('secret credential'); } });
  await assert.rejects(observer.read(), /secret credential/);
  assert.equal(observer.inFlight(), 0);
  assert.equal(observer.records()[0].outcome, 'unavailable');
  assert.doesNotMatch(JSON.stringify(observer.records()), /secret credential/);
});

test('unknown error codes fail closed in evidence without changing response', async () => {
  const exotic = { ok: false, error: { code: 'credential-leak' } };
  const observer = createSyntheticReadObserver(goodHarness(exotic));
  assert.strictEqual((await observer.read()).response, exotic);
  assert.equal(observer.records()[0].outcome, 'invalid_response');
});
