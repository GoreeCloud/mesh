import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticHarness, CONTRACT_VERSION } from '../synthetic/harness.mjs';
import { createGatewayHealthFixtureAdapter, GATEWAY_HEALTH_CONTRACT } from './gateway-healthz.mjs';
import { createVPNHealthFixtureAdapter, VPN_HEALTH_CONTRACT } from './vpn-healthz.mjs';

const seenAt = '2026-11-09T12:00:00.000Z';
const plans = [
  {
    label: 'Gateway console', owner: 'gateway', capability: 'gateway.health',
    source: 'GoreeCloud/gateway',
    blob: 'e17003e921f8ff9dfe1a7216151e6cb11f12c73c',
    adapter: createGatewayHealthFixtureAdapter, contract: GATEWAY_HEALTH_CONTRACT,
    body: '{"ok":true}\n',
  },
  {
    label: 'VPN management', owner: 'vpn', capability: 'vpn.health',
    source: 'GoreeCloud/VPN',
    blob: 'd43c64e12c750205adc567e1cb4ba8ab4923685c',
    adapter: createVPNHealthFixtureAdapter, contract: VPN_HEALTH_CONTRACT,
    body: '{"status":"ok","maturity":"alpha","component":"management"}',
  },
];

function harness(item, adapterOptions, meshPermit = () => true) {
  return createSyntheticHarness({
    manifest: {
      schema_version: CONTRACT_VERSION, environment: 'synthetic-local-only',
      capabilities: [{
        id: item.capability, owner: item.owner, version: '0.0.1-fixture',
        operation: 'status.read', sensitivity: 'synthetic', evidence_status: 'prototype',
      }],
    },
    adapters: { [item.capability]: item.adapter(adapterOptions) },
    meshPermit, timeoutMs: 100,
  });
}

const request = item => ({
  actor: 'fixture.reader', capabilityId: item.capability, operation: 'status.read',
});

const response = body => ({
  status: 200, contentType: 'application/json; charset=utf-8', body,
});

for (const item of plans) {
  test(item.label + ' exact source blob and no operational connection', () => {
    assert.equal(item.contract.source, item.source);
    assert.equal(item.contract.source_blob, item.blob);
    assert.equal(item.contract.method, 'GET');
    assert.equal(item.contract.path, '/healthz');
    assert.equal(item.contract.mode, 'transport-injected-nonproduction');
  });

  test(item.label + ' projects exact liveness into minimal synthetic status', async () => {
    let calls = 0;
    const result = await harness(item, {
      permit: () => true, clock: () => seenAt,
      transport: async params => {
        calls++;
        assert.deepEqual(Object.keys(params).sort(), ['method', 'path', 'signal']);
        assert.equal(params.method, 'GET');
        assert.equal(params.path, '/healthz');
        assert.equal(params.signal.aborted, false);
        return response(item.body);
      },
    }).read(request(item));
    assert.equal(calls, 1);
    assert.deepEqual(result, { ok: true, data: { state: 'ok', observed_at: seenAt } });
    assert.equal(JSON.stringify(result).includes(item.body), false);
    assert.equal('data_plane_enforced' in result.data, false);
    assert.equal('routes' in result.data, false);
  });

  test(item.label + ' requires both distinct permit checks', async () => {
    let calls = 0;
    const send = () => { calls++; return response(item.body); };
    for (const opts of [
      [{ transport: send }, () => true],
      [{ transport: send, permit: () => false }, () => true],
      [{ transport: send, permit: () => 'true' }, () => true],
      [{ transport: send, permit: () => { throw Error('sensitive'); } }, () => true],
      [{ transport: send, permit: () => true }, () => false],
    ]) {
      const answer = await harness(item, opts[0], opts[1]).read(request(item));
      assert.equal(answer.ok, false);
      assert.equal(answer.error.code, 'denied');
    }
    assert.equal(calls, 0);
  });

  test(item.label + ' rejects wrong, extra, duplicate and oversized owner replies', async () => {
    const invalid = [
      response(item.body + '\n'),
      response(item.body.replace('true', 'false').replace('"ok"', '"down"')),
      response('{"status":"ok","status":"ok"}'),
      response(item.body.replace(/\}(\n)?$/, ',"secret":"private"}$1')),
      response('x'.repeat(300)),
      { ...response(item.body), status: 503 },
      { ...response(item.body), contentType: 'text/plain' },
      { ...response(item.body), extra: 'private' },
      null,
      [],
    ];
    for (const bad of invalid) {
      const actual = await harness(item, {
        permit: () => true, clock: () => seenAt, transport: async () => bad,
      }).read(request(item));
      assert.equal(actual.ok, false);
      assert.equal(actual.error.code, 'unavailable');
      assert.equal(JSON.stringify(actual).includes('private'), false);
    }
  });

  test(item.label + ' rejects response accessor, abort and invalid clock', async () => {
    let getterCalls = 0;
    const hostile = Object.defineProperty(response(item.body), 'body', {
      get() { getterCalls++; throw Error('untrusted getter'); },
    });
    const actual = await harness(item, {
      permit: () => true, clock: () => seenAt, transport: async () => hostile,
    }).read(request(item));
    assert.equal(actual.error.code, 'unavailable');
    assert.equal(getterCalls, 0);

    const badClock = await harness(item, {
      permit: () => true, clock: () => 'not-a-timestamp',
      transport: async () => response(item.body),
    }).read(request(item));
    assert.equal(badClock.error.code, 'unavailable');

    const abort = new AbortController();
    abort.abort();
    const adapter = item.adapter({ permit: () => true, transport: async () => response(item.body) });
    assert.equal(await adapter.authorize('fixture.reader', {}, { signal: abort.signal }), false);
    await assert.rejects(adapter.readStatus({ signal: abort.signal }), /source health unavailable/);
  });
}
